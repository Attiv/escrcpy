import { extraResolve } from '$electron/process/resources.js'

export function getTrayPath() {
  switch (process.platform) {
    case 'win32':
      return extraResolve('win/tray/icon.png')
    case 'darwin':
      return extraResolve('mac/tray/iconTemplate.png')
    case 'linux':
      return extraResolve('linux/tray/icon.png')
    default:
      return ''
  }
}

export const trayPath = getTrayPath()

export const gnirehtetApkPath = extraResolve('common/gnirehtet/gnirehtet.apk')

export const adbKeyboardApkPath = extraResolve('common/adb-keyboard/ADBKeyboard.apk')

/** control-only 通道使用的 scrcpy server，版本须与 SERVER_VERSION 保持一致 */
export const scrcpyControlServerPath = extraResolve('common/wscrcpy/scrcpy-server')

export const localesDir = extraResolve('common/locales/')

export const yadbPath = extraResolve('common/yadb/yadb')
