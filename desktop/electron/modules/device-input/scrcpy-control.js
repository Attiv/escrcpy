import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import net from 'node:net'

import { getAdbPath } from '$electron/configs/which/index.js'
import { scrcpyControlServerPath } from '$electron/configs/extra/index.js'

import { adbExec, withSerial } from './adb.js'

/**
 * 打包的 scrcpy-server 版本，必须与 resources/extra/common/wscrcpy/scrcpy-server 一致，
 * 否则服务端会以版本不匹配拒绝启动。
 */
const SERVER_VERSION = '3.3.4'

/**
 * 刻意与 scrcpy 自身的 /data/local/tmp/scrcpy-server.jar 错开：
 * 用户可能装了其它版本的 scrcpy，共用路径会互相覆盖。
 */
const REMOTE_SERVER_PATH = '/data/local/tmp/escrcpy-control-server.jar'

/** 控制消息类型，数值取自打包 server 的 ControlMessage 常量表 */
const ControlMessageType = {
  INJECT_KEYCODE: 0,
  INJECT_TEXT: 1,
  INJECT_TOUCH_EVENT: 2,
  INJECT_SCROLL_EVENT: 3,
  SET_CLIPBOARD: 9,
}

/** 空闲多久后回收设备上的 server 进程 */
const IDLE_TIMEOUT = 30 * 1000

const HANDSHAKE_TIMEOUT = 8000
const DEVICE_NAME_LENGTH = 64

/** deviceId -> session */
const sessions = new Map()
/** 每台设备每个 app 生命周期只需 push 一次 */
const pushedDevices = new Set()

function randomScid() {
  // scid 在服务端按 16 进制解析为 signed int32，首位必须 <= 7 否则溢出报错
  const value = Math.floor(Math.random() * 0x7FFFFFFF)
  return value.toString(16).padStart(8, '0')
}

/**
 * 设备上 adb 以 root(uid 0) 运行时，ClipboardService 的包名归属校验会拒绝请求
 * （Calling uid 0 does not own package com.android.shell）。
 * 此时降到 shell(uid 2000) 身份启动，行为与普通设备一致。
 */
async function resolveLaunchPrefix(deviceId) {
  try {
    const uid = (await adbExec(deviceId, ['shell', 'id', '-u'])).trim()

    if (uid !== '0') {
      return null
    }

    const which = (await adbExec(deviceId, ['shell', 'command -v su || true'])).trim()

    return which ? 'su 2000' : null
  }
  catch {
    return null
  }
}

async function pushServer(deviceId) {
  if (pushedDevices.has(deviceId)) {
    return
  }

  await adbExec(deviceId, ['push', scrcpyControlServerPath, REMOTE_SERVER_PATH])
  pushedDevices.add(deviceId)
}

function startServerProcess(deviceId, scid, launchPrefix) {
  const adbPath = getAdbPath()

  const serverCommand = [
    `CLASSPATH=${REMOTE_SERVER_PATH}`,
    'app_process',
    '/',
    'com.genymobile.scrcpy.Server',
    SERVER_VERSION,
    `scid=${scid}`,
    'video=false',
    'audio=false',
    'control=true',
    'cleanup=false',
    // 服务端监听本地套接字，由 adb forward 接入；默认的反向隧道在网络 ADB 下常被挡
    'tunnel_forward=true',
    'log_level=warn',
  ].join(' ')

  const command = launchPrefix
    ? `${launchPrefix} sh -c '${serverCommand}'`
    : serverCommand

  const child = spawn(adbPath, withSerial(deviceId, ['shell', command]), {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const stderrChunks = []
  child.stderr.on('data', chunk => stderrChunks.push(chunk.toString()))
  child.stdout.on('data', () => {})
  child.on('error', () => {})

  return { child, stderrChunks }
}

async function forwardPort(deviceId, scid) {
  // tcp:0 让 adb 自动分配空闲端口，避免多设备并发时端口打架
  const stdout = await adbExec(deviceId, [
    'forward',
    'tcp:0',
    `localabstract:scrcpy_${scid}`,
  ])

  const port = Number.parseInt(stdout.trim(), 10)

  if (!port) {
    throw new Error(`Failed to allocate forward port: ${stdout}`)
  }

  return port
}

function connectWithRetry(port, { retries = 12, interval = 250 } = {}) {
  return new Promise((resolve, reject) => {
    let attempts = 0

    const tryConnect = () => {
      attempts += 1

      const socket = net.connect(port, '127.0.0.1')

      socket.once('connect', () => resolve(socket))

      socket.once('error', (error) => {
        socket.destroy()

        if (attempts >= retries) {
          reject(error)
          return
        }

        setTimeout(tryConnect, interval)
      })
    }

    tryConnect()
  })
}

/**
 * 握手：服务端先发 1 字节 dummy，再发 64 字节定长设备名（空字节补齐）。
 */
function readHandshake(socket) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Handshake timed out'))
    }, HANDSHAKE_TIMEOUT)

    function cleanup() {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
    }

    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk])

      if (buffer.length < 1 + DEVICE_NAME_LENGTH) {
        return
      }

      cleanup()

      const deviceName = buffer
        .subarray(1, 1 + DEVICE_NAME_LENGTH)
        .toString('utf8')
        .replace(/\0+$/, '')

      resolve({ deviceName, rest: buffer.subarray(1 + DEVICE_NAME_LENGTH) })
    }

    function onError(error) {
      cleanup()
      reject(error)
    }

    socket.on('data', onData)
    socket.once('error', onError)
  })
}

