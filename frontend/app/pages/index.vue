<template>
  <div class="page">
    <!-- 紧凑头部：标题 + 统计 + 新建 一行 -->
    <div class="launcher-head">
      <div class="head-left">
        <h1 class="launcher-title">{{ t('index.hero.title') }}</h1>
        <span class="launcher-sub">{{ t('index.hero.sub') }}</span>
      </div>
      <div class="hero-stats">
        <span class="tag">{{ t('index.hero.projectCount', { n: dramas.length }) }}</span>
        <span class="tag tag-success">{{ t('index.hero.activeCount', { n: dramas.filter(d => currentStatus(d) === 'active').length }) }}</span>
        <span class="tag tag-accent">{{ t('index.hero.styleCount', { n: stylePresets.length }) }}</span>
      </div>
      <div class="head-actions">
        <button class="btn btn-icon tour-help-btn" :title="t('tour.helpTitle')" @click="startTour('index', INDEX_TOUR, t)">
          <CircleHelp :size="15" :stroke-width="1.8" />
        </button>
        <button v-if="canWrite" class="btn btn-primary" @click="showCreate = true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {{ t('index.create') }}
        </button>
      </div>
    </div>

    <div class="toolbar">
      <label class="search-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input v-model.trim="searchKeyword" class="input" :placeholder="t('index.searchPlaceholder')" />
      </label>
      <div class="chip-row">
        <button
          v-for="f in filters"
          :key="f.value"
          type="button"
          class="filter-chip"
          :class="{ on: statusFilter === f.value }"
          @click="statusFilter = f.value"
        >
          {{ f.label }}
        </button>
      </div>
      <div class="sort-select-wrap">
        <BaseSelect v-model="sortMode" :options="sortOptions" :searchable="false" />
      </div>
    </div>

    <!-- 加载骨架：卡片 -->
    <div v-if="loading" class="project-grid">
      <div v-for="i in 8" :key="i" class="card skeleton-card">
        <div class="skeleton-cover"></div>
        <div class="skeleton-body">
          <div class="skeleton-line w-60"></div>
          <div class="skeleton-line w-40"></div>
        </div>
      </div>
    </div>

    <!-- 项目卡片网格 -->
    <div v-else-if="filteredDramas.length" class="project-grid">
      <article
        v-for="(d, i) in filteredDramas"
        :key="d.id"
        class="card project-card"
        :style="{ animationDelay: `${i * 0.04}s` }"
        tabindex="0"
        role="button"
        :aria-label="t('index.openProjectAria', { title: d.title })"
        @click="openDrama(d)"
        @keydown.enter.prevent="openDrama(d)"
        @keydown.space.prevent="openDrama(d)"
      >
        <div class="project-cover">
          <span class="cover-initial">{{ coverInitial(d) }}</span>
          <span v-if="d.aspect_ratio && d.aspect_ratio !== 'adaptive'" class="cover-ratio">{{ d.aspect_ratio }}</span>
          <div class="status-wrap" @click.stop>
            <AppMenu
              :open="statusMenuId === d.id"
              placement="bottom-start"
              :min-width="120"
              @update:open="(v) => { statusMenuId = v ? d.id : null }"
            >
              <template #trigger>
                <button type="button" class="cover-badge status-badge" :title="t('index.statusBadgeTitle')">
                  <span class="status-dot" :class="statusDotClass(d)"></span>
                  {{ projectStatus(d) }}
                </button>
              </template>
              <AppMenuItem
                v-for="s in statusOptions"
                :key="s.value"
                :selected="currentStatus(d) === s.value"
                @click="setDramaStatus(d, s.value)"
              >{{ s.label }}</AppMenuItem>
            </AppMenu>
          </div>
          <div class="more-wrap" @click.stop>
            <AppMenu
              :open="activeMenuId === d.id"
              placement="bottom-end"
              :min-width="140"
              @update:open="(v) => { activeMenuId = v ? d.id : null }"
            >
              <template #trigger>
                <button class="btn btn-icon btn-sm cover-more" type="button" :title="t('common.more')">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>
                  </svg>
                </button>
              </template>
              <AppMenuItem @click="activeMenuId = null; openDrama(d)">{{ t('index.openProject') }}</AppMenuItem>
              <AppMenuItem v-if="authState.enabled && canManageDrama(d)" @click="activeMenuId = null; openShareDialog(d)">权限与成员共享</AppMenuItem>
              <AppMenuItem v-if="!authState.enabled || canManageDrama(d)" danger @click="activeMenuId = null; dramaToDelete = d">{{ t('index.deleteProject') }}</AppMenuItem>
            </AppMenu>
          </div>
        </div>
        <div class="project-body">
          <h2 class="project-name truncate">{{ d.title }}</h2>
          <div class="project-meta">
            <span v-if="d.style" class="tag tag-accent">{{ styleLabel(d.style) }}</span>
            <span v-if="authState.enabled" class="tag" :title="d.effective_visibility === 'creator_only' ? '仅创建者及被授权成员可见' : '当前团队成员共享'">
              {{ d.effective_visibility === 'creator_only' ? '🔒 私有' : '👥 共享' }}
            </span>
            <span class="dim">{{ t('index.projectMeta', { chars: d.characters?.length || 0, scenes: d.scenes?.length || 0, eps: d.episodes?.length || 0 }) }}</span>
          </div>
          <div class="project-foot dim">
            <Clock :size="11" :stroke-width="1.8" />
            <span>{{ fmtDate(d.updated_at || d.updatedAt) }}</span>
            <span v-if="authState.enabled && d.creator_name" class="creator-label truncate">· {{ d.creator_name }}</span>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <line x1="12" y1="8" x2="12" y2="16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      </div>
      <p class="empty-title">{{ dramas.length ? t('index.emptyFilteredTitle') : t('index.emptyTitle') }}</p>
      <p class="empty-desc">{{ dramas.length ? t('index.emptyFilteredDesc') : t('index.emptyDesc') }}</p>
      <button v-if="!dramas.length" class="btn btn-primary" @click="showCreate = true">{{ t('index.create') }}</button>
    </div>

    <div v-if="showCreate" class="overlay" @click.self="showCreate = false">
      <div class="dialog create-dialog">
        <div class="dialog-head">
          <div class="modal-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </div>
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ t('index.createDialog.title') }}</h2>
            <p class="dialog-desc">{{ t('index.createDialog.desc') }}</p>
          </div>
        </div>
        <form @submit.prevent="create" class="dialog-form">
          <div class="dialog-body">
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.name') }} <span class="required">*</span></span>
              <input v-model="form.title" class="input" :placeholder="t('index.createDialog.namePlaceholder')" required autofocus />
            </label>
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.style') }}</span>
              <BaseSelect v-model="form.style" :options="styleSelectOptions" :placeholder="t('index.createDialog.stylePlaceholder')" searchable />
              <span v-if="selectedStyleDesc" class="field-hint">{{ selectedStyleDesc }}</span>
            </label>
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.aspectRatio') }}</span>
              <BaseSelect v-model="form.aspect_ratio" :options="aspectRatioOptions" :placeholder="t('index.createDialog.aspectRatioPlaceholder')" />
              <span class="field-hint">{{ t('index.createDialog.aspectRatioHint') }}</span>
            </label>
            <label v-if="authState.enabled" class="field">
              <span class="field-label">项目可见范围</span>
              <BaseSelect v-model="form.visibility" :options="visibilityOptions" :searchable="false" />
              <span class="field-hint">可跟随团队默认规则，也可单独指定本项目公开共享或仅创建者可见</span>
            </label>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" @click="showCreate = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              {{ t('index.createDialog.submit') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- 项目权限与成员共享弹窗 -->
    <div v-if="sharingDrama" class="overlay" @click.self="sharingDrama = null">
      <div class="dialog share-dialog">
        <div class="dialog-head">
          <div class="dialog-head-copy">
            <h2 class="dialog-title">权限与共享 · {{ sharingDrama.title }}</h2>
            <p class="dialog-desc">配置该项目在当前团队内的可见性，或将私有项目单独授权给指定成员</p>
          </div>
        </div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">项目可见模式</span>
            <BaseSelect
              :model-value="sharingDrama.visibility || 'inherit'"
              :options="visibilityOptions"
              :searchable="false"
              @update:model-value="saveDramaVisibility"
            />
            <span class="field-hint">
              当前生效状态：{{ sharingDrama.effective_visibility === 'creator_only' ? '🔒 仅创建者、团队管理员与下方受邀成员可见' : '👥 当前团队全体成员可见（非访客均可协作）' }}
            </span>
          </label>

          <div class="share-section">
            <div class="field-label">定向授权给同团队成员</div>
            <div class="share-add-row">
              <BaseSelect v-model="shareTargetUserId" :options="shareCandidateOptions" placeholder="选择团队成员..." searchable />
              <BaseSelect v-model="sharePermission" :options="sharePermOptions" :searchable="false" />
              <button type="button" class="btn btn-primary btn-sm" :disabled="!shareTargetUserId || shareSaving" @click="addDramaShare">
                授权
              </button>
            </div>

            <div v-if="dramaShares.length" class="share-list">
              <div v-for="s in dramaShares" :key="s.user_id" class="share-item">
                <div class="share-item-info">
                  <span class="share-item-name">{{ s.display_name || s.username }}</span>
                  <span class="dim mono">@{{ s.username }}</span>
                </div>
                <span class="tag" :class="s.permission === 'edit' ? 'tag-accent' : ''">
                  {{ s.permission === 'edit' ? '可编辑' : '仅查看' }}
                </span>
                <button type="button" class="btn btn-ghost btn-sm" @click="removeDramaShare(s.user_id)">移除</button>
              </div>
            </div>
            <p v-else class="field-hint" style="margin-top:6px">暂无单独授权成员。当项目处于「私有」模式时，可通过上方选择器添加协作者。</p>
          </div>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn btn-primary" @click="sharingDrama = null">完成</button>
        </div>
      </div>
    </div>
    <ConfirmDialog
      :open="!!dramaToDelete"
      :title="t('index.deleteDialog.title')"
      :message="t('index.deleteDialog.message', { title: dramaToDelete?.title })"
      :loading="deletingDrama"
      @confirm="confirmDelDrama"
      @cancel="dramaToDelete = null"
    />
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import { useI18n } from 'vue-i18n'
import { Clock, CircleHelp } from 'lucide-vue-next'
import { dramaAPI, stylePresetAPI, teamAPI } from '~/composables/useApi'
import { useAuthState } from '~/composables/useAuthState'
import BaseSelect from '~/components/BaseSelect.vue'
import { startTour, autoTour } from '~/composables/useTour'

const { t, locale } = useI18n()
const { authState, isSuperAdmin, isTeamAdmin, canWrite } = useAuthState()

const dramas = ref([])
const loading = ref(false)
const showCreate = ref(false)
const searchKeyword = ref('')
const statusFilter = ref('all')
const sortMode = ref('updated')
const sortOptions = computed(() => ([
  { label: t('index.sortUpdated'), value: 'updated' },
  { label: t('index.sortTitle'), value: 'title' },
]))
const activeMenuId = ref(null)
const dramaToDelete = ref(null)
const deletingDrama = ref(false)
const form = ref({ title: '', style: '', aspect_ratio: '16:9', visibility: 'inherit' })
const visibilityOptions = computed(() => {
  const defLabel = authState.currentTeam?.project_visibility === 'creator_only' ? '仅创建者可见' : '团队全员共享'
  return [
    { label: `跟随团队默认（${defLabel}）`, value: 'inherit' },
    { label: '👥 团队全员共享', value: 'team_shared' },
    { label: '🔒 私有（仅自己与受邀成员可见）', value: 'creator_only' },
  ]
})

// 项目共享弹窗状态
const sharingDrama = ref(null)
const dramaShares = ref([])
const teamMembersForShare = ref([])
const shareTargetUserId = ref('')
const sharePermission = ref('edit')
const shareSaving = ref(false)
const sharePermOptions = [
  { label: '可编辑', value: 'edit' },
  { label: '仅查看', value: 'view' },
]
const shareCandidateOptions = computed(() => {
  const ownerCreatorId = sharingDrama.value?.created_by
  return teamMembersForShare.value
    .filter(m => m.user_id !== ownerCreatorId)
    .map(m => ({ label: `${m.display_name || m.username} (@${m.username})`, value: String(m.user_id) }))
})

function canManageDrama(d) {
  if (!authState.enabled) return true
  if (isSuperAdmin.value || isTeamAdmin.value) return true
  return d?.created_by != null && d.created_by === authState.user?.id
}

async function openShareDialog(d) {
  sharingDrama.value = d
  shareTargetUserId.value = ''
  sharePermission.value = 'edit'
  try {
    const [shares, curTeam] = await Promise.all([
      dramaAPI.listShares(d.id),
      teamAPI.current(),
    ])
    dramaShares.value = shares || []
    teamMembersForShare.value = curTeam?.members || []
  } catch (e) {
    toastError(e)
  }
}

async function saveDramaVisibility(vis) {
  if (!sharingDrama.value) return
  try {
    await dramaAPI.update(sharingDrama.value.id, { visibility: vis })
    sharingDrama.value.visibility = vis
    const teamDefault = authState.currentTeam?.project_visibility || 'team_shared'
    sharingDrama.value.effective_visibility = vis === 'inherit' ? teamDefault : vis
    toast.success('项目可见性已更新')
    load()
  } catch (e) {
    toastError(e)
  }
}

async function addDramaShare() {
  if (!sharingDrama.value || !shareTargetUserId.value) return
  shareSaving.value = true
  try {
    await dramaAPI.addShare(sharingDrama.value.id, Number(shareTargetUserId.value), sharePermission.value)
    dramaShares.value = await dramaAPI.listShares(sharingDrama.value.id)
    shareTargetUserId.value = ''
    toast.success('成员权限已保存')
  } catch (e) {
    toastError(e)
  } finally {
    shareSaving.value = false
  }
}

async function removeDramaShare(userId) {
  if (!sharingDrama.value) return
  try {
    await dramaAPI.removeShare(sharingDrama.value.id, userId)
    dramaShares.value = await dramaAPI.listShares(sharingDrama.value.id)
    toast.success('已取消该成员共享')
  } catch (e) {
    toastError(e)
  }
}
const stylePresets = ref([])
const styleSelectOptions = computed(() => stylePresets.value.map(p => ({ label: p.name, value: p.value })))
const selectedStyleDesc = computed(() => stylePresets.value.find(p => p.value === form.value.style)?.description || '')
// 常量数组 label 渲染时求值（语言切换即时生效），value 为逻辑值
const aspectRatioOptions = computed(() => ([
  { label: t('index.ratio.landscape'), value: '16:9' },
  { label: t('index.ratio.portrait'), value: '9:16' },
  { label: t('index.ratio.square'), value: '1:1' },
  { label: t('index.ratio.adaptive'), value: 'adaptive' },
]))
const filters = computed(() => ([
  { label: t('index.status.all'), value: 'all' },
  { label: t('index.status.draft'), value: 'draft' },
  { label: t('index.status.active'), value: 'active' },
  { label: t('index.status.completed'), value: 'completed' },
]))
// 项目状态由用户手动标记（持久化到 dramas.status），不再按内容自动推算
const statusOptions = computed(() => ([
  { label: t('index.status.draft'), value: 'draft' },
  { label: t('index.status.active'), value: 'active' },
  { label: t('index.status.completed'), value: 'completed' },
]))
const statusMenuId = ref(null)

function currentStatus(d) { return d.status || 'draft' }
function projectStatus(d) { return statusOptions.value.find(s => s.value === currentStatus(d))?.label || t('index.status.draft') }
function statusDotClass(d) { return currentStatus(d) === 'active' ? 'on' : currentStatus(d) === 'completed' ? 'done' : '' }

async function setDramaStatus(d, status) {
  statusMenuId.value = null
  if (currentStatus(d) === status) return
  const prev = d.status
  d.status = status
  try {
    await dramaAPI.update(d.id, { status })
  } catch (e) {
    d.status = prev
    toastError(e)
  }
}

function styleLabel(key) {
  return stylePresets.value.find(p => p.value === key)?.name || key || ''
}

// 封面：单色灰阶 + 首字符（状态色只以小圆点出现，封面保持中性）
function coverInitial(d) {
  return String(d.title || '?').trim().slice(0, 1).toUpperCase() || '?'
}

const filteredDramas = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  const items = dramas.value.filter((d) => {
    const text = [d.title, d.style, styleLabel(d.style), projectStatus(d)].filter(Boolean).join(' ').toLowerCase()
    const matchesSearch = !keyword || text.includes(keyword)
    const matchesStatus = statusFilter.value === 'all' || currentStatus(d) === statusFilter.value
    return matchesSearch && matchesStatus
  })

  return [...items].sort((a, b) => {
    if (sortMode.value === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
    return new Date(b.updated_at || b.updatedAt || 0).getTime() - new Date(a.updated_at || a.updatedAt || 0).getTime()
  })
})

async function load() {
  loading.value = true
  try {
    const [res, presets] = await Promise.all([dramaAPI.list(), stylePresetAPI.list()])
    dramas.value = res.items || []
    stylePresets.value = presets || []
    if (!form.value.style && stylePresets.value.length) {
      form.value.style = stylePresets.value[0].value
    }
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}

async function create() {
  if (!form.value.title?.trim()) return
  try {
    const d = await dramaAPI.create(form.value)
    showCreate.value = false
    navigateTo(`/drama/${d.id}`)
  } catch (e) {
    toastError(e)
  }
}

async function confirmDelDrama() {
  const d = dramaToDelete.value
  if (!d) return
  try {
    deletingDrama.value = true
    await dramaAPI.del(d.id)
    toast.success(t('index.deleted'))
    dramaToDelete.value = null
    load()
  } catch (e) {
    toastError(e)
  } finally {
    deletingDrama.value = false
  }
}

function getEpisodeNumber(d) {
  const episodes = [...(d.episodes || [])]
  if (!episodes.length) return 1
  episodes.sort((a, b) => Number(a.episode_number || a.episodeNumber || 1) - Number(b.episode_number || b.episodeNumber || 1))
  return Number(episodes[0].episode_number || episodes[0].episodeNumber || 1)
}

function getDramaPath(d) {
  return `/drama/${d.id}`
}

function openDrama(d) {
  activeMenuId.value = null
  navigateTo(getDramaPath(d))
}

function latestEpisodeLabel(d) {
  if (!d.episodes?.length) return t('index.noEpisodes')
  return t('index.episodeN', { n: getEpisodeNumber(d) })
}

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return t('index.time.justNow')
  if (diff < 3600000) return t('index.time.minutesAgo', { n: Math.floor(diff / 60000) })
  if (diff < 86400000) return t('index.time.hoursAgo', { n: Math.floor(diff / 3600000) })
  if (diff < 604800000) return t('index.time.daysAgo', { n: Math.floor(diff / 86400000) })
  return d.toLocaleDateString(locale.value === 'zh' ? 'zh-CN' : locale.value, { month: 'short', day: 'numeric' })
}

onMounted(load)
watch(() => authState.teamSwitchSeq, () => { load() })

// ===== 应用内引导（首页）：3 步 — 欢迎 / 新建项目 / AI 配置提醒 =====
const INDEX_TOUR = [
  { element: '#__nuxt', titleKey: 'tour.index.welcome.title', descKey: 'tour.index.welcome.desc' },
  { element: '.nav-link[href="/settings"]', titleKey: 'tour.index.settings.title', descKey: 'tour.index.settings.desc', popoverSide: 'bottom' },
  { element: '.head-actions .btn-primary', titleKey: 'tour.index.create.title', descKey: 'tour.index.create.desc', popoverSide: 'bottom', popoverAlign: 'end' },
]
onMounted(() => setTimeout(() => autoTour('index', INDEX_TOUR, t), 600))
</script>

<style scoped>
.page {
  padding: 20px 28px 48px;
  overflow-y: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  animation: fadeUp 0.35s var(--ease-out) both;
  background: var(--surface-base);
}

/* 紧凑头部：标题 + 副标题 + 统计 + 新建 一行 */
.launcher-head {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding-bottom: var(--sp-4);
}
.head-left { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.launcher-title {
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--text-0);
  white-space: nowrap;
}
.launcher-sub { color: var(--text-3); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hero-stats { display: flex; gap: var(--sp-2); margin-left: auto; }
.launcher-head .btn { flex-shrink: 0; }
.head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}
.search-box { position: relative; width: 240px; flex: 0 0 auto; }
.search-box svg {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}
.search-box .input {
  padding-left: 34px;
  border-radius: var(--radius-pill);
  border-color: var(--border);
  background: var(--bg-hover);
}
.search-box .input:focus { background: var(--surface-input); }
.chip-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 1px; }
.filter-chip {
  appearance: none;
  cursor: pointer;
  padding: 6px 14px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--overlay-track);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.16s var(--ease-out);
}
.filter-chip:hover { color: var(--text-0); background: var(--bg-active); }
.filter-chip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
}
.filter-chip.on { background: var(--inverse-surface); color: var(--on-inverse); }
.sort-select-wrap { margin-left: auto; width: 132px; flex-shrink: 0; }

