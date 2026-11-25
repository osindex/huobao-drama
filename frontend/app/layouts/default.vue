<template>
  <div class="shell">
    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <button class="brand" @click="navigateTo('/')">
          <div class="brand-mark">
            <img v-if="showBrandImage" :src="brandLogo" alt="青果短剧" class="brand-logo" @error="showBrandImage = false" />
            <span v-else class="brand-fallback">青</span>
          </div>
          <div class="brand-text">
            <span class="brand-name">青果短剧</span>
            <span class="brand-sub">QINGGUO SHORTS</span>
          </div>
        </button>

        <!-- 多团队工作空间切换器 -->
        <div v-if="authState.enabled && authState.currentTeam" class="team-switcher-wrap">
          <AppMenu :open="teamMenuOpen" placement="bottom-start" :min-width="230" @update:open="v => teamMenuOpen = v">
            <template #trigger>
              <button type="button" class="team-trigger" title="切换工作空间 / 团队">
                <Users :size="13" :stroke-width="2" class="team-trigger-icon" />
                <span class="team-trigger-name">{{ authState.currentTeam.name }}</span>
                <span class="team-role-pill">{{ ROLE_LABELS[authState.currentTeam.role] || authState.currentTeam.role }}</span>
                <ChevronDown :size="13" class="dim" />
              </button>
            </template>
            <div class="team-menu-section-label">我的团队空间 ({{ authState.teams.length }})</div>
            <AppMenuItem
              v-for="tm in authState.teams"
              :key="tm.id"
              :selected="tm.id === authState.currentTeam.id"
              @click="handleSwitchTeam(tm.id)"
            >
              <div class="team-item-row">
                <span class="truncate">{{ tm.name }}</span>
                <span class="team-item-meta mono">{{ tm.credit_balance }} 点</span>
              </div>
            </AppMenuItem>
            <div class="team-menu-divider"></div>
            <AppMenuItem @click="teamMenuOpen = false; navigateTo('/settings?tab=team')">
              <Users :size="13" /> 团队与成员管理 / 加入团队
            </AppMenuItem>
            <AppMenuItem @click="teamMenuOpen = false; navigateTo('/settings?tab=wallet')">
              <Coins :size="13" /> 算力钱包与卡密充值
            </AppMenuItem>
            <AppMenuItem v-if="isSuperAdmin" @click="teamMenuOpen = false; navigateTo('/settings?tab=admin')">
              <Shield :size="13" /> 平台超级管理后台
            </AppMenuItem>
          </AppMenu>
        </div>
      </div>

      <nav class="header-nav">
        <NuxtLink to="/" class="nav-link" :class="{ active: route.path === '/' }">
          <LayoutGrid :size="15" :stroke-width="1.8" />
          <span>{{ t('layout.nav.projects') }}</span>
        </NuxtLink>
        <NuxtLink to="/settings" class="nav-link" :class="{ active: route.path === '/settings' }">
          <Settings :size="15" :stroke-width="1.8" />
          <span>{{ t('layout.nav.settings') }}</span>
        </NuxtLink>
      </nav>

      <div class="header-right">
        <!-- 算力余额快捷入口 -->
        <button
          v-if="authState.enabled && authState.currentTeam"
          type="button"
          class="wallet-pill"
          title="点击打开算力钱包与充值"
          @click="navigateTo('/settings?tab=wallet')"
        >
          <Coins :size="13" class="wallet-pill-icon" />
          <span class="mono">{{ Number(authState.currentTeam.credit_balance || 0).toLocaleString() }}</span>
          <span class="wallet-pill-unit">点</span>
        </button>

        <ThemeToggle />
        <LocaleSwitcher />
        <template v-if="authState.enabled">
          <span v-if="authState.user" class="user-chip" :title="`账号：${authState.user.username}`">
            {{ authState.user.display_name || authState.user.username }}
          </span>
          <button class="logout-btn" type="button" @click="logout">退出</button>
        </template>
      </div>
    </header>

    <!-- AI 服务未配置引导横幅(缺任一类型即提示) -->
    <div v-if="missingConfigLabels.length" class="config-banner">
      <TriangleAlert :size="14" :stroke-width="1.8" />
      <span>{{ t('layout.banner.missing', { types: missingConfigLabels.join(t('common.listJoin')) }) }}</span>
      <NuxtLink to="/settings" class="config-banner-link">{{ t('layout.banner.goSettings') }}</NuxtLink>
    </div>

    <main class="content">
      <slot />
    </main>
  </div>
</template>

<script setup>
import { LayoutGrid, Settings, TriangleAlert, Users, Coins, ChevronDown, Shield } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import { useI18n } from 'vue-i18n'
import { aiConfigAPI, authAPI } from '~/composables/useApi'
import { useAuthState } from '~/composables/useAuthState'
import brandLogo from '~/assets/qingguo-logo.svg'

const { t, locale } = useI18n()
const route = useRoute()
const showBrandImage = ref(true)
const teamMenuOpen = ref(false)
const { authState, isSuperAdmin, refreshAuth, switchTeam, ROLE_LABELS } = useAuthState()

// 渲染时求值，语言切换即时生效（不能模块级常量固化）
const SERVICE_TYPE_LABELS = computed(() => ({
  text: t('common.serviceType.text'),
  image: t('common.serviceType.image'),
  video: t('common.serviceType.video'),
}))
const missingConfigLabels = ref([])

async function checkAiConfigs() {
  try {
    const configs = await aiConfigAPI.list()
    const labels = SERVICE_TYPE_LABELS.value
    missingConfigLabels.value = Object.entries(labels)
      .filter(([type]) => !configs.some(c => c.service_type === type && c.is_active))
      .map(([, label]) => label)
  } catch { /* 配置检查失败不阻塞页面 */ }
}