function scheduleIdleClose(session) {
  clearTimeout(session.idleTimer)

  session.idleTimer = setTimeout(() => {
    closeSession(session.deviceId)
  }, IDLE_TIMEOUT)
}

async function createSession(deviceId) {
  await pushServer(deviceId)

  const launchPrefix = await resolveLaunchPrefix(deviceId)
  const scid = randomScid()
  const { child, stderrChunks } = startServerProcess(deviceId, scid, launchPrefix)

  let port

  try {
    // 给 app_process 一点启动时间，socket 尚未监听时 forward 也会成功（惰性），
    // 真正的等待交给 connectWithRetry
    await new Promise(resolve => setTimeout(resolve, 300))
    port = await forwardPort(deviceId, scid)

    const socket = await connectWithRetry(port)
    const { deviceName } = await readHandshake(socket)

    const session = {
      deviceId,
      scid,
      port,
      socket,
      child,
      deviceName,
      idleTimer: null,
    }

    socket.on('error', () => closeSession(deviceId))
    socket.on('close', () => {
      if (sessions.get(deviceId) === session) {
        sessions.delete(deviceId)
      }
    })

    sessions.set(deviceId, session)
    scheduleIdleClose(session)

    return session
  }
  catch (error) {
    child.kill()

    if (port) {
      await adbExec(deviceId, ['forward', '--remove', `tcp:${port}`]).catch(() => {})
    }

    const detail = stderrChunks.join('').trim().split('\n')[0]

    throw new Error(detail ? `${error.message} (${detail})` : error.message)
  }
}

async function ensureSession(deviceId) {
  const existing = sessions.get(deviceId)

  if (existing && !existing.socket.destroyed) {
    scheduleIdleClose(existing)
    return existing
  }

  const pending = createSession(deviceId)
  return pending
}

export async function closeSession(deviceId) {
  const session = sessions.get(deviceId)

  if (!session) {
    return false
  }

  sessions.delete(deviceId)
  clearTimeout(session.idleTimer)

  session.socket.destroy()
  session.child.kill()

  await adbExec(deviceId, ['forward', '--remove', `tcp:${session.port}`]).catch(() => {})

  return true
}

export async function closeAllSessions() {
  const deviceIds = Array.from(sessions.keys())
  await Promise.all(deviceIds.map(id => closeSession(id)))
}

function writeMessage(session, payload) {
  return new Promise((resolve, reject) => {
    session.socket.write(payload, (error) => {
      if (error) {
        reject(error)
        return
      }

      scheduleIdleClose(session)
      resolve(true)
    })
  })
}

/**
 * 写入设备剪贴板。
 * 线格式: type(1) | sequence(8, BE) | paste(1) | length(4, BE) | utf8
 * sequence 为 0 表示不要求服务端回 ACK。
 */
export async function setClipboard(deviceId, text, { paste = false } = {}) {
  const session = await ensureSession(deviceId)
  const body = Buffer.from(String(text ?? ''), 'utf8')
  const payload = Buffer.alloc(1 + 8 + 1 + 4 + body.length)

  let offset = 0

  payload.writeUInt8(ControlMessageType.SET_CLIPBOARD, offset)
  offset += 1

  payload.writeBigUInt64BE(0n, offset)
  offset += 8

  payload.writeUInt8(paste ? 1 : 0, offset)
  offset += 1

  payload.writeUInt32BE(body.length, offset)
  offset += 4

  body.copy(payload, offset)

  await writeMessage(session, payload)

  return { deviceName: session.deviceName }
}

export default {
  setClipboard,
  closeSession,
  closeAllSessions,
}
