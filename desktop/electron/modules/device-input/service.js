import { ipcMain } from 'electron'

import adbKeyboard from './adb-keyboard.js'
import scrcpyControl from './scrcpy-control.js'

const CHANNELS = {
  SEND: 'device-input-send',
  KEYBOARD_INSTALLED: 'device-input-keyboard-installed',
  KEYBOARD_INSTALL: 'device-input-keyboard-install',
  CLOSE_SESSION: 'device-input-close-session',
}

function toDeviceIds(value) {
  if (!value) {
    return []
  }

  return (Array.isArray(value) ? value : [value]).filter(Boolean)
}

/**
 * 向单台设备投递文本。
 * targets 可同时包含 'ime'（当前聚焦的输入框）与 'clipboard'（设备剪贴板），
 * 两者互不依赖，任一失败不影响另一个，各自回报结果。
 */
async function sendToDevice(deviceId, { text, targets, clearBefore, paste }) {
  const result = { deviceId, ime: null, clipboard: null }

  if (targets.includes('ime')) {
    try {
      await adbKeyboard.sendText(deviceId, text, { clearBefore })
      result.ime = { success: true }
    }
    catch (error) {
      result.ime = { success: false, code: error.code, message: error.message }
    }
  }

  if (targets.includes('clipboard')) {
    try {
      await scrcpyControl.setClipboard(deviceId, text, { paste })
      result.clipboard = { success: true }
    }
    catch (error) {
      result.clipboard = { success: false, message: error.message }
    }
  }

  return result
}

async function handleSend(_, payload = {}) {
  const {
    devices,
    text,
    targets = ['ime'],
    clearBefore = false,
    paste = false,
  } = payload

  const deviceIds = toDeviceIds(devices)

  if (!deviceIds.length) {
    throw new Error('No device specified')
  }

  const settled = await Promise.allSettled(
    deviceIds.map(deviceId => sendToDevice(deviceId, { text, targets, clearBefore, paste })),
  )

  return settled.map((item, index) => {
    if (item.status === 'fulfilled') {
      return item.value
    }

    return {
      deviceId: deviceIds[index],
      ime: null,
      clipboard: null,
      error: item.reason?.message || String(item.reason),
    }
  })
}

export default {
  name: 'module:device-input:service',
  apply() {
    ipcMain.handle(CHANNELS.SEND, handleSend)

    ipcMain.handle(CHANNELS.KEYBOARD_INSTALLED, (_, deviceId) => {
      return adbKeyboard.isInstalled(deviceId)
    })

    ipcMain.handle(CHANNELS.KEYBOARD_INSTALL, (_, deviceId) => {
      return adbKeyboard.install(deviceId)
    })

    ipcMain.handle(CHANNELS.CLOSE_SESSION, (_, deviceId) => {
      return scrcpyControl.closeSession(deviceId)
    })

    return () => {
      scrcpyControl.closeAllSessions()

      Object.values(CHANNELS).forEach(channel => ipcMain.removeHandler(channel))
    }
  },
}
