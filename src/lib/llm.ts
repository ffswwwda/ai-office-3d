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