async function handleSwitchTeam(teamId) {
  teamMenuOpen.value = false
  if (authState.currentTeam?.id === teamId) return
  try {
    await switchTeam(teamId)
    toast.success(`已切换至「${authState.currentTeam?.name || '新团队'}」`)
    if (route.path.startsWith('/drama/')) {
      navigateTo('/')
    }
  } catch (e) {
    toastError(e)
  }
}

async function logout() {
  try { await authAPI.logout(); location.assign('/login') }
  catch { window.alert('退出未完成，请检查网络后重试') }
}

onMounted(async () => {
  await refreshAuth()
  checkAiConfigs()
})
// 设置页保存配置后返回时重新检查(布局跨页面复用,onMounted 只触发一次)
watch(() => route.path, () => {
  checkAiConfigs()
  if (authState.enabled) refreshAuth()
})
watch(() => authState.teamSwitchSeq, checkAiConfigs)
// 切换界面语言时横幅中已拼接的类型文案需要重算
watch(locale, checkAiConfigs)
</script>

<style scoped>
.shell {
  display: flex; flex-direction: column;
  height: 100vh; overflow: hidden;
  background: var(--bg-base);
}

/* === Header === */
.header {
  display: flex; align-items: center;
  height: 60px; flex-shrink: 0;
  padding: 0 24px;
  gap: 24px;
  background: var(--header-bg);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--border);
  position: relative; z-index: 10;
}

.header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }

.brand {
  display: flex; align-items: center; gap: 11px;
  background: transparent; border: none; cursor: pointer; padding: 4px 8px 4px 4px;
  text-decoration: none; border-radius: var(--radius);
  transition: background 0.18s var(--ease-out);
}
.brand:hover { background: var(--bg-hover); }
.brand:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
}
.brand-mark {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 9px;
  overflow: hidden;
}
.brand-logo {
  width: 32px;
  height: 32px;
  object-fit: contain;
  display: block;
}
.brand-fallback {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-0);
  line-height: 1;
}
.brand-text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15; }
.brand-name {
  font-size: 15px; font-weight: 700;
  color: var(--text-0);
  letter-spacing: -0.01em;
}
.brand-sub {
  font-size: 10px; font-weight: 400;
  color: var(--text-3); margin-top: 1px;
  letter-spacing: 0.04em;
}

/* Team Switcher */
.team-switcher-wrap {
  padding-left: 10px;
  border-left: 1px solid var(--border);
}
.team-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 11px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-0);
  font: 600 12.5px/1 var(--font-body);
  cursor: pointer;
  transition: all 0.16s var(--ease-out);
}
.team-trigger:hover { border-color: var(--accent); background: var(--bg-hover); }
.team-trigger-icon { color: var(--accent); flex-shrink: 0; }
.team-trigger-name { max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.team-role-pill {
  padding: 2px 6px;
  border-radius: var(--radius-pill);
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 10.5px;
  font-weight: 600;
}
.team-menu-section-label {
  padding: 6px 12px 4px;
  font-size: 11px;
  font-weight: 650;
  color: var(--text-3);
}
.team-menu-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
.team-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.team-item-meta { font-size: 11px; color: var(--text-3); flex-shrink: 0; }

/* Nav — pill segmented group */
.header-nav {
  display: flex; gap: 2px;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--overlay-track);
}

/* Header 右侧 */
.header-right {
  margin-left: auto;
  display: flex; align-items: center; gap: 8px;
}
.wallet-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  border: 1px solid rgba(249, 115, 22, 0.35);
  background: var(--accent-bg);
  color: var(--accent-text);
  font: 650 12px/1 var(--font-body);
  cursor: pointer;
  transition: all 0.16s var(--ease-out);
}
.wallet-pill:hover { border-color: var(--accent); transform: translateY(-0.5px); }
.wallet-pill-icon { color: var(--accent); }
.wallet-pill-unit { font-size: 11px; opacity: 0.85; }
.user-chip {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
}
.logout-btn {
  height: 32px; padding: 0 12px; border-radius: var(--radius-pill);
  border: 1px solid var(--border); background: transparent; color: var(--text-2);
  font: 600 12px/1 var(--font-body); cursor: pointer;
}
.logout-btn:hover { background: var(--bg-hover); color: var(--text-0); }
.nav-link {
  display: flex; align-items: center; gap: 6px;
  min-height: 32px;
  padding: 0 16px; border-radius: var(--radius-pill);
  font-size: 13px; font-weight: 600;
  color: var(--text-2); text-decoration: none;
  transition: all 0.18s var(--ease-out);
  border: none;
  line-height: 1;
}
.nav-link:hover { color: var(--text-0); }
.nav-link.active {
  background: var(--seg-active-bg);
  color: var(--text-0);
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}
.nav-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
}

/* Config banner — AI 服务未配置引导 */
.config-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 24px; flex-shrink: 0;
  font-size: 12.5px; color: var(--warn-text);
  background: var(--warn-bg);
  border-bottom: 1px solid var(--warn-border);
  position: relative; z-index: 9;
}
.config-banner-link {
  margin-left: auto;
  font-size: 12.5px; font-weight: 600;
  color: var(--warn-link); text-decoration: none;
  padding: 2px 10px; border-radius: var(--radius-pill);
  border: 1px solid var(--warn-border);
  transition: all 0.18s var(--ease-out);
  line-height: 1.6;
}
.config-banner-link:hover { background: var(--warn-link-hover-bg); color: var(--warn-text); }

/* Content */
.content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
</style>
