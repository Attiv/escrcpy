<template>
  <el-dialog
    v-model="dialog.visible"
    :title="$t('device.control.sendText.name')"
    center
    width="560px"
    class="el-dialog--beautify"
    append-to-body
    destroy-on-close
    @closed="onClosed"
  >
    <el-form label-position="top">
      <el-form-item :label="$t('device.control.sendText.content')">
        <el-input
          ref="inputRef"
          v-model="model.text"
          type="textarea"
          :rows="5"
          resize="none"
          :placeholder="$t('device.control.sendText.placeholder')"
        />
      </el-form-item>

      <el-form-item :label="$t('device.control.sendText.target')">
        <el-checkbox-group v-model="model.targets">
          <el-checkbox value="ime">
            {{ $t('device.control.sendText.target.ime') }}
          </el-checkbox>
          <el-checkbox value="clipboard">
            {{ $t('device.control.sendText.target.clipboard') }}
          </el-checkbox>
        </el-checkbox-group>
      </el-form-item>

      <el-form-item>
        <div class="space-y-2">
          <el-checkbox
            v-model="model.clearBefore"
            :disabled="!model.targets.includes('ime')"
          >
            {{ $t('device.control.sendText.clearBefore') }}
          </el-checkbox>

          <el-checkbox
            v-model="model.paste"
            :disabled="!model.targets.includes('clipboard')"
          >
            {{ $t('device.control.sendText.paste') }}
          </el-checkbox>
        </div>
      </el-form-item>
    </el-form>

    <el-alert
      v-if="keyboardMissing"
      type="warning"
      show-icon
      :closable="false"
      class="!mb-2"
    >
      <template #title>
        <div class="flex items-center justify-between gap-2">
          <span>{{ $t('device.control.sendText.keyboard.missing') }}</span>

          <el-button
            type="primary"
            size="small"
            :loading="installing"
            @click="handleInstallKeyboard"
          >
            {{ $t('device.control.sendText.keyboard.install') }}
          </el-button>
        </div>
      </template>
    </el-alert>

    <div class="text-gray-400 text-xs">
      {{ $t('device.control.sendText.devices', { count: devices.length }) }}
    </div>

    <template #footer>
      <el-button @click="dialog.close()">
        {{ $t('common.cancel') }}
      </el-button>

      <el-button
        type="primary"
        :loading="dialog.loading"
        @click="handleSend"
      >
        {{ $t('device.control.sendText.send') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { clonePlainValue } from '$/utils/index.js'

const dialog = useDialog()

const inputRef = ref(null)
const devices = ref([])
const installing = ref(false)
const keyboardMissing = ref(false)

const model = ref({
  text: '',
  targets: ['ime'],
  clearBefore: false,
  paste: false,
})

const deviceIds = computed(() =>
  devices.value
    .map(item => (typeof item === 'string' ? item : item?.id))
    .filter(Boolean),
)

function open(args = {}) {
  dialog.open(args)

  devices.value = args.devices || (args.device ? [args.device] : [])
  keyboardMissing.value = false

  nextTick(() => inputRef.value?.focus?.())
}

function close() {
  dialog.close()
}

async function handleInstallKeyboard() {
  installing.value = true

  try {
    const results = await Promise.all(
      deviceIds.value.map(id =>
        window.$preload.ipcRenderer.invoke('device-input-keyboard-install', id),
      ),
    )

    if (results.every(Boolean)) {
      keyboardMissing.value = false
      ElMessage.success(window.t('device.control.sendText.keyboard.installed'))
    }
    else {
      ElMessage.error(window.t('device.control.sendText.keyboard.installFailed'))
    }
  }
  catch (error) {
    ElMessage.error(error.message)
  }
  finally {
    installing.value = false
  }
}

async function handleSend() {
  if (!model.value.text) {
    ElMessage.warning(window.t('device.control.sendText.required'))
    return
  }

  if (!model.value.targets.length) {
    ElMessage.warning(window.t('device.control.sendText.target.required'))
    return
  }

  dialog.loading = true

  try {
    // IPC 走结构化克隆，Vue 的响应式 Proxy 无法被克隆，必须先转成纯值
    const results = await window.$preload.ipcRenderer.invoke('device-input-send', clonePlainValue({
      devices: deviceIds.value,
      text: model.value.text,
      targets: model.value.targets,
      clearBefore: model.value.clearBefore,
      paste: model.value.paste,
    }))

    // 未安装 ADBKeyboard 是可修复的，单独提示并给出安装入口
    keyboardMissing.value = results.some(item => item.ime?.code === 'ADB_KEYBOARD_MISSING')

    const failures = results.filter(item =>
      item.error
      || item.ime?.success === false
      || item.clipboard?.success === false,
    )

    if (!failures.length) {
      ElMessage.success(window.t('device.control.sendText.success'))
      dialog.close()
      return
    }

    if (failures.length === results.length) {
      const reason = failures[0].error
        || failures[0].ime?.message
        || failures[0].clipboard?.message
      ElMessage.error(`${window.t('device.control.sendText.failed')}: ${reason}`)
      return
    }

    ElMessage.warning(
      window.t('device.control.sendText.partial', { count: failures.length }),
    )
  }
  catch (error) {
    ElMessage.error(error.message)
  }
  finally {
    dialog.loading = false
  }
}

function onClosed() {
  model.value.text = ''
  dialog.options?.onClosed?.()
}

defineExpose({
  open,
  close,
})
</script>

<style></style>
