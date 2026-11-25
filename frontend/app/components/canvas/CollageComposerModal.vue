<template>
  <Teleport to="body">
    <div v-if="open" class="cc-mask" @keydown.esc="emit('close')" tabindex="-1">
      <div class="cc-dialog" @click.stop>
        <!-- Header -->
        <header class="cc-head">
          <div class="cc-head-left">
            <span class="cc-badge">空间拼贴构图台</span>
            <h3 class="cc-title">
              镜头 #{{ String(shotNumber).padStart(2, '0') }} · {{ storyboard?.title || '未命名分镜' }}
            </h3>
            <span class="tag mono">{{ aspectRatio }} · {{ stageSize.w }}×{{ stageSize.h }}</span>
          </div>
          <div class="cc-head-tools">
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'is-tool-active': activeTool === 'select' }"
              @click="activeTool = 'select'"
            >
              移动/缩放图层
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'is-tool-active': activeTool === 'arrow' }"
              @click="activeTool = 'arrow'"
              title="在画面上拖拽绘制角色走位或运镜方向箭头"
            >
              走位/运镜箭头
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'is-tool-active': activeTool === 'brush' }"
              @click="activeTool = 'brush'"
              title="自由涂鸦局部光影或动作标注"
            >
              涂鸦画笔
            </button>
            <div v-if="activeTool !== 'select'" class="cc-color-picks">
              <button
                v-for="c in strokeColors"
                :key="c"
                type="button"
                class="cc-color-dot"
                :class="{ on: strokeColor === c }"
                :style="{ background: c }"
                @click="strokeColor = c"
              />
            </div>
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'is-tool-active': showGrid }"
              @click="showGrid = !showGrid"
            >
              三分构图线
            </button>
            <button
              v-if="strokes.length"
              type="button"
              class="btn btn-sm"
              @click="undoStroke"
            >
              撤销标注
            </button>
            <button
              v-if="strokes.length"
              type="button"
              class="btn btn-sm"
              @click="strokes = []"
            >
              清空标注
            </button>
          </div>
          <button type="button" class="btn btn-icon btn-sm" @click="emit('close')">✕</button>
        </header>

        <div class="cc-body">
          <!-- Left: Asset Palette -->
          <aside class="cc-palette">
            <div class="cc-palette-head">
              <span>可用素材图层</span>
              <button type="button" class="btn btn-sm" @click="uploadCustomLayer">+ 本地图片</button>
            </div>

            <div class="cc-palette-scroll">
              <!-- Quick auto-populate -->
              <button
                type="button"
                class="btn btn-sm cc-auto-fill-btn"
                @click="populateBoundAssets"
              >
                一键载入本镜已绑定素材
              </button>

              <div class="cc-group">
                <div class="cc-group-label">场景底图（点击设为背景）</div>
                <div v-if="readyScenes.length" class="cc-asset-grid">
                  <button
                    v-for="s in readyScenes"
                    :key="'sc-' + s.id"
                    type="button"
                    class="cc-asset-card"
                    :class="{ active: backdropUrl === mediaUrl(s.image_url || s.imageUrl) }"
                    @click="setBackdrop(mediaUrl(s.image_url || s.imageUrl), s.location)"
                  >
                    <img :src="mediaUrl(s.image_url || s.imageUrl)" :alt="s.location" crossorigin="anonymous" />
                    <span>{{ s.location }}</span>
                  </button>
                </div>
                <div v-else class="cc-empty-hint">暂无已生图的场景</div>
              </div>

              <div class="cc-group">
                <div class="cc-group-label">角色立绘（点击上台摆位，支持三视图裁切）</div>
                <div v-if="readyChars.length" class="cc-asset-grid">
                  <button
                    v-for="c in readyChars"
                    :key="'ch-' + c.id"
                    type="button"
                    class="cc-asset-card"
                    @click="addAssetLayer('character', c.name, mediaUrl(c.image_url || c.imageUrl), c.id)"
                  >
                    <img :src="mediaUrl(c.image_url || c.imageUrl)" :alt="c.name" crossorigin="anonymous" />
                    <span>{{ c.name }}</span>
                  </button>
                </div>
                <div v-else class="cc-empty-hint">暂无已生图的角色</div>
              </div>

              <div class="cc-group">
                <div class="cc-group-label">道具与现有关键帧</div>
                <div class="cc-asset-grid">
                  <button
                    v-for="p in readyProps"
                    :key="'pr-' + p.id"
                    type="button"
                    class="cc-asset-card"
                    @click="addAssetLayer('prop', p.name, mediaUrl(p.image_url || p.imageUrl), p.id)"
                  >
                    <img :src="mediaUrl(p.image_url || p.imageUrl)" :alt="p.name" crossorigin="anonymous" />
                    <span>{{ p.name }}</span>
                  </button>
                  <button
                    v-if="storyboard?.first_frame_image || storyboard?.firstFrameImage"
                    type="button"
                    class="cc-asset-card"
                    @click="setBackdrop(mediaUrl(storyboard.first_frame_image || storyboard.firstFrameImage), '当前首帧')"
                  >
                    <img :src="mediaUrl(storyboard.first_frame_image || storyboard.firstFrameImage)" alt="当前首帧" crossorigin="anonymous" />
                    <span>当前首帧(设为底图)</span>
                  </button>
                  <button
                    v-if="storyboard?.last_frame_image || storyboard?.lastFrameImage"
                    type="button"
                    class="cc-asset-card"
                    @click="setBackdrop(mediaUrl(storyboard.last_frame_image || storyboard.lastFrameImage), '当前尾帧')"
                  >
                    <img :src="mediaUrl(storyboard.last_frame_image || storyboard.lastFrameImage)" alt="当前尾帧" crossorigin="anonymous" />
                    <span>当前尾帧(设为底图)</span>
                  </button>
                </div>
              </div>
            </div>
          </aside>

          <!-- Center: Interactive Stage -->
          <main class="cc-stage-wrap" ref="stageWrapRef">
            <div
              ref="stageElRef"
              class="cc-stage"
              :style="stageBoxStyle"
              @pointerdown="onStagePointerDown"
            >
              <!-- Backdrop -->
              <img
                v-if="backdropUrl"
                :src="backdropUrl"
                class="cc-backdrop-img"
                crossorigin="anonymous"
                draggable="false"
              />
              <div v-else class="cc-backdrop-placeholder">
                <span>点击左侧场景设为空镜底图，或直接拖放角色/道具排布空间站位</span>
              </div>

              <!-- Placed Sprite Layers -->
              <div
                v-for="layer in layers"
                :key="layer.uid"
                class="cc-layer"
                :class="{
                  selected: selectedLayerUid === layer.uid && activeTool === 'select',
                  'is-passthrough': activeTool !== 'select',
                }"
                :style="layerCssStyle(layer)"
                @pointerdown.stop="onLayerPointerDown($event, layer)"
              >
                <div class="cc-layer-crop-box" :style="{ opacity: layer.opacity }">
                  <img
                    :src="layer.url"
                    :style="layerImgCropStyle(layer)"
                    crossorigin="anonymous"
                    draggable="false"
                  />
                </div>
                <span v-if="selectedLayerUid === layer.uid && activeTool === 'select'" class="cc-layer-tag">
                  {{ layer.label }}
                </span>
                <div
                  v-if="selectedLayerUid === layer.uid && activeTool === 'select'"
                  class="cc-resize-handle"
                  title="拖拽缩放"
                  @pointerdown.stop="onLayerResizeDown($event, layer)"
                />
              </div>

              <!-- Annotation SVG Overlay (Arrows & Brush) -->
              <svg
                class="cc-sketch-svg"
                :viewBox="`0 0 ${stageSize.w} ${stageSize.h}`"
                preserveAspectRatio="none"
              >
                <defs>
                  <marker
                    v-for="c in strokeColors"
                    :key="'mk-' + c"
                    :id="'cc-arrow-' + c.replace('#', '')"
                    markerWidth="10"
                    markerHeight="10"
                    refX="8"
                    refY="5"
                    orient="auto"
                  >
                    <path d="M0,1 L9,5 L0,9 Z" :fill="c" />
                  </marker>
                </defs>
                <template v-for="(s, idx) in allPreviewStrokes" :key="idx">
                  <line
                    v-if="s.type === 'arrow' && s.points.length >= 2"
                    :x1="s.points[0].x"
                    :y1="s.points[0].y"
                    :x2="s.points[s.points.length - 1].x"
                    :y2="s.points[s.points.length - 1].y"
                    :stroke="s.color"
                    :stroke-width="s.width"
                    stroke-linecap="round"
                    :marker-end="`url(#cc-arrow-${s.color.replace('#', '')})`"
                  />
                  <polyline
                    v-else-if="s.type === 'brush' && s.points.length >= 2"
                    :points="s.points.map(p => `${p.x},${p.y}`).join(' ')"
                    fill="none"
                    :stroke="s.color"
                    :stroke-width="s.width"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </template>
              </svg>

              <!-- Rule of Thirds Grid -->
              <div v-if="showGrid" class="cc-thirds-grid" aria-hidden="true">
                <i class="v1" /><i class="v2" /><i class="h1" /><i class="h2" />
              </div>
            </div>
          </main>

          <!-- Right: Layer Inspector & Output Actions -->
          <aside class="cc-inspector">
            <!-- Selected Layer Controls -->
            <section v-if="selectedLayer" class="cc-panel-sec">
              <div class="cc-sec-head">
                <strong>当前图层：{{ selectedLayer.label }}</strong>
                <button type="button" class="btn btn-sm cc-danger-link" @click="removeLayer(selectedLayer.uid)">移除</button>
              </div>

              <div v-if="selectedLayer.kind === 'character'" class="cc-crop-row">
                <span class="cc-field-label">三视图快速裁切</span>
                <div class="cc-crop-pills">
                  <button
                    v-for="opt in CROP_PRESETS"
                    :key="opt.id"
                    type="button"
                    class="cc-pill"
                    :class="{ on: selectedLayer.crop === opt.id }"
                    @click="applyCropPreset(selectedLayer, opt.id)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>

              <div class="cc-control-grid">
                <label class="cc-slider-field">
                  <span>缩放 ({{ Math.round(selectedLayer.scale * 100) }}%)</span>
                  <input type="range" min="0.15" max="2.4" step="0.05" v-model.number="selectedLayer.scale" />
                </label>
                <label class="cc-slider-field">
                  <span>旋转 ({{ selectedLayer.rotation }}°)</span>
                  <input type="range" min="-90" max="90" step="1" v-model.number="selectedLayer.rotation" />
                </label>
                <label class="cc-slider-field">
                  <span>不透明度 ({{ Math.round(selectedLayer.opacity * 100) }}%)</span>
                  <input type="range" min="0.2" max="1" step="0.05" v-model.number="selectedLayer.opacity" />
                </label>
              </div>

              <div class="cc-layer-btns">
                <button type="button" class="btn btn-sm" @click="selectedLayer.flipX = !selectedLayer.flipX">
                  ↔ 水平镜像
                </button>
                <button type="button" class="btn btn-sm" @click="moveLayerOrder(selectedLayer.uid, 1)">
                  ↑ 上移一层
                </button>
                <button type="button" class="btn btn-sm" @click="moveLayerOrder(selectedLayer.uid, -1)">
                  ↓ 下移一层
                </button>
              </div>
            </section>

            <section v-else class="cc-panel-sec cc-sec-muted">
              <div class="cc-sec-head"><strong>图层属性</strong></div>
              <p class="cc-hint">点击画布中的角色/道具图层可调整站位、镜像朝向、三视图单视角裁切与景深大小。</p>
              <button v-if="backdropUrl" type="button" class="btn btn-sm" @click="backdropUrl = ''">清除背景底图</button>
            </section>

            <!-- Output & AI Keyframe Fusion -->
            <section class="cc-panel-sec cc-output-sec">
              <div class="cc-sec-head">
                <strong>输出目标槽位</strong>
              </div>
              <div class="cc-slot-tabs">
                <button
                  type="button"
                  class="cc-slot-tab"
                  :class="{ on: targetSlot === 'first_frame' }"
                  @click="targetSlot = 'first_frame'"
                >
                  设为首帧
                </button>
                <button
                  type="button"
                  class="cc-slot-tab"
                  :class="{ on: targetSlot === 'last_frame' }"
                  @click="targetSlot = 'last_frame'"
                >
                  设为尾帧
                </button>
                <button
                  type="button"
                  class="cc-slot-tab"
                  :class="{ on: targetSlot === 'composed' }"
                  @click="targetSlot = 'composed'"
                >
                  仅存构图底图
                </button>
              </div>

              <label class="cc-prompt-field">
                <span>AI 精绘融合指令（光影统一 / 消除拼贴边缘 / 遵循箭头动作）</span>
                <textarea
                  v-model="refinePrompt"
                  rows="5"
                  class="textarea"
                  placeholder="描述该关键帧的画面细节、人物动作表情、镜头景别与光影氛围..."
                />
              </label>

              <label v-if="strokes.length" class="cc-check-row">
                <input type="checkbox" v-model="bakeAnnotations" />
                <span>把走位箭头/画笔标注一并压入参考图（供多模态生图理解方向）</span>
              </label>

              <div class="cc-submit-stack">
                <button
                  type="button"
                  class="btn btn-primary cc-btn-full"
                  :disabled="submitting"
                  @click="handleAiRefine"
                >
                  <Loader2 v-if="submitting === 'ai'" :size="13" class="animate-spin" />
                  ✨ AI 精绘融合为{{ slotName }}
                </button>
                <button
                  type="button"
                  class="btn cc-btn-full"
                  :disabled="submitting"
                  @click="handleDirectSave"
                >
                  <Loader2 v-if="submitting === 'direct'" :size="13" class="animate-spin" />
                  📌 直接保存拼贴图为{{ slotName }}（免算力）
                </button>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { uploadAPI, storyboardAPI, taskAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

interface SpriteLayer {
  uid: string
  kind: 'character' | 'prop' | 'custom'
  assetId?: number
  label: string
  url: string
  x: number // center X in stage coordinates
  y: number // center Y in stage coordinates
  baseW: number
  baseH: number
  scale: number
  rotation: number
  flipX: boolean
  opacity: number
  crop: 'full' | 'front' | 'side' | 'back' | 'bust'
}

interface SketchStroke {
  type: 'arrow' | 'brush'
  color: string
  width: number
  points: Array<{ x: number; y: number }>
}

const props = defineProps<{
  open: boolean
  storyboard: any | null
  shotNumber: number
  dramaId: number
  aspectRatio: string
  scenes: any[]
  characters: any[]
  propsList: any[]
  initialSlot?: 'first_frame' | 'last_frame' | 'composed'
  imageModel?: string
  imageConfigId?: number
  imageProvider?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', payload: { storyboardId: number; slot: string; path: string; taskId?: number }): void
}>()

const CROP_PRESETS = [
  { id: 'front' as const, label: '正面(左1/3)' },
  { id: 'side' as const, label: '侧面(中1/3)' },
  { id: 'back' as const, label: '背面(右1/3)' },
  { id: 'bust' as const, label: '正面半身' },
  { id: 'full' as const, label: '完整原图' },
]

const strokeColors = ['#f97316', '#ef4444', '#22d3ee', '#facc15', '#ffffff']
const activeTool = ref<'select' | 'arrow' | 'brush'>('select')
const strokeColor = ref('#f97316')
const showGrid = ref(true)
const bakeAnnotations = ref(true)

const backdropUrl = ref('')
const layers = ref<SpriteLayer[]>([])
const selectedLayerUid = ref<string | null>(null)
const strokes = ref<SketchStroke[]>([])
const drawingStroke = ref<SketchStroke | null>(null)

const targetSlot = ref<'first_frame' | 'last_frame' | 'composed'>('first_frame')
const refinePrompt = ref('')
const submitting = ref<'' | 'ai' | 'direct'>('')

const stageWrapRef = ref<HTMLElement | null>(null)
const stageElRef = ref<HTMLElement | null>(null)

const stageSize = computed(() => {
  const r = props.aspectRatio || '16:9'
  if (r === '9:16') return { w: 720, h: 1280 }
  if (r === '1:1') return { w: 1024, h: 1024 }
  if (r === '4:3') return { w: 1280, h: 960 }
  if (r === '3:4') return { w: 960, h: 1280 }
  return { w: 1280, h: 720 }
})

const stageScale = ref(0.55)
function recomputeStageScale() {
  const wrap = stageWrapRef.value
  if (!wrap) return
  const availW = Math.max(320, wrap.clientWidth - 40)
  const availH = Math.max(260, wrap.clientHeight - 40)
  stageScale.value = Math.min(1, availW / stageSize.value.w, availH / stageSize.value.h)
}

const stageBoxStyle = computed(() => ({
  width: `${Math.round(stageSize.value.w * stageScale.value)}px`,
  height: `${Math.round(stageSize.value.h * stageScale.value)}px`,
}))

const slotName = computed(() => {
  if (targetSlot.value === 'first_frame') return '首帧'
  if (targetSlot.value === 'last_frame') return '尾帧'
  return '构图草图'
})

function mediaUrl(raw?: string | null): string {
  if (!raw) return ''
  if (/^(https?:\/\/|data:|blob:)/i.test(raw)) return raw
  return raw.startsWith('/') ? raw : `/${raw}`
}

const readyScenes = computed(() => (props.scenes || []).filter(s => s.image_url || s.imageUrl))
const readyChars = computed(() => (props.characters || []).filter(c => c.image_url || c.imageUrl))
const readyProps = computed(() => (props.propsList || []).filter(p => p.image_url || p.imageUrl))

const selectedLayer = computed(() => layers.value.find(l => l.uid === selectedLayerUid.value) || null)
const allPreviewStrokes = computed(() => drawingStroke.value ? [...strokes.value, drawingStroke.value] : strokes.value)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen || !props.storyboard) return
    targetSlot.value = props.initialSlot || 'first_frame'
    strokes.value = []
    layers.value = []
    selectedLayerUid.value = null
    activeTool.value = 'select'
    const sb = props.storyboard
    const baseDesc = sb.image_prompt || sb.imagePrompt || sb.description || sb.video_prompt || sb.videoPrompt || ''
    refinePrompt.value = targetSlot.value === 'last_frame'
      ? `电影级分镜尾帧定格画面，严格参考构图底图的空间站位与人物外观服饰：${baseDesc}`
      : `电影级分镜首帧画面，严格参考构图底图的空间站位、透视与人物外观服饰，消除拼贴痕迹并统一场景环境光影：${baseDesc}`
    populateBoundAssets()
    setTimeout(recomputeStageScale, 40)
  },
)

