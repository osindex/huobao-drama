<template>
  <label class="asset-image-model">
    <span>本次生图模型</span>
    <select class="input" :value="selectedKey" :disabled="disabled || loading" @change="selectModel">
      <option value="">{{ loading ? '正在加载模型…' : defaultLabel }}</option>
      <option v-for="option in options" :key="option.key" :value="option.key">{{ option.model }} · {{ option.configName }}</option>
    </select>
    <span v-if="loadError" role="alert">模型加载失败 <button type="button" class="btn btn-sm" @click.prevent="load">重试</button></span>
    <small>用于当前素材的生成／重新生成；已保存的参考素材仍会使用。</small>
  </label>
</template>

<script setup lang="ts">
import { aiConfigAPI } from '~/composables/useApi'
type Choice = { key: string; model: string; configId: number; configName: string }
const props = withDefaults(defineProps<{ modelValue: Choice | null; defaultLabel?: string; disabled?: boolean }>(), {
  defaultLabel: '沿用剧集图片配置', disabled: false,
})
const emit = defineEmits<{ 'update:modelValue': [value: Choice | null] }>()
const options = ref<Choice[]>([])
const loading = ref(false)
const loadError = ref(false)
const selectedKey = computed(() => props.modelValue?.key || '')
function selectModel(event: Event) {
  const key = (event.target as HTMLSelectElement).value
  emit('update:modelValue', options.value.find(option => option.key === key) || null)
}
async function load() {
  loading.value = true
  loadError.value = false
  try {
    const configs = await aiConfigAPI.list('image') as any[]
    options.value = configs.filter(c => c.is_active).sort((a, b) => (b.priority || 0) - (a.priority || 0)).flatMap(c => {
      let models = c.model
      if (typeof models === 'string') { try { models = JSON.parse(models) } catch { models = [models] } }
      if (!Array.isArray(models)) models = [models]
      return models.filter((m: unknown) => typeof m === 'string' && m).map((model: string) => ({
        key: `${c.id}/${model}`, model, configId: c.id, configName: c.name || c.provider,
      }))
    })
  } catch { loadError.value = true }
  finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.asset-image-model { display: flex; flex-direction: column; gap: 8px; padding: 16px; border: 1px solid var(--border); border-radius: 8px; font-size: 12px; }
.asset-image-model .input { width: 100%; }
.asset-image-model small { color: var(--text-3); line-height: 1.6; }
</style>
