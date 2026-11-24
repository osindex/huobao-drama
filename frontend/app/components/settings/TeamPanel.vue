<template>
  <div class="settings-scroll">
    <div class="settings-head team-head-bar">
      <div>
        <h2 class="settings-title">团队空间与账号安全</h2>
        <p class="settings-desc">支持一人加入多个团队空间，团队管理员可自主设置项目共享/私有隔离、邀请成员与签发团队开放 API Key</p>
      </div>
      <div class="head-btn-group">
        <button type="button" class="btn btn-sm" @click="joinDialog = true">
          <Ticket :size="13" /> 凭邀请码加入团队
        </button>
        <button type="button" class="btn btn-primary btn-sm" @click="createDialog = true">
          <Plus :size="13" /> 新建团队空间
        </button>
      </div>
    </div>

    <!-- 所属团队概览与一键切换 -->
    <section class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">我加入的团队空间 ({{ myTeams.length }})</div>
          <div class="panel-card-sub">点击任一团队即可切换当前工作台与算力池上下文</div>
        </div>
      </div>
      <div class="team-grid">
        <div
          v-for="tm in myTeams"
          :key="tm.id"
          :class="['team-tile', { active: tm.id === currentDetail?.team?.id }]"
          @click="handleSwitch(tm.id)"
        >
          <div class="team-tile-top">
            <span class="team-tile-name truncate">{{ tm.name }}</span>
            <span class="tag" :class="tm.id === currentDetail?.team?.id ? 'tag-accent' : ''">
              {{ ROLE_LABELS[tm.role] || tm.role }}
            </span>
          </div>
          <div class="team-tile-stats">
            <span>项目 {{ tm.drama_count ?? 0 }}</span>
            <span>成员 {{ tm.member_count ?? 1 }}</span>
            <span class="mono">{{ Number(tm.credit_balance || 0).toLocaleString() }} 点</span>
          </div>
          <div class="team-tile-vis dim">
            {{ tm.project_visibility === 'creator_only' ? '🔒 默认仅创建者可见' : '👥 默认团队全员共享' }}
          </div>
        </div>
      </div>
    </section>

    <!-- 当前团队基础设置与可见性规则 -->
    <section v-if="currentDetail?.team" class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">当前空间设置 · {{ currentDetail.team.name }}</div>
          <div class="panel-card-sub">
            我的身份：<strong>{{ ROLE_LABELS[currentDetail.my_membership?.role] || currentDetail.my_membership?.role }}</strong>
            <template v-if="currentDetail.my_membership?.credit_limit != null">
              · 个人算力配额已用 {{ currentDetail.my_membership.credit_used }} / {{ currentDetail.my_membership.credit_limit }} 点
            </template>
          </div>
        </div>
        <span v-if="!canAdminTeam" class="tag">只读查看（需管理员权限修改）</span>
      </div>

      <form class="form-grid" @submit.prevent="saveTeamSettings">
        <label class="field">
          <span class="field-label">团队名称</span>
          <input v-model="teamForm.name" class="input" :disabled="!canAdminTeam" maxlength="60" required />
        </label>
        <label class="field">
          <span class="field-label">默认项目数据可见性（管理员配置）</span>
          <BaseSelect
            v-model="teamForm.project_visibility"
            :options="teamVisOptions"
            :searchable="false"
            :disabled="!canAdminTeam"
          />
          <span class="field-hint">
            「团队共享」下成员创建的项目默认全组可见协作；「仅创建者可见」下成员互不可见他人项目（管理员除外，且单项目仍可单独授权共享）。
          </span>
        </label>
        <label class="field full-span">
          <span class="field-label">团队备注 / 简介</span>
          <input v-model="teamForm.description" class="input" :disabled="!canAdminTeam" placeholder="选填，例如：短剧一组日常制作空间" maxlength="200" />
        </label>
        <div v-if="canAdminTeam" class="full-span row-end">
          <button type="submit" class="btn btn-primary btn-sm" :disabled="savingTeam">
            <Loader2 v-if="savingTeam" :size="12" class="animate-spin" /> 保存空间设置
          </button>
        </div>
      </form>
    </section>

    <!-- 团队成员与个人配额管理 -->
    <section v-if="currentDetail?.team" class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">团队成员 ({{ currentDetail.members?.length || 0 }})</div>
          <div class="panel-card-sub">支持为每位成员设置角色权限与个人算力消耗上限</div>
        </div>
        <button v-if="canAdminTeam" type="button" class="btn btn-ghost btn-sm" @click="addMemberDialog = true">
          <UserPlus :size="13" /> 直接添加已注册账号
        </button>
      </div>

      <div class="data-list">
        <div v-for="m in currentDetail.members" :key="m.user_id" class="data-row">
          <div class="member-avatar">{{ (m.display_name || m.username || '?').slice(0, 1).toUpperCase() }}</div>
          <div class="data-main">
            <div class="data-line">
              <span class="data-title">{{ m.display_name || m.username }}</span>
              <span class="dim mono">@{{ m.username }}</span>
              <span class="tag" :class="m.role === 'owner' || m.role === 'admin' ? 'tag-accent' : ''">
                {{ ROLE_LABELS[m.role] || m.role }}
              </span>
              <span v-if="!m.is_active" class="tag tag-error">账号已停用</span>
            </div>
            <div class="data-sub">
              个人累计消耗：<span class="mono">{{ m.credit_used || 0 }}</span> 点
              <template v-if="m.credit_limit != null"> · 配额上限 <span class="mono">{{ m.credit_limit }}</span> 点</template>
              <template v-else> · 配额不限（共享团队池）</template>
            </div>
          </div>
          <div class="row-actions">
            <button
              v-if="canAdminTeam && (m.role !== 'owner' || currentDetail.my_membership?.role === 'owner')"
              type="button"
              class="btn btn-ghost btn-sm"
              @click="openEditMember(m)"
            >调整权限/限额</button>
            <button
              v-if="m.role !== 'owner' && (canAdminTeam || m.user_id === authState.user?.id) && myTeams.length > 1"
              type="button"
              class="btn btn-danger btn-sm"
              @click="handleRemoveMember(m)"
            >{{ m.user_id === authState.user?.id ? '退出团队' : '移除' }}</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 团队邀请码管理（管理员可见） -->
    <section v-if="canAdminTeam" class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">团队邀请码与邀请链接</div>
          <div class="panel-card-sub">新用户可通过邀请链接直接注册并加入本团队；已有账号也可凭邀请码加入</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" @click="inviteDialog = true">
          <Plus :size="13" /> 生成邀请码
        </button>
      </div>

      <div v-if="currentDetail?.invitations?.length" class="data-list">
        <div v-for="inv in currentDetail.invitations" :key="inv.id" class="data-row">
          <div class="data-main">
            <div class="data-line">
              <span class="mono code-pill">{{ inv.code }}</span>
              <span class="tag">{{ ROLE_LABELS[inv.role] || inv.role }}</span>
              <span class="tag" :class="inv.is_active && inv.used_count < inv.max_uses ? 'tag-success' : ''">
                {{ !inv.is_active ? '已停用' : inv.used_count >= inv.max_uses ? '已用完' : `已用 ${inv.used_count}/${inv.max_uses}` }}
              </span>
            </div>
            <div class="data-sub">
              <template v-if="inv.credit_limit != null">新成员配额上限 {{ inv.credit_limit }} 点 · </template>
              <template v-if="inv.expires_at">有效期至 {{ fmtTime(inv.expires_at) }}</template>
              <template v-else>长期有效</template>
            </div>
          </div>
          <div class="row-actions">
            <button v-if="inv.is_active" type="button" class="btn btn-ghost btn-sm" @click="copyInviteLink(inv.code)">
              <Copy :size="12" /> 复制邀请链接
            </button>
            <button v-if="inv.is_active" type="button" class="btn btn-danger btn-sm" @click="revokeInvite(inv.id)">停用</button>
          </div>
        </div>
      </div>
      <p v-else class="empty-note">暂无邀请码，点击右上角「生成邀请码」即可发送给团队伙伴。</p>
    </section>

    <!-- 团队开放 API Key（购买/程序化调用 API） -->
    <section v-if="canAdminTeam && currentDetail?.team" class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">团队开放 API Key（程序化接口调用）</div>
          <div class="panel-card-sub">外部脚本或工作流可携带 Bearer Token 调用平台生成接口，自动从本团队算力钱包扣费</div>
        </div>
        <div class="row-actions">
          <button type="button" class="btn btn-primary btn-sm" @click="rotateApiKey">
            <KeyRound :size="13" /> {{ currentDetail.team.has_api_key ? '轮换生成新 Key' : '生成 API Key' }}
          </button>
          <button v-if="currentDetail.team.has_api_key" type="button" class="btn btn-danger btn-sm" @click="revokeApiKey">吊销</button>
        </div>
      </div>

      <div v-if="newlyGeneratedKey" class="secret-reveal-box">
        <div class="secret-reveal-head">
          <strong>请立即复制保存！</strong> 出于安全考虑，完整密钥仅在生成时展示这一次：
        </div>
        <div class="secret-reveal-row">
          <code class="mono">{{ newlyGeneratedKey }}</code>
          <button type="button" class="btn btn-primary btn-sm" @click="copyText(newlyGeneratedKey, 'API Key 已复制')">
            <Copy :size="12" /> 复制密钥
          </button>
        </div>
      </div>

      <div class="api-key-status">
        <template v-if="currentDetail.team.has_api_key">
          当前生效密钥前缀：<code class="mono">{{ currentDetail.team.api_key_prefix }}••••••••••••</code>
          <div class="api-example mono">curl -H "Authorization: Bearer {{ currentDetail.team.api_key_prefix }}..." {{ originUrl }}/api/v1/billing/wallet</div>
        </template>
        <template v-else>
          <span class="dim">当前团队尚未签发开放 API Key。</span>
        </template>
      </div>
    </section>

    <!-- 个人资料与修改密码 -->
    <section v-if="authState.user" class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">个人账号与密码安全</div>
          <div class="panel-card-sub">登录账号：<span class="mono">@{{ authState.user.username }}</span></div>
        </div>
      </div>
      <div class="form-grid">
        <form class="field" @submit.prevent="saveProfile">
          <span class="field-label">显示昵称</span>
          <div class="inline-form-row">
            <input v-model="profileName" class="input" maxlength="50" required />
            <button type="submit" class="btn btn-sm">更新昵称</button>
          </div>
        </form>
        <form class="field" @submit.prevent="savePassword">
          <span class="field-label">修改登录密码</span>
          <div class="inline-form-row">
            <input v-model="pwdForm.old" type="password" class="input" placeholder="当前密码" required />
            <input v-model="pwdForm.next" type="password" class="input" placeholder="新密码（至少6位）" minlength="6" required />
            <button type="submit" class="btn btn-sm">修改密码</button>
          </div>
        </form>
      </div>
    </section>

    <!-- 新建团队弹窗 -->
    <div v-if="createDialog" class="overlay" @click.self="createDialog = false">
      <form class="dialog" style="width:440px" @submit.prevent="submitCreateTeam">
        <div class="dialog-head"><div class="dialog-title">新建团队空间</div></div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">团队名称 <span class="required">*</span></span>
            <input v-model="newTeamForm.name" class="input" placeholder="例如：漫剧二组工作室" required />
          </label>
          <label class="field">
            <span class="field-label">默认项目数据可见性</span>
            <BaseSelect v-model="newTeamForm.project_visibility" :options="teamVisOptions" :searchable="false" />
          </label>
          <label class="field">
            <span class="field-label">简介备注</span>
            <input v-model="newTeamForm.description" class="input" placeholder="选填" />
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="createDialog = false">取消</button>
          <button type="submit" class="btn btn-primary">创建并切换</button>
        </div>
      </form>
    </div>

    <!-- 输入邀请码加入团队弹窗 -->
    <div v-if="joinDialog" class="overlay" @click.self="joinDialog = false">
      <form class="dialog" style="width:400px" @submit.prevent="submitJoinTeam">
        <div class="dialog-head"><div class="dialog-title">使用邀请码加入团队</div></div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">8位团队邀请码 <span class="required">*</span></span>
            <input v-model="joinCode" class="input mono" placeholder="输入邀请码..." required />
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="joinDialog = false">取消</button>
          <button type="submit" class="btn btn-primary">立即加入</button>
        </div>
      </form>
    </div>

    <!-- 直接拉入成员弹窗 -->
    <div v-if="addMemberDialog" class="overlay" @click.self="addMemberDialog = false">
      <form class="dialog" style="width:420px" @submit.prevent="submitAddMember">
        <div class="dialog-head"><div class="dialog-title">添加已注册用户至本团队</div></div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">对方登录用户名 <span class="required">*</span></span>
            <input v-model="memberAddForm.username" class="input" placeholder="例如：alice" required />
          </label>
          <label class="field">
            <span class="field-label">团队角色</span>
            <BaseSelect v-model="memberAddForm.role" :options="assignableRoleOptions" :searchable="false" />
          </label>
          <label class="field">
            <span class="field-label">个人算力配额上限（留空表示不限）</span>
            <input v-model="memberAddForm.credit_limit" type="number" min="0" class="input" placeholder="不限制" />
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="addMemberDialog = false">取消</button>
          <button type="submit" class="btn btn-primary">添加成员</button>
        </div>
      </form>
    </div>

    <!-- 编辑成员角色与配额弹窗 -->
    <div v-if="editingMember" class="overlay" @click.self="editingMember = null">
      <form class="dialog" style="width:420px" @submit.prevent="submitEditMember">
        <div class="dialog-head">
          <div class="dialog-title">调整成员 · {{ editingMember.display_name || editingMember.username }}</div>
        </div>
        <div class="dialog-body">
          <label v-if="editingMember.role !== 'owner'" class="field">
            <span class="field-label">团队角色</span>
            <BaseSelect v-model="memberEditForm.role" :options="assignableRoleOptions" :searchable="false" />
          </label>
          <label class="field">
            <span class="field-label">个人算力消耗上限（留空则共享团队池不限额）</span>
            <input v-model="memberEditForm.credit_limit" type="number" min="0" class="input" placeholder="不限额" />
            <span class="field-hint">当前已用：{{ editingMember.credit_used || 0 }} 点</span>
          </label>
          <label class="field check-row">
            <input v-model="memberEditForm.reset_used" type="checkbox" />
            <span>将已用配额清零重新累计</span>
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="editingMember = null">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    </div>

    <!-- 创建邀请码弹窗 -->
    <div v-if="inviteDialog" class="overlay" @click.self="inviteDialog = false">
      <form class="dialog" style="width:420px" @submit.prevent="submitCreateInvite">
        <div class="dialog-head"><div class="dialog-title">生成团队邀请码</div></div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">加入后默认角色</span>
            <BaseSelect v-model="inviteForm.role" :options="assignableRoleOptions" :searchable="false" />
          </label>
          <label class="field">
            <span class="field-label">可使用人数上限</span>
            <input v-model.number="inviteForm.max_uses" type="number" min="1" max="1000" class="input" />
          </label>
          <label class="field">
            <span class="field-label">有效天数（留空表示长期有效）</span>
            <input v-model="inviteForm.expires_days" type="number" min="1" max="365" class="input" placeholder="例如：7" />
          </label>
          <label class="field">
            <span class="field-label">受邀成员个人算力上限（留空不限）</span>
            <input v-model="inviteForm.credit_limit" type="number" min="0" class="input" placeholder="不限额" />
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="inviteDialog = false">取消</button>
          <button type="submit" class="btn btn-primary">生成</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { Plus, Users, Ticket, UserPlus, Copy, KeyRound, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import BaseSelect from '~/components/BaseSelect.vue'
import { authAPI, teamAPI } from '~/composables/useApi'
import { useAuthState } from '~/composables/useAuthState'

const { authState, isTeamAdmin: canAdminTeam, refreshAuth, switchTeam, ROLE_LABELS } = useAuthState()

const myTeams = ref([])
const currentDetail = ref(null)
const savingTeam = ref(false)
const newlyGeneratedKey = ref('')
const originUrl = computed(() => (typeof window !== 'undefined' ? window.location.origin : ''))

const teamForm = reactive({ name: '', description: '', project_visibility: 'team_shared' })
const teamVisOptions = [
  { label: '👥 团队全员共享（成员项目互相可见可协作）', value: 'team_shared' },
  { label: '🔒 仅创建者可见（成员项目默认私有隔离，可按需共享）', value: 'creator_only' },
]

const assignableRoleOptions = computed(() => {
  const isOwner = currentDetail.value?.my_membership?.role === 'owner'
  return [
    ...(isOwner ? [{ label: '管理员（可管理成员、邀请码与模型）', value: 'admin' }] : []),
    { label: '正式成员（可创建与编辑短剧项目）', value: 'member' },
    { label: '只读访客（仅可浏览共享项目，不可消耗算力）', value: 'viewer' },
  ]
})

const createDialog = ref(false)
const newTeamForm = reactive({ name: '', description: '', project_visibility: 'team_shared' })
const joinDialog = ref(false)
const joinCode = ref('')

const addMemberDialog = ref(false)
const memberAddForm = reactive({ username: '', role: 'member', credit_limit: '' })

const editingMember = ref(null)
const memberEditForm = reactive({ role: 'member', credit_limit: '', reset_used: false })

const inviteDialog = ref(false)
const inviteForm = reactive({ role: 'member', max_uses: 20, expires_days: 7, credit_limit: '' })

const profileName = ref('')
const pwdForm = reactive({ old: '', next: '' })

async function loadTeamData() {
  try {
    const [teams, cur] = await Promise.all([teamAPI.list(), teamAPI.current()])
    myTeams.value = teams || []
    currentDetail.value = cur
    if (cur?.team) {
      teamForm.name = cur.team.name || ''
      teamForm.description = cur.team.description || ''
      teamForm.project_visibility = cur.team.project_visibility || 'team_shared'
    }
    if (authState.user) {
      profileName.value = authState.user.display_name || authState.user.username
    }
  } catch (e) {
    toastError(e)
  }
}

async function handleSwitch(teamId) {
  if (currentDetail.value?.team?.id === teamId) return
  try {
    newlyGeneratedKey.value = ''
    await switchTeam(teamId)
    await loadTeamData()
    toast.success('已切换当前激活团队')
  } catch (e) {
    toastError(e)
  }
}

async function saveTeamSettings() {
  savingTeam.value = true
  try {
    await teamAPI.updateCurrent({
      name: teamForm.name,
      description: teamForm.description,
      project_visibility: teamForm.project_visibility,
    })
    await refreshAuth()
    await loadTeamData()
    toast.success('团队空间设置已保存')
  } catch (e) {
    toastError(e)
  } finally {
    savingTeam.value = false
  }
}

async function submitCreateTeam() {
  try {
    await teamAPI.create({ ...newTeamForm })
    createDialog.value = false
    Object.assign(newTeamForm, { name: '', description: '', project_visibility: 'team_shared' })
    newlyGeneratedKey.value = ''
    await refreshAuth()
    await loadTeamData()
    toast.success('团队创建成功，已切换至新空间')
  } catch (e) {
    toastError(e)
  }
}

async function submitJoinTeam() {
  try {
    const res = await teamAPI.join(joinCode.value)
    joinDialog.value = false
    joinCode.value = ''
    newlyGeneratedKey.value = ''
    await refreshAuth()
    await loadTeamData()
    toast.success(`已加入「${res.team_name || '新团队'}」`)
  } catch (e) {
    toastError(e)
  }
}

async function submitAddMember() {
  try {
    await teamAPI.addMember({
      username: memberAddForm.username,
      role: memberAddForm.role,
      credit_limit: memberAddForm.credit_limit === '' ? null : Number(memberAddForm.credit_limit),
    })
    addMemberDialog.value = false
    Object.assign(memberAddForm, { username: '', role: 'member', credit_limit: '' })
    await loadTeamData()
    toast.success('成员已加入团队')
  } catch (e) {
    toastError(e)
  }
}

function openEditMember(m) {
  editingMember.value = m
  memberEditForm.role = m.role === 'owner' ? 'admin' : m.role
  memberEditForm.credit_limit = m.credit_limit != null ? String(m.credit_limit) : ''
  memberEditForm.reset_used = false
}

async function submitEditMember() {
  if (!editingMember.value) return
  try {
    const payload = {
      credit_limit: memberEditForm.credit_limit === '' ? null : Number(memberEditForm.credit_limit),
      reset_used: memberEditForm.reset_used,
    }
    if (editingMember.value.role !== 'owner') payload.role = memberEditForm.role
    await teamAPI.updateMember(editingMember.value.user_id, payload)
    editingMember.value = null
    await refreshAuth()
    await loadTeamData()
    toast.success('成员权限与配额已更新')
  } catch (e) {
    toastError(e)
  }
}

async function handleRemoveMember(m) {
  const isSelf = m.user_id === authState.user?.id
  if (!window.confirm(isSelf ? `确定退出「${currentDetail.value?.team?.name}」吗？` : `确定将 ${m.display_name || m.username} 移出本团队吗？`)) return
  try {
    await teamAPI.removeMember(m.user_id)
    await refreshAuth()
    await loadTeamData()
    toast.success(isSelf ? '已退出该团队' : '已移除成员')
  } catch (e) {
    toastError(e)
  }
}

async function submitCreateInvite() {
  try {
    const inv = await teamAPI.createInvitation({
      role: inviteForm.role,
      max_uses: inviteForm.max_uses,
      expires_days: inviteForm.expires_days ? Number(inviteForm.expires_days) : null,
      credit_limit: inviteForm.credit_limit === '' ? null : Number(inviteForm.credit_limit),
    })
    inviteDialog.value = false
    await loadTeamData()
    copyInviteLink(inv.code)
  } catch (e) {
    toastError(e)
  }
}

async function revokeInvite(id) {
  try {
    await teamAPI.revokeInvitation(id)
    await loadTeamData()
    toast.success('邀请码已停用')
  } catch (e) {
    toastError(e)
  }
}

function copyInviteLink(code) {
  const url = `${window.location.origin}/login?invite=${encodeURIComponent(code)}`
  copyText(url, `邀请链接已复制（邀请码：${code}）`)
}

async function copyText(text, msg = '已复制') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(msg)
  } catch {
    window.prompt('请手动复制：', text)
  }
}

