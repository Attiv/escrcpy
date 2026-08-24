/**
 * @fileoverview Path memory module
 * Remembers the directory the explorer was last in, per device, so reopening
 * the window lands where the user left off instead of at the initial path
 */

import '../types.js'

/**
 * Path memory hook
 * @param {Object} options - Configuration options
 * @param {import('vue').Ref<string>} options.deviceId - Device ID for isolation
 * @returns {Object} Path memory manager instance
 */
export function usePathMemory({ deviceId }) {
  /** @type {typeof window.$preload.store} */
  const $store = window.$preload.store

  /** @type {import('vue').Ref<string|null>} Last visited path of the current device */
  const lastPath = ref(null)

  /** Get the store key for the current device */
  function getStoreKey() {
    return ['explorer', 'lastPath', deviceId.value]
  }

  /**
   * Load the remembered path from store
   * @returns {string|null} Remembered path, or null when there is none
   */
  function load() {
    if (!deviceId.value) {
      return null
    }

    try {
      const value = $store.get(getStoreKey())
      lastPath.value = typeof value === 'string' && value ? value : null
    }
    catch {
      lastPath.value = null
    }

    return lastPath.value
  }

  /**
   * Remember a path for the current device
   * @param {string} path - Path to remember
   */
  function save(path) {
    if (!deviceId.value || !path || path === lastPath.value) {
      return
    }

    lastPath.value = path

    try {
      $store.set(getStoreKey(), path)
    }
    catch (err) {
      console.error('[pathMemory] save failed:', err)
    }
  }

  /**
   * Forget the remembered path, used when it no longer resolves on the device
   */
  function clear() {
    lastPath.value = null

    if (!deviceId.value) {
      return
    }

    try {
      $store.set(getStoreKey(), null)
    }
    catch (err) {
      console.error('[pathMemory] clear failed:', err)
    }
  }

  return {
    lastPath: readonly(lastPath),
    load,
    save,
    clear,
  }
}

export default usePathMemory
