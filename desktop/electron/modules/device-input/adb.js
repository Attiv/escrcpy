import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { getAdbPath } from '$electron/configs/which/index.js'

const execFileAsync = promisify(execFile)

export function withSerial(deviceId, args) {
  return deviceId ? ['-s', deviceId, ...args] : args
}

export async function adbExec(deviceId, args, options = {}) {
  const adbPath = getAdbPath()

  if (!adbPath) {
    throw new Error('ADB executable not found')
  }

  const { stdout } = await execFileAsync(adbPath, withSerial(deviceId, args), {
    encoding: 'utf8',
    ...options,
  })

  return stdout
}

/**
 * 在设备上执行一条 shell 命令。命令整体作为单个参数传给 adb shell，
 * 由设备端 shell 自行解析，避免本地与远端二次分词。
 */
export function adbShell(deviceId, command, options = {}) {
  return adbExec(deviceId, ['shell', command], options)
}
