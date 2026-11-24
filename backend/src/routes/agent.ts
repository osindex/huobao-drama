/**
 * Agent 聊天路由 — 非流式版本
 */
import { Hono } from 'hono'
import { validAgentTypes } from '../agents/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { mastra } from '../mastra/index.js'
import { chargeTextAgentCall } from '../services/billing.js'
import { checkEpisodeIdAccess, respondAccessDenied } from '../services/team-access.js'
import { success, badRequest } from '../utils/response.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

// Mastra v1.17 的 ToolCallChunk / ToolResultChunk 结构：
// { type: 'tool-call', payload: { toolCallId, toolName, args } }
// { type: 'tool-result', payload: { toolCallId, toolName, result, isError } }
function normalizeToolName(entry: any) {
  return entry?.payload?.toolName
    || entry?.toolName
    || entry?.tool?.toolName
    || entry?.tool?.id
    || entry?.name
    || entry?.type
    || null
}

function normalizeToolResult(entry: any) {
  const result = entry?.payload?.result ?? entry?.result ?? entry?.payload?.output ?? entry?.output ?? entry?.data ?? null
  return typeof result === 'string' ? result : JSON.stringify(result)
}

// POST /agent/:type/chat — 非流式 Agent 对话
app.post('/:type/chat', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) {
    return badRequest(c, `无效的 Agent 类型：${agentType}`)
  }

  const body = await c.req.json()
  const { message, drama_id, episode_id } = body

  if (!episode_id || !drama_id) {
    logTaskError('Agent', agentType, { reason: 'missing drama_id or episode_id' })
    return badRequest(c, '需要 drama_id 与 episode_id')
  }

  const epAccess = checkEpisodeIdAccess(Number(episode_id), 'write')
  if (!epAccess.ok) return respondAccessDenied(c, epAccess)
  if (epAccess.episode!.dramaId !== Number(drama_id)) {
    return badRequest(c, '剧集与项目不匹配')
  }

  logTaskStart('Agent', agentType, {
    dramaId: drama_id,
    episodeId: episode_id,
    message,
  })
  logTaskPayload('Agent', `${agentType} input`, body)

  const agent = mastra.getAgent(agentType)
  if (!agent) {
    logTaskError('Agent', agentType, { reason: 'agent not found' })
    return badRequest(c, 'Agent 不存在')
  }

  const requestContext = buildAgentRequestContext({
    episodeId: Number(episode_id),
    dramaId: Number(drama_id),
    modelOverride: body.model || undefined,
    textConfigId: body.config_id || undefined,
  })

  const startTime = performance.now()

  try {
    await chargeTextAgentCall({
      model: body.model || undefined,
      configId: body.config_id || undefined,
      description: `AI 智能体调用（${agentType}）`,
    })

    // Keep each non-streaming model response small enough for relay timeouts.
    // More steps allow the agent to finish the episode in smaller save batches.
    const agentMessage = agentType === 'storyboard_breaker'
      ? `${message}\n\n执行约束：每次 save_storyboards 最多保存 3 个分镜，不要一次生成整集工具参数。第一批 replace_existing=true，后续追加，shot_number 连续递增；持续调用直到完整保存整集，不要只保存第一批。若用户指定 wan2.2-i2v-14b，则每个分镜必须为 2–5 秒、单首帧、静音，优先于通用的 8–15 秒段落规则。`
      : message
    const result = await agent.generate(
      [{ role: 'user', content: agentMessage }],
      { maxSteps: agentType === 'storyboard_breaker' ? 60 : 20, requestContext },
    )

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskSuccess('Agent', agentType, { elapsedSeconds: elapsed })

    // 收集所有 tool calls 和 results
    const toolCalls = result.toolCalls || []
    const toolResults = result.toolResults || []
    const normalizedToolCalls = toolCalls.map((tc: any) => ({
      toolName: normalizeToolName(tc),
      args: tc?.payload?.args ?? tc?.args ?? tc?.input ?? null,
    }))
    const normalizedToolResults = toolResults.map((tr: any) => ({
      toolName: normalizeToolName(tr),
      result: normalizeToolResult(tr),
    }))

    logTaskProgress('Agent', 'tool-summary', {
      agentType,
      toolCalls: normalizedToolCalls.map((tc: any) => tc.toolName),
      toolResults: normalizedToolResults.map((tr: any) => tr.toolName),
    })
    logTaskPayload('Agent', `${agentType} tool-results`, normalizedToolResults)

    return success(c, {
      type: 'done',
      text: result.text || '',
      toolCalls: normalizedToolCalls,
      toolResults: normalizedToolResults,
    })
  } catch (err: any) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskError('Agent', agentType, {
      elapsedSeconds: elapsed,
      error: err.message,
      upstreamStatus: err.statusCode ?? err.cause?.statusCode,
      retryable: err.isRetryable,
    })
    console.error(err.stack || err)
    const upstreamStatus = err.statusCode ?? err.cause?.statusCode
    const detail = err.message && err.message !== '<none>' ? err.message : '文本模型调用失败'
    return badRequest(c, `${detail}${upstreamStatus ? `（上游 HTTP ${upstreamStatus}）` : ''}；请刷新检查已保存内容，避免重复提交整集任务`)
  }
})

// GET /agent/:type/debug
app.get('/:type/debug', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) return badRequest(c, '无效的 Agent 类型')
  return success(c, { agent_type: agentType, valid: true })
})

export default app