function setBackdrop(url: string, _label?: string) {
  backdropUrl.value = url
}

function loadNaturalSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve({ w: img.naturalWidth || 512, h: img.naturalHeight || 512 })
    img.onerror = () => resolve({ w: 512, h: 512 })
    img.src = url
  })
}

function getCropRectNormalized(crop: SpriteLayer['crop']) {
  if (crop === 'front') return { sx: 0, sy: 0, sw: 0.334, sh: 1 }
  if (crop === 'side') return { sx: 0.333, sy: 0, sw: 0.334, sh: 1 }
  if (crop === 'back') return { sx: 0.666, sy: 0, sw: 0.334, sh: 1 }
  if (crop === 'bust') return { sx: 0, sy: 0, sw: 0.334, sh: 0.56 }
  return { sx: 0, sy: 0, sw: 1, sh: 1 }
}

async function addAssetLayer(kind: SpriteLayer['kind'], label: string, url: string, assetId?: number, xRatio = 0.5, yRatio = 0.6) {
  if (!url) return
  const nat = await loadNaturalSize(url)
  // 角色三视图通常是横向宽图，默认裁切正面左 1/3 上台，用户可一键切侧面/背面/完整
  const defaultCrop: SpriteLayer['crop'] = kind === 'character' && nat.w / Math.max(1, nat.h) > 1.25 ? 'front' : 'full'
  const rect = getCropRectNormalized(defaultCrop)
  const croppedAspect = (nat.w * rect.sw) / Math.max(1, nat.h * rect.sh)
  const targetH = kind === 'prop' ? stageSize.value.h * 0.28 : stageSize.value.h * 0.68
  const targetW = targetH * croppedAspect

  const uid = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  layers.value.push({
    uid,
    kind,
    assetId,
    label,
    url,
    x: Math.round(stageSize.value.w * xRatio),
    y: Math.round(stageSize.value.h * yRatio),
    baseW: Math.round(targetW),
    baseH: Math.round(targetH),
    scale: 1,
    rotation: 0,
    flipX: false,
    opacity: 1,
    crop: defaultCrop,
  })
  selectedLayerUid.value = uid
  activeTool.value = 'select'
}