/* 项目卡片网格 */
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}
.project-card {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  animation: fadeUp 0.32s var(--ease-out) both;
  transition: border-color 0.16s var(--ease-out), background 0.16s var(--ease-out);
}
.project-card:hover { border-color: var(--border-strong); }
.project-card:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3.5px var(--button-focus);
}

/* 封面：品牌柔光洗色 + 首字符，状态色只在圆点上出现 */
.project-cover {
  position: relative;
  aspect-ratio: 2.1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-1) 70%);
  border-bottom: 1px solid var(--border);
}
.cover-initial {
  font-size: 30px;
  font-weight: 700;
  color: var(--accent-text);
  opacity: 0.55;
  user-select: none;
}
.cover-ratio {
  position: absolute;
  right: 10px;
  bottom: 8px;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-3);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
  font-family: var(--font-mono);
}
.cover-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
.status-badge { cursor: pointer; transition: background 0.14s var(--ease-out), color 0.14s var(--ease-out); }
.status-badge:hover { color: var(--text-0); background: var(--bg-1); }
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-3);
}
.status-dot.on { background: var(--success); }
.status-dot.done { background: var(--accent); }
.status-wrap { position: absolute; top: 10px; left: 10px; }

.more-wrap { position: absolute; top: 8px; right: 8px; }
.cover-more {
  width: 30px;
  min-width: 30px;
  height: 30px;
  min-height: 30px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-2);
  opacity: 0;
  transition: opacity 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.cover-more:hover { color: var(--text-0); }
