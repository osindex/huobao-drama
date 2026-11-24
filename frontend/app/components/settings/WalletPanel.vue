<template>
  <div class="settings-scroll">
    <div class="settings-head">
      <div class="wallet-head-row">
        <div>
          <h2 class="settings-title">算力钱包与购买充值</h2>
          <p class="settings-desc">当前结算账户：<strong>{{ wallet?.team_name || authState.currentTeam?.name || '默认工作空间' }}</strong> · 支持卡密秒到账与套餐订单充值，团队内共享算力池</p>
        </div>
        <span class="tag" :class="wallet?.billing_enabled ? 'tag-accent' : ''">
          {{ wallet?.billing_enabled ? '⚡ 按量算力计费已开启' : '当前处于免扣费模式' }}
        </span>
      </div>
    </div>

    <!-- 钱包指标概览 -->
    <div class="metric-grid">
      <div class="card metric-card highlight">
        <div class="metric-label">可用算力点数</div>
        <div class="metric-value mono">{{ Number(wallet?.credit_balance || 0).toLocaleString() }}</div>
        <div class="metric-sub">任务提交预冻结 · 失败自动全额退回</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">生成中预冻结</div>
        <div class="metric-value mono">{{ Number(wallet?.frozen_credits || 0).toLocaleString() }}</div>
        <div class="metric-sub">异步图片/视频任务进行中</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">团队累计充值 / 消耗</div>
        <div class="metric-value mono">{{ Number(wallet?.total_recharged || 0).toLocaleString() }} <span class="dim">/ {{ Number(wallet?.total_consumed || 0).toLocaleString() }}</span></div>
        <div class="metric-sub">单位：算力点</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">我的个人配额</div>
        <div class="metric-value mono">
          <template v-if="wallet?.member_credit_limit != null">
            {{ wallet.member_credit_used }} / {{ wallet.member_credit_limit }}
          </template>
          <template v-else>不限额</template>
        </div>
        <div class="metric-sub">由团队管理员配置个人上限</div>
      </div>
    </div>

    <!-- 充值卡密即时兑换 -->
    <section class="card panel-card redeem-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">卡密充值 · 即时到账</div>
          <div class="panel-card-sub">输入购买或获赠的充值卡密（格式如 HB-XXXX-XXXX-XXXX），算力将立即充入当前团队钱包</div>
        </div>
        <span class="tag tag-success">推荐 · 秒到账</span>
      </div>
      <form class="redeem-row" @submit.prevent="handleRedeem">
        <input
          v-model.trim="redeemCode"
          class="input mono"
          placeholder="请输入充值卡密，例如 HB-8K9M-2P4Q-7W3X"
          :disabled="!canWrite || redeeming"
          required
        />
        <button type="submit" class="btn btn-primary" :disabled="!canWrite || redeeming || !redeemCode">
          <Loader2 v-if="redeeming" :size="13" class="animate-spin" />
          <Sparkles v-else :size="13" />
          立即兑换充入
        </button>
      </form>
    </section>

    <!-- 购买算力套餐（预留在线收银台 + 订单入账） -->
    <section class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">购买算力套餐 / API 调用额度</div>
          <div class="panel-card-sub">选购套餐创建充值订单（支持网页工作台与团队开放 API Key 通用消耗；在线支付收银台将在下一阶段开放）</div>
        </div>
      </div>

      <div v-if="packages.length" class="pkg-grid">
        <div v-for="pkg in packages" :key="pkg.id" class="pkg-card">
          <div class="pkg-name">{{ pkg.name }}</div>
          <div class="pkg-credits mono">
            {{ Number(pkg.credits).toLocaleString() }} <span>点</span>
            <em v-if="pkg.bonus_credits > 0" class="pkg-bonus">+赠 {{ pkg.bonus_credits }} 点</em>
          </div>
          <div class="pkg-price mono">¥{{ (Number(pkg.price_cents || 0) / 100).toFixed(2) }}</div>
          <div class="pkg-desc dim">{{ pkg.description || '团队共享算力包，永久有效不过期' }}</div>
          <button
            type="button"
            class="btn btn-primary btn-sm pkg-btn"
            :disabled="!canWrite || orderingPkgId === pkg.id"
            @click="handleCreateOrder(pkg)"
          >
            {{ orderingPkgId === pkg.id ? '生成订单中...' : '选购下单' }}
          </button>
        </div>
      </div>

      <div v-if="latestOrderNotice" class="order-notice">
        <div>
          <strong>订单已创建：</strong><code class="mono">{{ latestOrderNotice.order_no }}</code>
          （{{ latestOrderNotice.package_name }} · {{ latestOrderNotice.credits }} 点 · ¥{{ (latestOrderNotice.amount_cents / 100).toFixed(2) }}）
        </div>
        <div class="dim" style="margin-top:4px">{{ latestOrderNotice.notice }}</div>
      </div>
    </section>

    <!-- 平台算力计费价格表 -->
    <section class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">算力计费标准公示</div>
          <div class="panel-card-sub">若团队管理员在「AI 服务配置」中绑定了自有 API Key（BYOK），使用自有密钥调用将免扣平台算力</div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="clean-table">
          <thead>
            <tr>
              <th>服务类型</th>
              <th>供应商 / 引擎</th>
              <th>模型匹配</th>
              <th>计费单位</th>
              <th>消耗算力</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pricing" :key="r.id">
              <td><span class="tag">{{ TYPE_NAMES[r.service_type] || r.service_type }}</span></td>
              <td class="mono">{{ r.provider === '*' ? '通用默认' : r.provider }}</td>
              <td class="mono">{{ r.model_pattern === '*' ? '全部模型' : r.model_pattern }}</td>
              <td>{{ UNIT_NAMES[r.billing_unit] || r.billing_unit }}</td>
              <td class="mono"><strong>{{ r.unit_credits }}</strong> 点</td>
              <td class="dim">{{ r.description || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 算力收支流水 -->
    <section class="card panel-card">
      <div class="panel-card-head">
        <div>
          <div class="panel-card-title">团队算力收支明细 ({{ ledgerTotal }})</div>
          <div class="panel-card-sub">完整记录每笔充值、任务预冻结、结算与失败自动退款</div>
        </div>
        <div class="filter-pills">
          <button
            v-for="f in ledgerFilters"
            :key="f.value"
            type="button"
            :class="['pill-btn', { on: ledgerType === f.value }]"
            @click="ledgerType = f.value; ledgerPage = 1; loadLedger()"
          >{{ f.label }}</button>
        </div>
      </div>

      <div v-if="ledgerItems.length" class="table-wrap">
        <table class="clean-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>操作成员</th>
              <th>变动点数</th>
              <th>变动后可用余额</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in ledgerItems" :key="row.id">
              <td class="mono dim">{{ fmtTime(row.created_at) }}</td>
              <td>
                <span class="tag" :class="row.amount > 0 ? 'tag-success' : row.type === 'freeze' ? 'tag-accent' : ''">
                  {{ LEDGER_LABELS[row.type] || row.type }}
                </span>
              </td>
              <td>{{ row.display_name || row.username || '系统' }}</td>
              <td class="mono" :class="row.amount > 0 ? 'pos-num' : 'neg-num'">
                {{ row.amount > 0 ? `+${row.amount}` : row.amount }}
              </td>
              <td class="mono">{{ row.balance_after }}</td>
              <td class="dim">{{ row.description || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty-note">暂无算力流水记录</p>
    </section>
  </div>
</template>

<script setup>
import { Sparkles, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import { billingAPI } from '~/composables/useApi'
import { useAuthState } from '~/composables/useAuthState'

const { authState, canWrite, refreshAuth } = useAuthState()

const wallet = ref(null)
const packages = ref([])
const pricing = ref([])
const redeemCode = ref('')
const redeeming = ref(false)
const orderingPkgId = ref(null)
const latestOrderNotice = ref(null)

const ledgerItems = ref([])
const ledgerTotal = ref(0)
const ledgerPage = ref(1)
const ledgerType = ref('')

const TYPE_NAMES = { text: '文本 Agent', image: '图片生成', video: '视频生成' }
const UNIT_NAMES = { per_call: '按次调用', per_image: '按张生成', per_second: '按视频每秒' }
const LEDGER_LABELS = {
  recharge: '充值入账',
  freeze: '任务预冻结',
  settle: '扣费结算',
  refund: '失败退回',
  adjust: '后台调账',
}
const ledgerFilters = [
  { label: '全部', value: '' },
  { label: '充值', value: 'recharge' },
  { label: '预冻结', value: 'freeze' },
  { label: '直接扣费', value: 'settle' },
  { label: '退款', value: 'refund' },
]

async function loadAll() {
  try {
    const [w, pkgs, pr] = await Promise.all([
      billingAPI.wallet(),
      billingAPI.packages(),
      billingAPI.pricing(),
    ])
    wallet.value = w
    packages.value = pkgs || []
    pricing.value = pr || []
    await loadLedger()
  } catch (e) {
    toastError(e)
  }
}

async function loadLedger() {
  try {
    const res = await billingAPI.ledger(ledgerPage.value, 30, ledgerType.value)
    ledgerItems.value = res.items || []
    ledgerTotal.value = res.total || 0
  } catch (e) {
    toastError(e)
  }
}

async function handleRedeem() {
  if (!redeemCode.value) return
  redeeming.value = true
  try {
    const res = await billingAPI.redeem(redeemCode.value)
    redeemCode.value = ''
    toast.success(`兑换成功！已充入 +${res.added_credits} 点，当前可用 ${res.credit_balance} 点`)
    await refreshAuth()
    await loadAll()
  } catch (e) {
    toastError(e)
  } finally {
    redeeming.value = false
  }
}

async function handleCreateOrder(pkg) {
  orderingPkgId.value = pkg.id
  try {
    const res = await billingAPI.createOrder(pkg.id, 'online_pending')
    latestOrderNotice.value = res
    toast.success(`充值订单 ${res.order_no} 已创建`)
  } catch (e) {
    toastError(e)
  } finally {
    orderingPkgId.value = null
  }
}

function fmtTime(s) {
  if (!s) return ''
  return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

onMounted(loadAll)
watch(() => authState.teamSwitchSeq, () => {
  latestOrderNotice.value = null
  loadAll()
})
</script>

<style scoped>
.settings-scroll { height: 100%; overflow-y: auto; padding: 20px 28px 48px; animation: fadeUp 0.3s var(--ease-out); }
.settings-scroll > * { max-width: 1080px; margin-left: auto; margin-right: auto; }
.settings-scroll > .card + .card { margin-top: 16px; }
.settings-head { margin-bottom: 18px; }
.wallet-head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.settings-title { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.settings-desc { font-size: 13px; color: var(--text-2); margin-top: 6px; }

.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.metric-card { padding: 16px 18px; }
.metric-card.highlight { border-color: var(--accent); background: linear-gradient(180deg, var(--accent-bg), var(--surface-raised)); }
.metric-label { font-size: 12px; color: var(--text-2); font-weight: 600; }
.metric-value { font-size: 24px; font-weight: 800; color: var(--text-0); margin-top: 6px; line-height: 1.2; }
.metric-value span.dim { font-size: 14px; font-weight: 500; }
.metric-sub { font-size: 11px; color: var(--text-3); margin-top: 6px; }

.panel-card { padding: 20px; }
.redeem-card { border: 1.5px solid var(--accent); }
.panel-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.panel-card-title { font-size: 15px; font-weight: 700; color: var(--text-0); }
.panel-card-sub { font-size: 12px; color: var(--text-2); margin-top: 3px; }

.redeem-row { display: flex; gap: 10px; }
.redeem-row .input { flex: 1; font-size: 14px; letter-spacing: 0.04em; }

.pkg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.pkg-card {
  padding: 16px; border-radius: var(--radius-lg);
  border: 1px solid var(--border); background: var(--bg-1);
  display: flex; flex-direction: column; gap: 6px;
}
.pkg-name { font-size: 14px; font-weight: 700; color: var(--text-0); }
.pkg-credits { font-size: 20px; font-weight: 800; color: var(--accent-text); }
.pkg-credits span { font-size: 12px; font-weight: 600; }
.pkg-bonus {
  font-style: normal; font-size: 11px; margin-left: 6px;
  padding: 1px 6px; border-radius: 99px; background: var(--success-bg); color: var(--success);
}
.pkg-price { font-size: 16px; font-weight: 700; color: var(--text-0); }
.pkg-desc { font-size: 11.5px; flex: 1; margin-bottom: 6px; }
.pkg-btn { width: 100%; justify-content: center; }

.order-notice {
  margin-top: 14px; padding: 12px 14px; border-radius: var(--radius);
  background: var(--accent-bg); border: 1px solid var(--accent); font-size: 12.5px;
}

.table-wrap { overflow-x: auto; }
.clean-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.clean-table th {
  text-align: left; padding: 8px 10px; font-size: 11.5px; font-weight: 650;
  color: var(--text-3); border-bottom: 1px solid var(--border); white-space: nowrap;
}
.clean-table td { padding: 10px; border-bottom: 1px solid var(--border); color: var(--text-1); }
.clean-table tr:last-child td { border-bottom: none; }
.pos-num { color: var(--success); font-weight: 700; }
.neg-num { color: var(--text-0); font-weight: 600; }

.filter-pills { display: flex; gap: 4px; background: var(--overlay-track); padding: 3px; border-radius: var(--radius-pill); }
.pill-btn {
  border: none; background: transparent; padding: 4px 11px; border-radius: var(--radius-pill);
  font-size: 12px; font-weight: 600; color: var(--text-2); cursor: pointer;
}
.pill-btn.on { background: var(--seg-active-bg); color: var(--text-0); }
.empty-note { font-size: 12.5px; color: var(--text-3); }

@media (max-width: 900px) {
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .redeem-row { flex-direction: column; }
}
</style>
