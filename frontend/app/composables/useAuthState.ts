import { reactive, computed } from 'vue'
import { authAPI, teamAPI, setActiveTeamHeader, setOnCreditChangeHook } from './useApi'

export interface AuthTeamSummary {
  id: number
  name: string
  description?: string | null
  role: 'owner' | 'admin' | 'member' | 'viewer'
  project_visibility: 'team_shared' | 'creator_only'
  credit_balance: number
  frozen_credits: number
  credit_limit: number | null
  credit_used: number
}

const state = reactive({
  loaded: false,
  enabled: false,
  authenticated: false,
  billingEnabled: false,
  user: null as null | {
    id: number
    username: string
    display_name: string
    is_super_admin: boolean
    current_team_id: number
  },
  currentTeam: null as null | AuthTeamSummary,
  teams: [] as AuthTeamSummary[],
  teamSwitchSeq: 0,
})

export const ROLE_LABELS: Record<string, string> = {
  owner: '创建者',
  admin: '管理员',
  member: '正式成员',
  viewer: '只读访客',
}

export function useAuthState() {
  async function refreshAuth() {
    try {
      const st = await authAPI.status()
      state.loaded = true
      state.enabled = Boolean(st.enabled)
      state.authenticated = Boolean(st.authenticated)
      state.billingEnabled = Boolean(st.billing_enabled)
      state.user = st.user || null
      state.currentTeam = (st.current_team as AuthTeamSummary) || null
      state.teams = (st.teams as AuthTeamSummary[]) || []
      setActiveTeamHeader(state.currentTeam?.id ?? null)
      return st
    } catch {
      state.loaded = true
      return null
    }
  }

  setOnCreditChangeHook(() => {
    if (state.enabled) void refreshAuth()
  })

  async function switchTeam(teamId: number) {
    if (state.currentTeam?.id === teamId) return
    await teamAPI.switch(teamId)
    setActiveTeamHeader(teamId)
    await refreshAuth()
    state.teamSwitchSeq++
  }

  const isSuperAdmin = computed(() => !state.enabled || Boolean(state.user?.is_super_admin))
  const isTeamAdmin = computed(() => {
    if (!state.enabled) return true
    const r = state.currentTeam?.role
    return r === 'owner' || r === 'admin'
  })
  const canWrite = computed(() => {
    if (!state.enabled) return true
    return state.currentTeam?.role !== 'viewer'
  })

  return {
    authState: state,
    isSuperAdmin,
    isTeamAdmin,
    canWrite,
    refreshAuth,
    switchTeam,
    ROLE_LABELS,
  }
}