.project-card:hover .cover-more,
.more-wrap:focus-within .cover-more { opacity: 1; }

/* 卡身 */
.project-body { padding: 12px 14px 13px; }
.project-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-0);
}
.project-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 7px;
  font-size: 11.5px;
  flex-wrap: wrap;
}
.project-foot {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}

/* 骨架卡片 */
.skeleton-card { overflow: hidden; }
.skeleton-cover {
  aspect-ratio: 2.1 / 1;
  background: var(--bg-2);
  animation: skeleton-pulse 1.4s ease-in-out infinite alternate;
}
.skeleton-body { padding: 12px 14px 14px; display: grid; gap: 10px; }
.skeleton-line {
  height: 12px;
  border-radius: 99px;
  background: var(--bg-2);
  animation: skeleton-pulse 1.4s ease-in-out infinite alternate;
}
.skeleton-line.w-60 { width: 60%; }
.skeleton-line.w-40 { width: 40%; }
@keyframes skeleton-pulse { to { opacity: 0.55; } }

/* 空状态吃掉剩余高度 */
.empty-state {
  flex: 1;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  text-align: center;
}
.empty-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  background: var(--bg-2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  margin-bottom: 4px;
}
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-1); }
.empty-desc { font-size: 12px; color: var(--text-3); max-width: 240px; line-height: 1.6; }

