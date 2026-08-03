<template>
  <slot v-bind="{ loading }" :trigger="() => handleClick(device)" />

  <SendTextDialog v-if="sendTextLazy.visible" ref="sendTextDialogRef" />
</template>

<script setup>
import SendTextDialog from '$/components/send-text-dialog/index.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  device: {
    type: Object,
    default: null,
  },
})

const loading = ref(false)

const sendTextDialogRef = ref(null)
const sendTextLazy = useLazy()

async function handleClick(device) {
  await sendTextLazy.mount()

  sendTextDialogRef.value.open({
    devices: [device],
    onClosed() {
      sendTextLazy.unmount()
    },
  })
}
</script>

<style></style>
