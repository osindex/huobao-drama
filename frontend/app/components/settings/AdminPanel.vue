<template>
  <div class="settings-scroll">
    <div class="settings-head admin-head">
      <div>
        <h2 class="settings-title">平台超级管理后台</h2>
        <p class="settings-desc">全局运营数据、开放/邀请注册策略、算力计费总开关、批量发卡、全平台团队调账与定价套餐配置</p>
      </div>
      <div class="subtab-bar">
        <button
          v-for="st in subTabs"
          :key="st.id"
          type="button"
          :class="['subtab-btn', { on: subTab === st.id }]"
          @click="subTab = st.id"
        >{{ st.label }}</button>
      </div>
    </div>

    <!-- 顶部指标概览 -->
    <div v-if="overview" class="metric-grid">
      <div class="card metric-card">
        <div class="metric-label">注册用户 / 团队数</div>
        <div class="metric-value mono">{{ overview.user_count }} <span class="dim">/ {{ overview.team_count }}</span></div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">全站短剧项目</div>
        <div class="metric-value mono">{{ overview.drama_count }}</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">全站留存可用算力</div>
        <div class="metric-value mono">{{ Number(overview.total_balance || 0).toLocaleString() }}</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">全站累计消耗 / 未兑卡密</div>
        <div class="metric-value mono">{{ Number(overview.total_consumed || 0).toLocaleString() }} <span class="dim">/ {{ overview.unused_redeem_codes }} 张</span></div>
      </div>
    </div>

    <!-- 1. 注册与计费策略 -->
    <section v-if="subTab === 'policy'" class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">注册策略与算力计费总开关</div>
          <div class="panel-card-sub">开启「按量算力计费」后，非 BYOK 的文本/图片/视频调用将按定价表自动冻结并扣减团队算力池</div>
        </div>
      </div>

      <form class="policy-list" @submit.prevent="savePolicy">
        <div class="policy-row">
          <div>
            <div class="policy-name">启用平台算力计费（Monetization 总开关）</div>
            <div class="policy-sub">关闭时所有团队免费无限调用平台模型；开启后按定价表实时预冻结与结算（使用团队自有 BYOK 密钥仍免扣平台算力）</div>
          </div>
          <label class="config-switch">
            <input v-model="policyForm.billing_enabled" type="checkbox" class="sr-only" />
            <span class="switch" :class="{ on: policyForm.billing_enabled }"></span>
          </label>
        </div>

        <div class="policy-row">
          <div>
            <div class="policy-name">允许开放自助注册（Open Registration）</div>
            <div class="policy-sub">开启后，任何访客均可在登录页直接注册个人账号并自动创建独立工作空间</div>
          </div>
          <label class="config-switch">
            <input v-model="policyForm.allow_open_register" type="checkbox" class="sr-only" />
            <span class="switch" :class="{ on: policyForm.allow_open_register }"></span>
          </label>
        </div>

        <div class="policy-row">
          <div>
            <div class="policy-name">允许凭团队邀请码注册（Invite-only Registration）</div>
            <div class="policy-sub">即使关闭开放自助注册，持有有效团队邀请码/邀请链接的新用户仍可注册并直接加入对应团队</div>
          </div>
          <label class="config-switch">
            <input v-model="policyForm.allow_invite_register" type="checkbox" class="sr-only" />
            <span class="switch" :class="{ on: policyForm.allow_invite_register }"></span>
          </label>
        </div>

        <div class="policy-row">
          <div>
            <div class="policy-name">新用户注册赠送体验算力点数</div>
            <div class="policy-sub">新用户创建个人默认空间时自动发放的初始体验点数（设为 0 则不赠送）</div>
          </div>
          <input v-model.number="policyForm.register_bonus_credits" type="number" min="0" class="input mono" style="width:140px" />
        </div>

        <div class="row-end" style="padding-top:12px">
          <button type="submit" class="btn btn-primary" :disabled="savingPolicy">保存全局策略</button>
        </div>
      </form>
    </section>

    <!-- 2. 充值卡密发卡 & 待入账订单 -->
    <template v-else-if="subTab === 'codes'">
      <section class="card panel-card">
        <div class="panel-card-head">
          <div>
            <div class="panel-card-title">批量生成充值卡密（发卡中心）</div>
            <div class="panel-card-sub">生成后的卡密可通过发卡网、企微或线下渠道售卖，用户在「算力钱包」输入即秒到账</div>
          </div>
        </div>

        <form class="batch-form" @submit.prevent="handleGenerateCodes">
          <label class="field">
            <span class="field-label">生成张数 (1~200)</span>
            <input v-model.number="codeGenForm.count" type="number" min="1" max="200" class="input mono" required />
          </label>
          <label class="field">
            <span class="field-label">每张算力点数</span>
            <input v-model.number="codeGenForm.credits" type="number" min="1" class="input mono" required />
          </label>
          <label class="field">
            <span class="field-label">有效天数（留空永久有效）</span>
            <input v-model="codeGenForm.expires_days" type="number" min="1" class="input mono" placeholder="长期有效" />
          </label>
          <label class="field">
            <span class="field-label">批次备注</span>
            <input v-model="codeGenForm.batch_note" class="input" placeholder="例如：闲鱼首批 1000 点卡" />
          </label>
          <div class="field" style="justify-content:flex-end">
            <button type="submit" class="btn btn-primary" :disabled="generatingCodes">立即生成卡密</button>
          </div>
        </form>

        <div v-if="generatedBatch.length" class="batch-output">
          <div class="batch-output-head">
            <span>本次新生成 {{ generatedBatch.length }} 张卡密：</span>
            <button type="button" class="btn btn-primary btn-sm" @click="copyBatchCodes">一键复制全部卡密</button>
          </div>
          <textarea readonly class="textarea mono" rows="5" :value="generatedBatch.join('\n')" />
        </div>
      </section>

      <section class="card panel-card">
        <div class="panel-card-head">
          <div class="panel-card-title">已生成卡密列表 ({{ redeemCodes.length }})</div>
          <div class="filter-pills">
            <button
              v-for="s in [{l:'全部',v:''},{l:'未兑换',v:'unused'},{l:'已兑换',v:'redeemed'},{l:'已作废',v:'disabled'}]"
              :key="s.v"
              type="button"
              :class="['pill-btn', { on: codeFilter === s.v }]"
              @click="codeFilter = s.v; loadCodes()"
            >{{ s.l }}</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="clean-table">
            <thead>
              <tr>
                <th>卡密</th>
                <th>面额</th>
                <th>状态</th>
                <th>批次备注</th>
                <th>兑换团队 / 用户</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="rc in redeemCodes" :key="rc.id">
                <td class="mono"><strong>{{ rc.code }}</strong></td>
                <td class="mono">{{ rc.credits }} 点</td>
                <td>
                  <span class="tag" :class="rc.status === 'unused' ? 'tag-success' : rc.status === 'redeemed' ? 'tag-accent' : ''">
                    {{ rc.status === 'unused' ? '未兑换' : rc.status === 'redeemed' ? '已兑换' : '已作废' }}
                  </span>
                </td>
                <td class="dim">{{ rc.batch_note || '—' }}</td>
                <td class="dim">{{ rc.redeemed_team_name ? `${rc.redeemed_team_name} (@${rc.redeemed_username || ''})` : '—' }}</td>
                <td>
                  <button v-if="rc.status === 'unused'" type="button" class="btn btn-danger btn-sm" @click="revokeCode(rc.id)">作废</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card panel-card">
        <div class="panel-card-head">
          <div>
            <div class="panel-card-title">充值订单记录与人工确认入账 ({{ orders.length }})</div>
            <div class="panel-card-sub">待接入自动支付回调前，用户提交的套餐订单可在此一键确认入账</div>
          </div>
        </div>
        <div class="table-wrap">
          <table class="clean-table">
            <thead>
              <tr>
                <th>订单号</th>
                <th>所属团队</th>
                <th>点数</th>
                <th>金额</th>
                <th>渠道</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in orders" :key="o.id">
                <td class="mono">{{ o.order_no }}</td>
                <td>{{ o.team_name || `#${o.team_id}` }}</td>
                <td class="mono">+{{ o.credits }}</td>
                <td class="mono">¥{{ (Number(o.amount_cents || 0) / 100).toFixed(2) }}</td>
                <td class="dim">{{ o.payment_channel }}</td>
                <td>
                  <span class="tag" :class="o.status === 'paid' ? 'tag-success' : 'tag-accent'">
                    {{ o.status === 'paid' ? '已入账' : '待支付' }}
                  </span>
                </td>
                <td>
                  <button v-if="o.status === 'pending'" type="button" class="btn btn-primary btn-sm" @click="confirmOrderPaid(o.order_no)">确认收款入账</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- 3. 全站团队与算力调账 -->
    <section v-else-if="subTab === 'teams'" class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">全平台团队空间与直充调账 ({{ allTeams.length }})</div>
          <div class="panel-card-sub">可为任意团队手动增加或扣减算力点数，自动记入团队收支流水</div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="clean-table">
          <thead>
            <tr>
              <th>ID / 团队名称</th>
              <th>创建者</th>
              <th>可见性模式</th>
              <th>成员 / 项目</th>
              <th>可用算力 / 冻结</th>
              <th>累计消耗</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tm in allTeams" :key="tm.id">
              <td><strong>#{{ tm.id }} {{ tm.name }}</strong></td>
              <td class="mono dim">@{{ tm.owner_username || '—' }}</td>
              <td>{{ tm.project_visibility === 'creator_only' ? '🔒 仅创建者' : '👥 团队共享' }}</td>
              <td class="mono">{{ tm.member_count }} / {{ tm.drama_count }}</td>
              <td class="mono"><strong>{{ tm.credit_balance }}</strong> <span class="dim">/ {{ tm.frozen_credits }}</span></td>
              <td class="mono">{{ tm.total_consumed }}</td>
              <td>
                <button type="button" class="btn btn-primary btn-sm" @click="openAdjustTeam(tm)">充扣算力</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 4. 全站用户账号管理 -->
    <section v-else-if="subTab === 'users'" class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">全平台账号管理 ({{ allUsers.length }})</div>
          <div class="panel-card-sub">手动开通新客户账号、重置密码、停用违规账号或授予平台超管权限</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" @click="createUserDialog = true">+ 手动开户</button>
      </div>
      <div class="table-wrap">
        <table class="clean-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名 / 昵称</th>
              <th>所属团队数</th>
              <th>身份权限</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in allUsers" :key="u.id">
              <td class="mono">#{{ u.id }}</td>
              <td>
                <strong>{{ u.display_name }}</strong>
                <span class="dim mono"> @{{ u.username }}</span>
              </td>
              <td class="mono">{{ u.team_count }}</td>
              <td>
                <span v-if="u.is_super_admin" class="tag tag-accent">超级管理员</span>
                <span v-else class="tag">普通用户</span>
              </td>
              <td>
                <span class="tag" :class="u.is_active ? 'tag-success' : 'tag-error'">{{ u.is_active ? '正常' : '已停用' }}</span>
              </td>
              <td class="row-actions">
                <button type="button" class="btn btn-ghost btn-sm" @click="resetUserPwd(u)">重置密码</button>
                <button
                  v-if="u.id !== authState.user?.id"
                  type="button"
                  class="btn btn-ghost btn-sm"
                  @click="toggleUserActive(u)"
                >{{ u.is_active ? '停用' : '启用' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 5. 计费单价与充值套餐配置 -->
    <template v-else-if="subTab === 'pricing'">
      <section class="card panel-card">
        <div class="panel-card-head">
          <div>
            <div class="panel-card-title">模型算力计费单价规则 ({{ pricingRules.length }})</div>
            <div class="panel-card-sub">精确匹配优先于通配符 `*`，修改后对新提交任务即时生效</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" @click="openPricingModal()">+ 新增计费规则</button>
        </div>
        <div class="table-wrap">
          <table class="clean-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>Provider</th>
                <th>模型匹配</th>
                <th>计费方式</th>
                <th>单价点数</th>
                <th>描述</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pr in pricingRules" :key="pr.id">
                <td>{{ pr.service_type }}</td>
                <td class="mono">{{ pr.provider }}</td>
                <td class="mono">{{ pr.model_pattern }}</td>
                <td>{{ pr.billing_unit }}</td>
                <td class="mono"><strong>{{ pr.unit_credits }}</strong></td>
                <td class="dim">{{ pr.description || '—' }}</td>
                <td class="row-actions">
                  <button type="button" class="btn btn-ghost btn-sm" @click="openPricingModal(pr)">编辑</button>
                  <button type="button" class="btn btn-danger btn-sm" @click="delPricing(pr.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card panel-card">
        <div class="panel-card-head">
          <div>
            <div class="panel-card-title">充值套餐配置 ({{ adminPackages.length }})</div>
            <div class="panel-card-sub">展示在用户端「算力钱包」页面的可选购套餐档位</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" @click="openPkgModal()">+ 新增充值套餐</button>
        </div>
        <div class="table-wrap">
          <table class="clean-table">
            <thead>
              <tr>
                <th>套餐名称</th>
                <th>基础算力</th>
                <th>赠送算力</th>
                <th>售价(元)</th>
                <th>说明</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pk in adminPackages" :key="pk.id">
                <td><strong>{{ pk.name }}</strong></td>
                <td class="mono">{{ pk.credits }}</td>
                <td class="mono">+{{ pk.bonus_credits || 0 }}</td>
                <td class="mono">¥{{ (Number(pk.price_cents || 0) / 100).toFixed(2) }}</td>
                <td class="dim">{{ pk.description || '—' }}</td>
                <td class="row-actions">
                  <button type="button" class="btn btn-ghost btn-sm" @click="openPkgModal(pk)">编辑</button>
                  <button type="button" class="btn btn-danger btn-sm" @click="delPackage(pk.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- 团队算力调账弹窗 -->
    <div v-if="adjustingTeam" class="overlay" @click.self="adjustingTeam = null">
      <form class="dialog" style="width:420px" @submit.prevent="submitAdjustTeam">
        <div class="dialog-head">
          <div class="dialog-title">团队算力调账 · {{ adjustingTeam.name }}</div>
        </div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">增减算力点数（正数为充值，负数为扣减）</span>
            <input v-model.number="adjustForm.delta" type="number" class="input mono" placeholder="例如：5000 或 -200" required />
            <span class="field-hint">当前可用余额：{{ adjustingTeam.credit_balance }} 点</span>
          </label>
          <label class="field">
            <span class="field-label">备注说明</span>
            <input v-model="adjustForm.note" class="input" placeholder="例如：线下对公转账充值" />
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="adjustingTeam = null">取消</button>
          <button type="submit" class="btn btn-primary">确认调账</button>
        </div>
      </form>
    </div>

    <!-- 手动开户弹窗 -->
    <div v-if="createUserDialog" class="overlay" @click.self="createUserDialog = false">
      <form class="dialog" style="width:430px" @submit.prevent="submitCreateUser">
        <div class="dialog-head"><div class="dialog-title">手动创建新账号</div></div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">登录用户名</span>
            <input v-model="userForm.username" class="input mono" placeholder="3~32位字母数字下划线" required />
          </label>
          <label class="field">
            <span class="field-label">显示昵称</span>
            <input v-model="userForm.display_name" class="input" placeholder="选填" />
          </label>
          <label class="field">
            <span class="field-label">初始登录密码</span>
            <input v-model="userForm.password" type="password" class="input" minlength="6" required />
          </label>
          <label class="field">
            <span class="field-label">初始赠送算力点数</span>
            <input v-model.number="userForm.initial_credits" type="number" min="0" class="input mono" />
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="createUserDialog = false">取消</button>
          <button type="submit" class="btn btn-primary">创建账号</button>
        </div>
      </form>
    </div>

    <!-- 计费规则编辑弹窗 -->
    <div v-if="pricingModal" class="overlay" @click.self="pricingModal = false">
      <form class="dialog" style="width:440px" @submit.prevent="submitPricing">
        <div class="dialog-head"><div class="dialog-title">{{ pricingEditId ? '编辑计费单价' : '新增计费单价规则' }}</div></div>
        <div class="dialog-body">
          <label v-if="!pricingEditId" class="field">
            <span class="field-label">服务类型</span>
            <select v-model="pricingForm.service_type" class="input">
              <option value="text">text（文本 Agent）</option>
              <option value="image">image（图片生成）</option>
              <option value="video">video（视频生成）</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">供应商标识（`*` 代表全部通用）</span>
            <input v-model="pricingForm.provider" class="input mono" placeholder="* / comfyui / nihapi / grok" />
          </label>
          <label class="field">
            <span class="field-label">模型匹配规则（`*` 代表全部模型）</span>
            <input v-model="pricingForm.model_pattern" class="input mono" placeholder="* 或模型名前缀" />
          </label>
          <label class="field">
            <span class="field-label">计费单位</span>
            <select v-model="pricingForm.billing_unit" class="input">
              <option value="per_call">per_call（按次调用）</option>
              <option value="per_image">per_image（按张生成）</option>
              <option value="per_second">per_second（按视频秒数）</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">单价点数</span>
            <input v-model.number="pricingForm.unit_credits" type="number" min="0" class="input mono" required />
          </label>
          <label class="field">
            <span class="field-label">说明描述</span>
            <input v-model="pricingForm.description" class="input" />
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="pricingModal = false">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    </div>

    <!-- 充值套餐编辑弹窗 -->
    <div v-if="pkgModal" class="overlay" @click.self="pkgModal = false">
      <form class="dialog" style="width:440px" @submit.prevent="submitPkg">
        <div class="dialog-head"><div class="dialog-title">{{ pkgEditId ? '编辑充值套餐' : '新增充值套餐' }}</div></div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">套餐名称</span>
            <input v-model="pkgForm.name" class="input" placeholder="例如：专业工作室包" required />
          </label>
          <label class="field">
            <span class="field-label">基础算力点数</span>
            <input v-model.number="pkgForm.credits" type="number" min="1" class="input mono" required />
          </label>
          <label class="field">
            <span class="field-label">额外赠送点数</span>
            <input v-model.number="pkgForm.bonus_credits" type="number" min="0" class="input mono" />
          </label>
          <label class="field">
            <span class="field-label">人民币售价（单位：元）</span>
            <input v-model.number="pkgForm.price_yuan" type="number" min="0" step="0.01" class="input mono" required />
          </label>
          <label class="field">
            <span class="field-label">套餐说明</span>
            <input v-model="pkgForm.description" class="input" />
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="pkgModal = false">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import { adminAPI } from '~/composables/useApi'
import { useAuthState } from '~/composables/useAuthState'

const { authState, refreshAuth } = useAuthState()

const subTab = ref('policy')
const subTabs = [
  { id: 'policy', label: '注册与计费开关' },
  { id: 'codes', label: '发卡与订单入账' },
  { id: 'teams', label: '全站团队调账' },
  { id: 'users', label: '用户管理' },
  { id: 'pricing', label: '单价与套餐' },
]

const overview = ref(null)
const savingPolicy = ref(false)
const policyForm = reactive({
  billing_enabled: false,
  allow_open_register: true,
  allow_invite_register: true,
  register_bonus_credits: 100,
})

const codeGenForm = reactive({ count: 10, credits: 1000, expires_days: '', batch_note: '' })
const generatingCodes = ref(false)
const generatedBatch = ref([])
const codeFilter = ref('')
const redeemCodes = ref([])
const orders = ref([])

const allTeams = ref([])
const adjustingTeam = ref(null)
const adjustForm = reactive({ delta: 1000, note: '' })

const allUsers = ref([])
const createUserDialog = ref(false)
const userForm = reactive({ username: '', display_name: '', password: '', initial_credits: 200 })

const pricingRules = ref([])
const pricingModal = ref(false)
const pricingEditId = ref(null)
const pricingForm = reactive({ service_type: 'video', provider: '*', model_pattern: '*', billing_unit: 'per_second', unit_credits: 10, description: '' })

const adminPackages = ref([])
const pkgModal = ref(false)
const pkgEditId = ref(null)
const pkgForm = reactive({ name: '', credits: 1000, bonus_credits: 0, price_yuan: 19.9, description: '' })

async function loadOverviewAndPolicy() {
  try {
    const [ov, pol] = await Promise.all([adminAPI.overview(), adminAPI.getPolicy()])
    overview.value = ov
    Object.assign(policyForm, pol)
  } catch (e) {
    toastError(e)
  }
}

async function savePolicy() {
  savingPolicy.value = true
  try {
    await adminAPI.updatePolicy({ ...policyForm })
    await refreshAuth()
    await loadOverviewAndPolicy()
    toast.success('平台全局策略已生效')
  } catch (e) {
    toastError(e)
  } finally {
    savingPolicy.value = false
  }
}

async function loadCodes() {
  try {
    const [codes, ord] = await Promise.all([adminAPI.redeemCodes(codeFilter.value), adminAPI.orders()])
    redeemCodes.value = codes || []
    orders.value = ord || []
  } catch (e) {
    toastError(e)
  }
}

async function handleGenerateCodes() {
  generatingCodes.value = true
  try {
    const res = await adminAPI.generateRedeemCodes({
      count: codeGenForm.count,
      credits: codeGenForm.credits,
      expires_days: codeGenForm.expires_days ? Number(codeGenForm.expires_days) : null,
      batch_note: codeGenForm.batch_note,
    })
    generatedBatch.value = res.codes || []
    toast.success(`成功生成 ${generatedBatch.value.length} 张充值卡密`)
    await loadOverviewAndPolicy()
    await loadCodes()
  } catch (e) {
    toastError(e)
  } finally {
    generatingCodes.value = false
  }
}

async function copyBatchCodes() {
  try {
    await navigator.clipboard.writeText(generatedBatch.value.join('\n'))
    toast.success('已复制全部新生成卡密')
  } catch { /* ignore */ }
}

async function revokeCode(id) {
  try {
    await adminAPI.revokeRedeemCode(id)
    toast.success('卡密已作废')
    loadCodes()
    loadOverviewAndPolicy()
  } catch (e) {
    toastError(e)
  }
}

async function confirmOrderPaid(orderNo) {
  if (!window.confirm(`确认订单 ${orderNo} 已收到款项并向对应团队发放算力吗？`)) return
  try {
    await adminAPI.completeOrder(orderNo, 'ADMIN_MANUAL_CONFIRM')
    toast.success('订单已入账，算力已发放至对应团队')
    await refreshAuth()
    await loadCodes()
    await loadOverviewAndPolicy()
  } catch (e) {
    toastError(e)
  }
}

async function loadTeams() {
  try { allTeams.value = await adminAPI.teams() } catch (e) { toastError(e) }
}

function openAdjustTeam(tm) {
  adjustingTeam.value = tm
  adjustForm.delta = 1000
  adjustForm.note = ''
}

async function submitAdjustTeam() {
  if (!adjustingTeam.value) return
  try {
    await adminAPI.adjustTeamCredits(adjustingTeam.value.id, Number(adjustForm.delta), adjustForm.note)
    adjustingTeam.value = null
    toast.success('团队算力调账完成')
    await refreshAuth()
    await loadTeams()
    await loadOverviewAndPolicy()
  } catch (e) {
    toastError(e)
  }
}

async function loadUsers() {
  try { allUsers.value = await adminAPI.users() } catch (e) { toastError(e) }
}

async function submitCreateUser() {
  try {
    await adminAPI.createUser({ ...userForm })
    createUserDialog.value = false
    Object.assign(userForm, { username: '', display_name: '', password: '', initial_credits: 200 })
    toast.success('账号已开通并初始化工作空间')
    await loadUsers()
    await loadOverviewAndPolicy()
  } catch (e) {
    toastError(e)
  }
}

async function resetUserPwd(u) {
  const next = window.prompt(`为用户 @${u.username} 设置新密码（至少 6 位）：`)
  if (!next) return
  try {
    await adminAPI.updateUser(u.id, { new_password: next })
    toast.success(`已重置 @${u.username} 的密码`)
  } catch (e) {
    toastError(e)
  }
}

async function toggleUserActive(u) {
  try {
    await adminAPI.updateUser(u.id, { is_active: !u.is_active })
    toast.success(u.is_active ? '账号已停用' : '账号已重新启用')
    loadUsers()
  } catch (e) {
    toastError(e)
  }
}

async function loadPricingAndPackages() {
  try {
    const [pr, pk] = await Promise.all([adminAPI.pricing(), adminAPI.packages()])
    pricingRules.value = pr || []
    adminPackages.value = pk || []
  } catch (e) {
    toastError(e)
  }
}

function openPricingModal(pr = null) {
  pricingEditId.value = pr?.id || null
  Object.assign(pricingForm, pr
    ? {
        service_type: pr.service_type,
        provider: pr.provider,
        model_pattern: pr.model_pattern,
        billing_unit: pr.billing_unit,
        unit_credits: pr.unit_credits,
        description: pr.description || '',
      }
    : { service_type: 'video', provider: '*', model_pattern: '*', billing_unit: 'per_second', unit_credits: 10, description: '' })
  pricingModal.value = true
}

async function submitPricing() {
  try {
    if (pricingEditId.value) await adminAPI.updatePricing(pricingEditId.value, { ...pricingForm })
    else await adminAPI.createPricing({ ...pricingForm })
    pricingModal.value = false
    toast.success('计费规则已保存')
    loadPricingAndPackages()
  } catch (e) {
    toastError(e)
  }
}

async function delPricing(id) {
  if (!window.confirm('确认删除该计费规则？')) return
  try {
    await adminAPI.deletePricing(id)
    loadPricingAndPackages()
  } catch (e) {
    toastError(e)
  }
}

function openPkgModal(pk = null) {
  pkgEditId.value = pk?.id || null
  Object.assign(pkgForm, pk
    ? {
        name: pk.name,
        credits: pk.credits,
        bonus_credits: pk.bonus_credits || 0,
        price_yuan: Number(pk.price_cents || 0) / 100,
        description: pk.description || '',
      }
    : { name: '', credits: 1000, bonus_credits: 0, price_yuan: 19.9, description: '' })
  pkgModal.value = true
}

async function submitPkg() {
  const payload = {
    name: pkgForm.name,
    credits: pkgForm.credits,
    bonus_credits: pkgForm.bonus_credits,
    price_cents: Math.round(Number(pkgForm.price_yuan || 0) * 100),
    description: pkgForm.description,
  }
  try {
    if (pkgEditId.value) await adminAPI.updatePackage(pkgEditId.value, payload)
    else await adminAPI.createPackage(payload)
    pkgModal.value = false
    toast.success('充值套餐已保存')
    loadPricingAndPackages()
  } catch (e) {
    toastError(e)
  }
}

async function delPackage(id) {
  if (!window.confirm('确认删除该套餐？')) return
  try {
    await adminAPI.deletePackage(id)
    loadPricingAndPackages()
  } catch (e) {
    toastError(e)
  }
}

watch(subTab, (v) => {
  if (v === 'codes') loadCodes()
  if (v === 'teams') loadTeams()
  if (v === 'users') loadUsers()
  if (v === 'pricing') loadPricingAndPackages()
})

onMounted(() => {
  loadOverviewAndPolicy()
})
</script>

<style scoped>
.settings-scroll { height: 100%; overflow-y: auto; padding: 20px 28px 48px; animation: fadeUp 0.3s var(--ease-out); }
.settings-scroll > * { max-width: 1080px; margin-left: auto; margin-right: auto; }
.settings-scroll > .card + .card { margin-top: 16px; }
.settings-head { margin-bottom: 18px; }
.admin-head { display: flex; flex-direction: column; gap: 14px; }
.settings-title { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.settings-desc { font-size: 13px; color: var(--text-2); margin-top: 6px; }

.subtab-bar {
  display: flex; flex-wrap: wrap; gap: 4px;
  padding: 4px; border-radius: var(--radius-pill);
  background: var(--overlay-track); width: fit-content;
}
.subtab-btn {
  border: none; background: transparent; padding: 6px 14px;
  border-radius: var(--radius-pill); font-size: 12.5px; font-weight: 650;
  color: var(--text-2); cursor: pointer; transition: all 0.15s;
}
.subtab-btn.on { background: var(--seg-active-bg); color: var(--text-0); box-shadow: 0 1px 4px rgba(0,0,0,0.1); }

.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.metric-card { padding: 14px 16px; }
.metric-label { font-size: 12px; color: var(--text-2); font-weight: 600; }
.metric-value { font-size: 22px; font-weight: 800; color: var(--text-0); margin-top: 4px; }
.metric-value span.dim { font-size: 14px; font-weight: 500; }

.panel-card { padding: 20px; }
.panel-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.panel-card-title { font-size: 15px; font-weight: 700; color: var(--text-0); }
.panel-card-sub { font-size: 12px; color: var(--text-2); margin-top: 3px; }

.policy-list { display: flex; flex-direction: column; }
.policy-row {
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
  padding: 14px 0; border-bottom: 1px solid var(--border);
}
.policy-name { font-size: 13.5px; font-weight: 650; color: var(--text-0); }
.policy-sub { font-size: 12px; color: var(--text-3); margin-top: 3px; }

.batch-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.batch-output {
  margin-top: 16px; padding: 12px; border-radius: var(--radius);
  background: var(--bg-2); border: 1px solid var(--accent);
}
.batch-output-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 12.5px; font-weight: 600; }

.table-wrap { overflow-x: auto; }
.clean-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.clean-table th {
  text-align: left; padding: 8px 10px; font-size: 11.5px; font-weight: 650;
  color: var(--text-3); border-bottom: 1px solid var(--border); white-space: nowrap;
}
.clean-table td { padding: 10px; border-bottom: 1px solid var(--border); color: var(--text-1); }
.clean-table tr:last-child td { border-bottom: none; }
.row-actions { display: flex; gap: 6px; align-items: center; }
.row-end { display: flex; justify-content: flex-end; }

.filter-pills { display: flex; gap: 4px; background: var(--overlay-track); padding: 3px; border-radius: var(--radius-pill); }
.pill-btn {
  border: none; background: transparent; padding: 4px 11px; border-radius: var(--radius-pill);
  font-size: 12px; font-weight: 600; color: var(--text-2); cursor: pointer;
}
.pill-btn.on { background: var(--seg-active-bg); color: var(--text-0); }

.config-switch { display: inline-flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.switch {
  width: 38px; height: 22px; border-radius: 99px; background: var(--bg-3);
  position: relative; transition: background 0.18s;
}
.switch::after {
  content: ''; position: absolute; top: 3px; left: 3px;
  width: 16px; height: 16px; border-radius: 50%; background: #fff;
  transition: transform 0.18s;
}
.switch.on { background: var(--accent); }
.switch.on::after { transform: translateX(16px); }

@media (max-width: 900px) {
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