async function rotateApiKey() {
  if (currentDetail.value?.team?.has_api_key && !window.confirm('轮换后旧的 API Key 将立即失效，确认生成新密钥吗？')) return
  try {
    const res = await teamAPI.generateApiKey()
    newlyGeneratedKey.value = res.api_key
    await loadTeamData()
    toast.success('团队 API Key 已生成')
  } catch (e) {
    toastError(e)
  }
}

async function revokeApiKey() {
  if (!window.confirm('确定吊销当前团队开放 API Key 吗？外部脚本调用将立即停止。')) return
  try {
    await teamAPI.revokeApiKey()
    newlyGeneratedKey.value = ''
    await loadTeamData()
    toast.success('团队 API Key 已吊销')
  } catch (e) {
    toastError(e)
  }
}

async function saveProfile() {
  try {
    await authAPI.updateProfile(profileName.value)
    await refreshAuth()
    toast.success('个人昵称已更新')
  } catch (e) {
    toastError(e)
  }
}

async function savePassword() {
  try {
    await authAPI.changePassword(pwdForm.old, pwdForm.next)
    pwdForm.old = ''
    pwdForm.next = ''
    toast.success('登录密码已更新')
  } catch (e) {
    toastError(e)
  }
}

function fmtTime(s) {
  if (!s) return ''
  return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(loadTeamData)
watch(() => authState.teamSwitchSeq, loadTeamData)
</script>

<style scoped>
.settings-scroll { height: 100%; overflow-y: auto; padding: 20px 28px 48px; animation: fadeUp 0.3s var(--ease-out); }
.settings-scroll > * { max-width: 1080px; margin-left: auto; margin-right: auto; }
.settings-scroll > .card + .card { margin-top: 16px; }
.settings-head { margin-bottom: 20px; }
.team-head-bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.head-btn-group { display: flex; gap: 8px; }
.settings-title { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.settings-desc { font-size: 13px; color: var(--text-2); margin-top: 6px; }

.panel-card { padding: 20px; }
.panel-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.panel-card-title { font-size: 15px; font-weight: 700; color: var(--text-0); }
.panel-card-sub { font-size: 12px; color: var(--text-2); margin-top: 3px; }

.team-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.team-tile {
  padding: 14px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--bg-1);
  cursor: pointer;
  transition: all 0.16s var(--ease-out);
}
.team-tile:hover { border-color: var(--accent); transform: translateY(-1px); }
.team-tile.active { border-color: var(--accent); background: var(--accent-bg); }
.team-tile-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.team-tile-name { font-size: 14px; font-weight: 700; color: var(--text-0); }
.team-tile-stats { display: flex; gap: 10px; margin-top: 8px; font-size: 12px; color: var(--text-2); }
.team-tile-vis { margin-top: 6px; font-size: 11px; }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.full-span { grid-column: 1 / -1; }
.row-end { display: flex; justify-content: flex-end; }
.inline-form-row { display: flex; gap: 8px; align-items: center; }
.inline-form-row .input { flex: 1; min-width: 0; }

.data-list { display: flex; flex-direction: column; border-top: 1px solid var(--border); }
.data-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.data-row:last-child { border-bottom: none; padding-bottom: 0; }
.member-avatar {
  width: 34px; height: 34px; border-radius: 50%;
  background: var(--accent-bg); color: var(--accent-text);
  display: grid; place-items: center; font-weight: 700; font-size: 13px; flex-shrink: 0;
}
.data-main { flex: 1; min-width: 0; }
.data-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.data-title { font-size: 13.5px; font-weight: 600; color: var(--text-0); }
.data-sub { font-size: 12px; color: var(--text-3); margin-top: 3px; }
.row-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

.code-pill {
  padding: 2px 8px; border-radius: 6px;
  background: var(--bg-2); border: 1px solid var(--border);
  font-size: 12.5px; font-weight: 700; color: var(--text-0);
}
.secret-reveal-box {
  padding: 12px 14px; margin-bottom: 12px; border-radius: var(--radius);
  border: 1px solid var(--accent); background: var(--accent-bg);
}
.secret-reveal-head { font-size: 12px; color: var(--accent-text); margin-bottom: 8px; }
.secret-reveal-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; word-break: break-all; }
.api-key-status { font-size: 12.5px; color: var(--text-1); }
.api-example {
  margin-top: 8px; padding: 8px 10px; border-radius: var(--radius-sm);
  background: var(--bg-2); font-size: 11.5px; color: var(--text-2); overflow-x: auto;
}
.empty-note { font-size: 12.5px; color: var(--text-3); }
.check-row { flex-direction: row !important; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
.required { color: var(--error); }

@media (max-width: 760px) {
  .form-grid { grid-template-columns: 1fr; }
  .inline-form-row { flex-wrap: wrap; }
}
</style>