.create-dialog { width: 460px; max-width: calc(100vw - 32px); }
.share-dialog { width: 520px; max-width: calc(100vw - 32px); }
.creator-label { max-width: 110px; }
.share-section {
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.share-add-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 115px auto;
  gap: 8px;
  align-items: center;
}
.share-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  max-height: 200px;
  overflow-y: auto;
}
.share-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--bg-2);
}
.share-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}
.share-item-name { font-weight: 600; color: var(--text-0); }
.dialog-head-copy { display: flex; flex-direction: column; gap: 2px; }
.dialog-desc { font-size: 12.5px; color: var(--text-3); }
.modal-icon {
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border-radius: var(--radius);
  background: var(--accent-bg);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog-form {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.dialog-body { display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.required { color: var(--error); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

@media (max-width: 900px) {
  .project-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
}
@media (max-width: 760px) {
  .page { padding: 16px 16px 40px; }
  .launcher-head { flex-wrap: wrap; }
  .launcher-sub { display: none; }
  .hero-stats { display: none; }
  .toolbar { flex-wrap: wrap; }
  .search-box { width: 100%; flex: 1 1 100%; }
  .sort-select-wrap { margin-left: 0; flex: 1; }
  .project-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  .field-row { grid-template-columns: 1fr; }
  .dialog-foot { flex-direction: column-reverse; }
  .dialog-foot .btn { width: 100%; }
}
</style>