async function applyCropPreset(layer: SpriteLayer, preset: SpriteLayer['crop']) {
  const nat = await loadNaturalSize(layer.url)
  const rect = getCropRectNormalized(preset)
  const croppedAspect = (nat.w * rect.sw) / Math.max(1, nat.h * rect.sh)
  layer.crop = preset
  layer.baseW = Math.round(layer.baseH * croppedAspect)
}

async function populateBoundAssets() {
  const sb = props.storyboard
  if (!sb) return
  layers.value = []
  const existingComposed = sb.composed_image || sb.composedImage
  const sceneId = sb.scene_id ?? sb.sceneId
  const boundScene = readyScenes.value.find(s => s.id === sceneId)
  if (boundScene) {
    backdropUrl.value = mediaUrl(boundScene.image_url || boundScene.imageUrl)
  } else if (existingComposed) {
    backdropUrl.value = mediaUrl(existingComposed)
  } else if (readyScenes.value[0]) {
    backdropUrl.value = mediaUrl(readyScenes.value[0].image_url || readyScenes.value[0].imageUrl)
  } else {
    backdropUrl.value = ''
  }

  const charIds: number[] = sb.character_ids || sb.characterIds || []
  const sbChars = readyChars.value.filter(c => charIds.includes(c.id))
  for (let i = 0; i < sbChars.length; i++) {
    const ratioX = sbChars.length === 1 ? 0.5 : 0.3 + (i / Math.max(1, sbChars.length - 1)) * 0.4
    await addAssetLayer('character', sbChars[i].name, mediaUrl(sbChars[i].image_url || sbChars[i].imageUrl), sbChars[i].id, ratioX, 0.62)
  }

  const propIds: number[] = sb.prop_ids || sb.propIds || []
  const sbProps = readyProps.value.filter(p => propIds.includes(p.id))
  for (let i = 0; i < sbProps.length; i++) {
    await addAssetLayer('prop', sbProps[i].name, mediaUrl(sbProps[i].image_url || sbProps[i].imageUrl), sbProps[i].id, 0.68 + i * 0.08, 0.72)
  }
}

