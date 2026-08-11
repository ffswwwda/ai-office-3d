/** LLM 适配器（BYOK，浏览器直连 OpenAI 兼容接口）
 *  密钥仅存浏览器 localStorage，绝不进仓库。
 *  无密钥 / 调用失败时由上层回退到规则引擎。
 */
import { getLLMConfig } from '@/store/workspaceStore'

export interface LLMContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | LLMContentPart[]
}

/** 调用一次对话补全。失败抛错，由上层 catch 回退。 */
export async function callLLM(messages: LLMMessage[], opts?: { temperature?: number; timeoutMs?: number }): Promise<string> {
  const cfg = getLLMConfig()
  const key = cfg.key.trim()
  if (!key) throw new Error('NO_KEY')

  const base = (cfg.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const url = base + '/chat/completions'
  const model = cfg.model || 'gpt-4o-mini'
  const timeoutMs = opts?.timeoutMs ?? 60000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts?.temperature ?? 0.7,
        stream: false,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error('HTTP_' + res.status + ' ' + txt.slice(0, 200))
    }
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') throw new Error('EMPTY_RESPONSE')
    return content
  } finally {
    clearTimeout(timer)
  }
}

/** 便捷：单轮 system+user。opts.images 为图片 data URL 列表，传入后 user 消息变为多模态（视觉模型可见图）。 */
export async function chatOnce(
  system: string,
  user: string,
  opts?: { temperature?: number; images?: string[] },
): Promise<string> {
  const userContent: string | LLMContentPart[] = opts?.images && opts.images.length > 0
    ? [
        { type: 'text', text: user },
        ...opts.images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ]
    : user
  return callLLM([{ role: 'system', content: system }, { role: 'user', content: userContent }], opts)
}

/** 流式对话（SSE）。逐 chunk 回调 onToken，最终返回完整文本。失败抛错由上层回退。
 *  opts.signal 可用来主动中断流式输出（中断会抛出 name='AbortError' 的错误）。
 */
export async function streamChat(
  system: string,
  user: string | LLMContentPart[],
  onToken: (delta: string) => void,
  opts?: { temperature?: number; images?: string[]; timeoutMs?: number; signal?: AbortSignal },
): Promise<string> {
  const cfg = getLLMConfig()
  const key = cfg.key.trim()
  if (!key) throw new Error('NO_KEY')

  const base = (cfg.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const url = base + '/chat/completions'
  const model = cfg.model || 'gpt-4o-mini'
  const timeoutMs = opts?.timeoutMs ?? 120000

  const userContent: string | LLMContentPart[] = opts?.images && opts.images.length > 0
    ? [
        ...(Array.isArray(user) ? user : [{ type: 'text' as const, text: user }]),
        ...opts.images.map((u): LLMContentPart => ({ type: 'image_url', image_url: { url: u } })),
      ]
    : user

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const externalSignal = opts?.signal
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
        temperature: opts?.temperature ?? 0.7,
        stream: true,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error('HTTP_' + res.status + ' ' + txt.slice(0, 200))
    }
    if (!res.body) throw new Error('NO_BODY')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let full = ''
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const delta = json?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) {
            full += delta
            onToken(delta)
          }
        } catch { /* 跳过非 JSON / 心跳行 */ }
      }
    }
    if (full.trim() === '') throw new Error('EMPTY_RESPONSE')
    return full
  } finally {
    clearTimeout(timer)
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }
}
