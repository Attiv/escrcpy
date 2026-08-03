import { Buffer } from 'node:buffer'

import { adbKeyboardApkPath } from '$electron/configs/extra/index.js'

import { adbExec, adbShell } from './adb.js'

const PACKAGE_NAME = 'com.android.adbkeyboard'
const IME_ID = 'com.android.adbkeyboard/.AdbIME'

/** 切换输入法后需要一点时间生效，否则广播会打到旧输入法上 */
const IME_SWITCH_DELAY = 300

/** 安装后 InputMethodManagerService 需要时间重新扫描，期间 ime enable 会报 Unknown input method */
const IME_REGISTER_TIMEOUT = 10 * 1000
const IME_REGISTER_INTERVAL = 500

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function isInstalled(deviceId) {
  const stdout = await adbShell(deviceId, `pm list packages ${PACKAGE_NAME}`)
  return stdout.includes(PACKAGE_NAME)
}

/** 输入法是否已被系统登记（装包成功不等于立刻可用） */
async function isImeRegistered(deviceId) {
  try {
    const stdout = await adbShell(deviceId, 'ime list -a -s')
    return stdout.includes(IME_ID)
  }
  catch {
    return false
  }
}

async function waitForImeRegistered(deviceId) {
  const deadline = Date.now() + IME_REGISTER_TIMEOUT

  while (Date.now() < deadline) {
    if (await isImeRegistered(deviceId)) {
      return true
    }

    await sleep(IME_REGISTER_INTERVAL)
  }

  return false
}

export async function install(deviceId) {
  await adbExec(deviceId, ['install', '-r', adbKeyboardApkPath])

  // 装完立刻 ime enable 会失败，必须等系统扫描到这个输入法
  await waitForImeRegistered(deviceId)

  return isInstalled(deviceId)
}

async function getCurrentIme(deviceId) {
  try {
    const stdout = await adbShell(deviceId, 'settings get secure default_input_method')
    return stdout.trim()
  }
  catch {
    return ''
  }
}

async function setIme(deviceId, ime) {
  if (!ime) {
    return
  }

  await adbShell(deviceId, `ime set ${ime}`).catch(() => {})
}

/** 部分设备上输入法处于 disabled 状态，直接 ime set 会被拒绝 */
async function enableIme(deviceId, ime) {
  await adbShell(deviceId, `ime enable ${ime}`).catch(() => {})
}

/**
 * 把文本送入设备当前聚焦的输入框。
 *
 * 走 ADBKeyboard 的 ADB_INPUT_B64 广播而非 `input text`：
 * 后者只能处理 ASCII，中文与 emoji 会丢失。
 */
export async function sendText(deviceId, text, { clearBefore = false, restoreIme = true } = {}) {
  const content = String(text ?? '')

  if (!content) {
    return { sent: false, reason: 'empty' }
  }

  if (!(await isInstalled(deviceId))) {
    const error = new Error('ADBKeyboard is not installed')
    error.code = 'ADB_KEYBOARD_MISSING'
    throw error
  }

  const originalIme = await getCurrentIme(deviceId)
  const needSwitch = !originalIme.includes(IME_ID)

  if (needSwitch) {
    await enableIme(deviceId, IME_ID)
    await setIme(deviceId, IME_ID)
    await sleep(IME_SWITCH_DELAY)
  }

  try {
    if (clearBefore) {
      await adbShell(deviceId, 'am broadcast -a ADB_CLEAR_TEXT')
    }

    const encoded = Buffer.from(content, 'utf8').toString('base64')
    await adbShell(deviceId, `am broadcast -a ADB_INPUT_B64 --es msg '${encoded}'`)

    return { sent: true }
  }
  finally {
    // 无论成功与否都要把输入法还回去，否则用户的键盘会一直是 ADBKeyboard
    if (needSwitch && restoreIme && originalIme) {
      await sleep(IME_SWITCH_DELAY)
      await setIme(deviceId, originalIme)
    }
  }
}

export default {
  isInstalled,
  install,
  sendText,
}