function layerCssStyle(layer: SpriteLayer) {
  const s = stageScale.value
  const w = layer.baseW * layer.scale * s
  const h = layer.baseH * layer.scale * s
  const left = layer.x * s - w / 2
  const top = layer.y * s - h / 2
  return {
    width: `${w}px`,
    height: `${h}px`,
    left: `${left}px`,
    top: `${top}px`,
    transform: `rotate(${layer.rotation}deg)`,
  }
}

function layerImgCropStyle(layer: SpriteLayer) {
  const rect = getCropRectNormalized(layer.crop)
  const widthPct = (1 / rect.sw) * 100
  const heightPct = (1 / rect.sh) * 100
  const leftPct = -(rect.sx / rect.sw) * 100
  const topPct = -(rect.sy / rect.sh) * 100
  return {
    width: `${widthPct}%`,
    height: `${heightPct}%`,
    left: `${leftPct}%`,
    top: `${topPct}%`,
    transform: layer.flipX ? 'scaleX(-1)' : 'none',
  }
}

function stagePointFromEvent(e: PointerEvent) {
  const el = stageElRef.value
  if (!el) return { x: 0, y: 0 }
  const rect = el.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(stageSize.value.w, (e.clientX - rect.left) / stageScale.value)),
    y: Math.max(0, Math.min(stageSize.value.h, (e.clientY - rect.top) / stageScale.value)),
  }
}

