<template>
  <section class="asset-reference" aria-label="参考素材" @click.stop @keydown.stop>
    <div class="reference-heading">
      <strong>参考素材</strong>
      <button class="btn btn-sm" :disabled="busy || loading || !!loadError || !dirty" @click="save">{{ busy ? '保存中…' : '保存参考设置' }}</button>
    </div>
    <p v-if="loading" class="dim">正在加载参考素材…</p>
    <p v-else-if="loadError" role="alert">{{ loadError }} <button class="btn btn-sm" @click="load">重试</button></p>
    <template v-else>
      <label class="reference-field">
        <span>基于已有{{ label }}调整</span>
        <select v-model="selected" class="input" :disabled="busy">
          <option :value="null">不使用参考（独立生成）</option>
          <option v-if="selected && !chosen" :value="selected" disabled>#{{ selected }}（参考素材已不可用）</option>
          <option v-for="item in candidates" :key="item.id" :value="item.id" :disabled="!item.image_url">
            #{{ item.id }} · {{ item.name }}{{ item.image_url ? '' : '（尚无图片）' }}
          </option>
        </select>
      </label>
      <div v-if="chosen?.image_url" class="reference-preview">
        <img :src="imageSrc(chosen.image_url)" :alt="chosen.name" />
        <span>参考 #{{ chosen.id }} · {{ chosen.name }}</span>
      </div>
      <label v-if="selected" class="reference-field">
        <span>状态调整说明</span>
        <textarea v-model="note" class="textarea" rows="3" maxlength="4000" :disabled="busy" :placeholder="placeholder" />
      </label>
      <p class="reference-hint">{{ dirty ? '参考设置尚未保存。请先保存，再生成图片。' : '参考设置已保存；单张和批量生图均会使用。' }}生成结果保存到当前素材，参考原图保留。</p>
      <p class="reference-hint">选择范围为本项目同类素材（包含其他剧集）。生成时使用参考素材的最新图片；状态调整说明优先于最终提示词中的冲突描述。</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { toast } from 'vue-sonner'

const props = defineProps<{ kind: 'character' | 'scene' | 'prop'; assetId: number }>()
type Candidate = { id: number; name: string; image_url: string | null }
const candidates = ref<Candidate[]>([])
const selected = ref<number | null>(null)
const note = ref('')
const saved = ref('')
const loading = ref(false)
const busy = ref(false)
const loadError = ref('')
const endpoint = computed(() => `/${({ character: 'characters', scene: 'scenes', prop: 'props' })[props.kind]}/${props.assetId}/reference`)
const snapshot = () => JSON.stringify([selected.value, note.value.trim()])
const dirty = computed(() => snapshot() !== saved.value)
const chosen = computed(() => candidates.value.find(item => item.id === selected.value))
const label = computed(() => ({ character: '角色', scene: '场景', prop: '道具 / 武器' })[props.kind])
const placeholder = computed(() => ({ character: '例如：保持同一张脸，换成战损铠甲，神情疲惫。', scene: '例如：保持建筑和空间布局，改为雨夜，地面积水。', prop: '例如：保持剑身与剑柄形制，增加裂痕和磨损。' })[props.kind])
const imageSrc = (url: string) => /^(https?:|data:|\/)/.test(url) ? url : `/${url}`

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await api.get<{ reference_asset_id: number | null; reference_note: string; candidates: Candidate[] }>(endpoint.value)
    candidates.value = result.candidates
    selected.value = result.reference_asset_id
    note.value = result.reference_note
    saved.value = snapshot()
  } catch { loadError.value = '参考素材加载失败，请重试。' }
  finally { loading.value = false }
}
async function save() {
  busy.value = true
  try {
    await api.put(endpoint.value, { reference_asset_id: selected.value, reference_note: note.value.trim() })
    saved.value = snapshot()
    toast.success('参考设置已保存，下次生图生效')
  } catch (error) { toastError(error) }
  finally { busy.value = false }
}
watch(() => [props.kind, props.assetId], load, { immediate: true })
</script>

<style scoped>
.asset-reference { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: 8px; min-width: 0; }
.reference-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
.reference-field { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.reference-field .input, .reference-field .textarea { width: 100%; }
.reference-preview { display: flex; align-items: center; gap: 12px; font-size: 12px; }
.reference-preview img { width: 96px; height: 72px; object-fit: contain; border: 1px solid var(--border); border-radius: 4px; }
.reference-hint { margin: 0; color: var(--text-3); font-size: 11px; line-height: 1.6; }
</style>