function onLayerPointerDown(e: PointerEvent, layer: SpriteLayer) {
  if (activeTool.value !== 'select') return
  selectedLayerUid.value = layer.uid
  const startX = e.clientX
  const startY = e.clientY
  const origX = layer.x
  const origY = layer.y
  const onMove = (ev: PointerEvent) => {
    layer.x = Math.round(origX + (ev.clientX - startX) / stageScale.value)
    layer.y = Math.round(origY + (ev.clientY - startY) / stageScale.value)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onLayerResizeDown(e: PointerEvent, layer: SpriteLayer) {
  const startY = e.clientY
  const startX = e.clientX
  const origScale = layer.scale
  const onMove = (ev: PointerEvent) => {
    const delta = ((ev.clientX - startX) + (ev.clientY - startY)) / (260 * stageScale.value)
    layer.scale = Math.min(2.6, Math.max(0.15, Number((origScale + delta).toFixed(2))))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onStagePointerDown(e: PointerEvent) {
  if (activeTool.value === 'select') {
    selectedLayerUid.value = null
    return
  }
  const pt = stagePointFromEvent(e)
  const stroke: SketchStroke = {
    type: activeTool.value === 'arrow' ? 'arrow' : 'brush',
    color: strokeColor.value,
    width: activeTool.value === 'arrow' ? 6 : 5,
    points: [pt, pt],
  }
  drawingStroke.value = stroke
  const onMove = (ev: PointerEvent) => {
    const nextPt = stagePointFromEvent(ev)
    if (stroke.type === 'arrow') {
      stroke.points = [stroke.points[0], nextPt]
    } else {
      stroke.points.push(nextPt)
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (drawingStroke.value) {
      strokes.value.push(drawingStroke.value)
      drawingStroke.value = null
    }
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function undoStroke() {
  strokes.value.pop()
}

function removeLayer(uid: string) {
  layers.value = layers.value.filter(l => l.uid !== uid)
  if (selectedLayerUid.value === uid) selectedLayerUid.value = null
}

function moveLayerOrder(uid: string, delta: number) {
  const idx = layers.value.findIndex(l => l.uid === uid)
  const target = idx + delta
  if (idx < 0 || target < 0 || target >= layers.value.length) return
  const copy = [...layers.value]
  const [item] = copy.splice(idx, 1)
  copy.splice(target, 0, item)
  layers.value = copy
}

function uploadCustomLayer() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    try {
      const res = await uploadAPI.image(f)
      await addAssetLayer('custom', f.name.replace(/\.[^.]+$/, ''), mediaUrl(res.path))
    } catch (err) {
      toastError(err)
    }
  }
  input.click()
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`))
    img.src = src
  })
}

async function renderCompositeBlob(includeAnnotations: boolean): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = stageSize.value.w
  canvas.height = stageSize.value.h
  const ctx = canvas.getContext('2d')!

  // 1. Dark cinema base
  ctx.fillStyle = '#14161a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // 2. Backdrop (object-fit: cover)
  if (backdropUrl.value) {
    const bgImg = await loadImageElement(backdropUrl.value)
    const scale = Math.max(canvas.width / bgImg.naturalWidth, canvas.height / bgImg.naturalHeight)
    const dw = bgImg.naturalWidth * scale
    const dh = bgImg.naturalHeight * scale
    ctx.drawImage(bgImg, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
  }

  // 3. Sprite layers
  for (const layer of layers.value) {
    const img = await loadImageElement(layer.url)
    const rect = getCropRectNormalized(layer.crop)
    const sx = img.naturalWidth * rect.sx
    const sy = img.naturalHeight * rect.sy
    const sw = img.naturalWidth * rect.sw
    const sh = img.naturalHeight * rect.sh
    const dw = layer.baseW * layer.scale
    const dh = layer.baseH * layer.scale

    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.translate(layer.x, layer.y)
    ctx.rotate((layer.rotation * Math.PI) / 180)
    if (layer.flipX) ctx.scale(-1, 1)
    ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()
  }

  // 4. Optional director sketch annotations
  if (includeAnnotations && strokes.value.length) {
    for (const s of strokes.value) {
      if (s.points.length < 2) continue
      ctx.save()
      ctx.strokeStyle = s.color
      ctx.fillStyle = s.color
      ctx.lineWidth = s.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (s.type === 'arrow') {
        const p0 = s.points[0]
        const p1 = s.points[s.points.length - 1]
        ctx.beginPath()
        ctx.moveTo(p0.x, p0.y)
        ctx.lineTo(p1.x, p1.y)
        ctx.stroke()
        const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x)
        const headLen = 22
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p1.x - headLen * Math.cos(angle - Math.PI / 6), p1.y - headLen * Math.sin(angle - Math.PI / 6))
        ctx.lineTo(p1.x - headLen * Math.cos(angle + Math.PI / 6), p1.y - headLen * Math.sin(angle + Math.PI / 6))
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.moveTo(s.points[0].x, s.points[0].y)
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('拼贴画布导出失败'))
    }, 'image/jpeg', 0.92)
  })
}

async function handleDirectSave() {
  if (!props.storyboard) return
  if (!backdropUrl.value && !layers.value.length) {
    toast.error('请先放入场景或角色素材再保存')
    return
  }
  submitting.value = 'direct'
  try {
    const blob = await renderCompositeBlob(false)
    const file = new File([blob], `shot-${props.shotNumber}-collage.jpg`, { type: 'image/jpeg' })
    const uploaded = await uploadAPI.image(file)
    const updatePayload: Record<string, any> = { composed_image: uploaded.path }
    if (targetSlot.value === 'first_frame') updatePayload.first_frame_image = uploaded.path
    if (targetSlot.value === 'last_frame') updatePayload.last_frame_image = uploaded.path
    await storyboardAPI.update(props.storyboard.id, updatePayload)
    toast.success(`已保存拼贴构图为${slotName.value}`)
    emit('saved', { storyboardId: props.storyboard.id, slot: targetSlot.value, path: uploaded.path })
    emit('close')
  } catch (err) {
    toastError(err)
  } finally {
    submitting.value = ''
  }
}

async function handleAiRefine() {
  if (!props.storyboard) return
  if (!backdropUrl.value && !layers.value.length) {
    toast.error('请先在舞台放置背景或角色图层')
    return
  }
  if (!refinePrompt.value.trim()) {
    toast.error('请填写关键帧画面指令')
    return
  }
  submitting.value = 'ai'
  try {
    const blob = await renderCompositeBlob(bakeAnnotations.value && strokes.value.length > 0)
    const file = new File([blob], `shot-${props.shotNumber}-collage-ref.jpg`, { type: 'image/jpeg' })
    const uploaded = await uploadAPI.image(file)
    await storyboardAPI.update(props.storyboard.id, { composed_image: uploaded.path })

    // 组合参考图：第 1 张为空间拼贴底图（锁死机位与左右站位），再附带最多 2 张角色原始设定图锁死五官服装（严守本地模型 3 图上限）
    const refUrls: string[] = [uploaded.path]
    const charAssetIds = [...new Set(layers.value.filter(l => l.kind === 'character' && l.assetId).map(l => l.assetId!))]
    for (const cid of charAssetIds) {
      if (refUrls.length >= 3) break
      const ch = readyChars.value.find(c => c.id === cid)
      const raw = ch?.image_url || ch?.imageUrl
      if (raw && !refUrls.includes(raw)) refUrls.push(raw)
    }

    const arrowNote = bakeAnnotations.value && strokes.value.length
      ? '（注意：参考图中的彩色箭头/线条仅代表运动方向与视线引导，最终生成画面中严禁保留任何彩色箭头或涂鸦文字标记）'
      : ''

    const task = await taskAPI.generate({
      type: 'image',
      storyboard_id: props.storyboard.id,
      drama_id: props.dramaId,
      frame_type: targetSlot.value === 'composed' ? undefined : targetSlot.value,
      size: `${stageSize.value.w}x${stageSize.value.h}`,
      reference_images: refUrls,
      model: props.imageModel || undefined,
      config_id: props.imageConfigId || undefined,
      prompt: `${refinePrompt.value.trim()}${arrowNote}`,
    })

    toast.success(`已提交 AI 精绘融合${slotName.value}任务`)
    emit('saved', { storyboardId: props.storyboard.id, slot: targetSlot.value, path: uploaded.path, taskId: task?.id })
    emit('close')
  } catch (err) {
    toastError(err)
  } finally {
    submitting.value = ''
  }
}
</script>

<style scoped>
.cc-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(10, 12, 16, 0.72);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
}

.cc-dialog {
  width: min(1420px, 96vw);
  height: min(880px, 92vh);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg, 14px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.36);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-0);
  flex-shrink: 0;
}

.cc-head-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.cc-badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--accent-bg);
  color: var(--accent-text);
}

.cc-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cc-head-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.is-tool-active {
  background: var(--text-0) !important;
  color: var(--bg-1) !important;
  border-color: var(--text-0) !important;
}

.cc-color-picks {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
}

.cc-color-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.65);
  cursor: pointer;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
}
.cc-color-dot.on {
  transform: scale(1.22);
  box-shadow: 0 0 0 2px var(--text-0);
}

.cc-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 260px 1fr 310px;
}

.cc-palette {
  border-right: 1px solid var(--border);
  background: var(--bg-0);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.cc-palette-head {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
}

.cc-palette-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cc-auto-fill-btn {
  width: 100%;
  justify-content: center;
}

.cc-group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 6px;
}

.cc-asset-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.cc-asset-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-1);
  padding: 4px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  transition: border-color 0.15s, transform 0.12s;
}
.cc-asset-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.cc-asset-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.cc-asset-card img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 5px;
  background: var(--bg-2);
}
.cc-asset-card span {
  font-size: 11px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cc-empty-hint {
  font-size: 11px;
  color: var(--text-3);
  padding: 8px;
  background: var(--bg-2);
  border-radius: 6px;
}

.cc-stage-wrap {
  background: radial-gradient(circle at center, #22262e 0%, #14161b 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  user-select: none;
}

.cc-stage {
  position: relative;
  background: #101216;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.cc-backdrop-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.cc-backdrop-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  color: rgba(255, 255, 255, 0.42);
  font-size: 13px;
  pointer-events: none;
}

.cc-layer {
  position: absolute;
  cursor: grab;
  transform-origin: center center;
}
.cc-layer:active {
  cursor: grabbing;
}
.cc-layer.is-passthrough {
  pointer-events: none;
}
.cc-layer.selected {
  outline: 2px solid #f97316;
  box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.2);
}

.cc-layer-crop-box {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}
.cc-layer-crop-box img {
  position: absolute;
  max-width: none;
  object-fit: cover;
  pointer-events: none;
}

.cc-layer-tag {
  position: absolute;
  top: -22px;
  left: 0;
  background: #f97316;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
}

.cc-resize-handle {
  position: absolute;
  right: -7px;
  bottom: -7px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ffffff;
  border: 2.5px solid #f97316;
  cursor: nwse-resize;
}

.cc-sketch-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.cc-thirds-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.cc-thirds-grid i {
  position: absolute;
  background: rgba(255, 255, 255, 0.18);
}
.cc-thirds-grid .v1 { top: 0; bottom: 0; left: 33.333%; width: 1px; }
.cc-thirds-grid .v2 { top: 0; bottom: 0; left: 66.666%; width: 1px; }
.cc-thirds-grid .h1 { left: 0; right: 0; top: 33.333%; height: 1px; }
.cc-thirds-grid .h2 { left: 0; right: 0; top: 66.666%; height: 1px; }

.cc-inspector {
  border-left: 1px solid var(--border);
  background: var(--bg-0);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.cc-panel-sec {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cc-output-sec {
  margin-top: auto;
  border-bottom: none;
}

.cc-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-0);
}

.cc-danger-link {
  color: #ef4444;
}

.cc-field-label {
  font-size: 11px;
  color: var(--text-2);
  display: block;
  margin-bottom: 5px;
}

.cc-crop-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.cc-pill {
  font-size: 11px;
  padding: 3px 7px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-1);
  cursor: pointer;
}
.cc-pill.on {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

.cc-control-grid {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.cc-slider-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--text-2);
}
.cc-slider-field input[type='range'] {
  width: 100%;
  accent-color: var(--accent);
}

.cc-layer-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cc-hint {
  font-size: 11px;
  line-height: 1.55;
  color: var(--text-3);
}

.cc-slot-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  background: var(--bg-2);
  padding: 3px;
  border-radius: 8px;
}

.cc-slot-tab {
  padding: 5px 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-2);
  cursor: pointer;
}
.cc-slot-tab.on {
  background: var(--bg-1);
  color: var(--text-0);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.cc-prompt-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 11px;
  color: var(--text-2);
}

.cc-check-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.45;
  cursor: pointer;
}

.cc-submit-stack {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.cc-btn-full {
  width: 100%;
  justify-content: center;
}
</style>
