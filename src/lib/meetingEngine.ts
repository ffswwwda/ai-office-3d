/** 会议引擎：多智能体发言 / 任务规划 / 任务产出
 *  统一策略：LLM 优先（BYOK），任何失败/无密钥都回退到规则引擎。
 *  保证「当下无密钥也能跑通完整产品」，接入密钥后自动升级为真实生成。
 */
import { chatOnce } from '@/lib/llm'
import { kbOf, describeSources, composeSystemPrompt, isGuest } from '@/lib/employeeKB'
import { memoryToText } from '@/lib/employeeMemory'
import { isLLMEnabled } from '@/store/workspaceStore'

export interface ChatAttachment {
  name: string
  /** markdown/csv/txt：员工生成的可下载文件；image/file：用户从本机上传的附件 */
  type: 'markdown' | 'csv' | 'txt' | 'image' | 'file'
  content: string
}

export interface ChatMsg {
  role: 'user' | string // 'user' 或员工 id
  text: string
  attachments?: ChatAttachment[]
}

export interface MeetingContext {
  topic: string
  purpose: string
  thread: ChatMsg[]
}

/** buildReply 的额外选项：当前员工是否要附带可下载文件 / 发起人最新消息是否带图片 */
export interface BuildReplyOptions {
  isFileOwner?: boolean
  attachment?: ChatAttachment
  /** 发起人最新消息携带的图片 data URL，传入后视觉模型可"看见"图片 */
  images?: string[]
}

/** 把会话线程压缩成给 LLM 的上下文文本 */
function threadToText(thread: ChatMsg[], nameOf: (id: string) => string): string {
  const tail = thread.slice(-8)
  return tail.map((m) => {
    const imgMark = m.attachments?.some((a) => a.type === 'image') ? '（附图片）' : ''
    const fileMark = m.attachments?.some((a) => a.type !== 'image') ? '（附文件）' : ''
    return (m.role === 'user' ? '发起人：' + m.text : nameOf(m.role) + '：' + m.text) + imgMark + fileMark
  }).join('\n')
}

/** 检测用户是否索要文件（表格/文档/CSV/报告等） */
export function detectFileRequest(text: string): boolean {
  return /(表格|csv|excel|xlsx|文档|doc|报告|文件|导出|下载|整理成|输出成|生成.*表|筛选.*表|筛选.*结果|清单.*表|给我.*表|给我.*文件|给我.*报告|发我.*表|发我.*文件|发我.*报告)/i.test(text)
}

/** 根据请求判断文件类型 */
export function fileTypeFromRequest(text: string): ChatAttachment['type'] {
  if (/csv|excel|xlsx|表格|表/i.test(text)) return 'csv'
  if (/doc|文档|报告|md|markdown/i.test(text)) return 'markdown'
  return 'txt'
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60)
}

/** 为员工生成聊天文件附件：接入 LLM 时按请求生成真实内容，否则用规则兜底 */
export async function buildChatAttachment(
  ownerId: string,
  requestText: string,
  ctx: MeetingContext,
  nameOf: (id: string) => string,
): Promise<ChatAttachment | null> {
  const kb = kbOf(ownerId)
  if (kb.guest) return null // 跨行业访客不生成专业文件
  const type = fileTypeFromRequest(requestText)
  const topic = ctx.topic || '会议主题'

  if (isLLMEnabled()) {
    try {
      const sys = `${composeSystemPrompt(ownerId, memoryToText(ownerId))}
用户正在会议室里向你索要一份可下载的文件。请基于会议主题、目的与真实讨论记录，生成文件正文。

要求：
1. 不要寒暄、不要解释，只输出文件正文。
2. 文件类型：${type === 'csv' ? 'CSV（首行为表头，逗号分隔，内容用双引号包裹含逗号的字段）' : type === 'markdown' ? 'Markdown 文档' : '纯文本'}
3. 内容必须能从讨论记录中找到依据，禁止编造未出现的内容。
4. 若为表格，至少包含「要点 / 提出者 / 依据 / 优先级 / 下一步」等列；若为文档，按「结论 / 依据 / 行动项」组织。`
      const user = `会议主题：${ctx.topic}
会议目的：${ctx.purpose}

近期讨论：
${threadToText(ctx.thread, nameOf)}

用户请求：${requestText}

请直接输出文件正文：`
      const out = await chatOnce(sys, user, { temperature: 0.4 })
      if (out && out.trim().length > 0) {
        return {
          name: sanitizeFileName(`${topic}_${kb.name}_${type === 'csv' ? '筛选表' : '总结'}`) + (type === 'csv' ? '.csv' : type === 'markdown' ? '.md' : '.txt'),
          type,
          content: out.trim(),
        }
      }
    } catch { /* 回退规则 */ }
  }

  // 规则兜底：基于最近讨论生成一份简单表格/文档
  const tail = ctx.thread.slice(-12).filter((m) => m.text && m.text.trim())
  if (type === 'csv') {
    const lines: string[] = ['要点,提出者,依据,优先级,下一步']
    tail.forEach((m, i) => {
      const who = m.role === 'user' ? '发起人' : nameOf(m.role)
      const summary = m.text.replace(/\n/g, ' ').replace(/"/g, '""').slice(0, 80)
      lines.push(`"${summary}","${who}","讨论记录 #${i + 1}","P${Math.min(i + 1, 5)}","待收敛"`)
    })
    return {
      name: sanitizeFileName(`${topic}_${kb.name}_筛选表`) + '.csv',
      type: 'csv',
      content: lines.join('\n'),
    }
  }
  const lines: string[] = [`# ${topic} · ${kb.name}总结`, '', `> 生成时间：${new Date().toLocaleString('zh-CN')}`, '']
  lines.push('## 讨论要点')
  tail.forEach((m, i) => {
    const who = m.role === 'user' ? '发起人' : nameOf(m.role)
    lines.push(`${i + 1}. **${who}**：${m.text.replace(/\n+/g, ' ').trim()}`)
  })
  lines.push('')
  lines.push('## 建议下一步')
  lines.push(`- 由 ${kb.name} 基于 ${kb.dataSources.slice(0, 3).join('、')} 进一步收敛为 ${kb.deliverable}。`)
  return {
    name: sanitizeFileName(`${topic}_${kb.name}_总结`) + '.md',
    type: 'markdown',
    content: lines.join('\n'),
  }
}

/** 把附件作为文件下载；图片/文件使用已保存的 data URL */
export function downloadAttachment(att: ChatAttachment) {
  if (att.type === 'image' || att.type === 'file') {
    const a = document.createElement('a')
    a.href = att.content
    a.download = att.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    return
  }
  const mime = att.type === 'csv' ? 'text/csv;charset=utf-8' : att.type === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
  const blob = new Blob(['\uFEFF' + att.content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = att.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/** 把员工可访问的数据源格式化成一段上下文，注入 system/user prompt */
function sourceContext(id: string): string {
  const kb = kbOf(id)
  const ready = kb.dataSources.filter((sid) => sid && describeSources([sid]))
  if (ready.length === 0) return '【当前未接入具体数据源】'
  return describeSources(ready)
}

/* ───────── 1. 多智能体发言（圆桌讨论） ───────── */
export async function buildReply(
  id: string,
  ctx: MeetingContext,
  nameOf: (id: string) => string,
  opts?: BuildReplyOptions,
): Promise<string> {
  const kb = kbOf(id)
  const userMsgs = ctx.thread.filter((m) => m.role === 'user')
  const latest = userMsgs[userMsgs.length - 1]?.text ?? ctx.purpose
  const att = opts?.isFileOwner && opts?.attachment ? opts.attachment : null
  const images = opts?.images && opts.images.length > 0 ? opts.images : null
  const fileNote = att
    ? `\n\n【注意：本次回复会附带一个可下载文件「${att.name}」。你在发言里必须说明这份文件按什么维度筛选/总结、并提醒用户点击文件下载；禁止再说"我没法发文件"或让用户去其他页面手动导出。】`
    : ''
  const imageNote = images
    ? `\n\n【重要：发起人最新消息附带了 ${images.length} 张图片，你已能"看见"这些图片内容。请结合图片里的信息（如图表、截图、数据、设计稿等）给出看法，而不要假装没看到图。】`
    : ''

  if (isLLMEnabled()) {
    try {
      const sys = `${composeSystemPrompt(id, memoryToText(id))}\n你现在参加一个多智能体圆桌会议，其他同事和发起人都在场。${fileNote}${imageNote}\n\n【你当前可访问的数据源详情】\n${sourceContext(id)}\n\n请基于你的领域知识，对发起人的最新发言给出你的专业看法：指出关键风险、补充被忽略的角度、给出可落地的建议。

【输出格式规则】
1. 用第一人称、口语化，不要寒暄标题，直接说观点。
2. 如果内容超过 2 句话，或包含多个并列要点，请分成多段，段与段之间空一行。
3. 遇到步骤、维度、风险、建议、优劣势等并列信息时，优先使用 "1. / 2. / 3." 或 "- " 列表输出，而不是挤成一段。
4. 每条要点控制在 1-2 行内，整体保持 2-5 个要点/段落，避免大段连续文字。`
      const user = `会议主题：${ctx.topic}\n会议目的：${ctx.purpose}\n\n近期讨论：\n${threadToText(ctx.thread, nameOf)}\n\n发起人最新说：${latest}\n\n请给出你的看法：`
      const out = await chatOnce(sys, user, { temperature: 0.8, images: images ?? undefined })
      if (out && out.trim().length > 0) return out.trim()
    } catch { /* 回退规则 */ }
  }
  return ruleReply(id, ctx, latest, opts)
}

function ruleReply(id: string, ctx: MeetingContext, latest: string, opts?: BuildReplyOptions): string {
  const kb = kbOf(id)
  // 跨行业访客（外卖员豆包）：不带任何本站知识库/技能，纯外行创意视角
  if (kb.guest) {
    const topic = ctx.topic || '你们聊的事'
    if (opts?.images?.length) {
      return `（我是送咖啡的豆包，凑近看了一眼你发的图）哎呀这图我外行看就是一堆东西，但我从"路人视角"说句大实话——你们自己盯着图看容易钻牛角尖，跳出来想：这图到底想说啥？别被图里的细节带跑。你们继续，我负责撒点不一样的料～`
    }
    return `（我是送咖啡的豆包，刚在门口旁听了一会儿）外行说句大实话啊——你们聊的「${topic}」，我听下来的感觉是：专业的人容易钻进自己的框里。我送外卖跑遍全城，有个不成熟的类比：这事换个「门外汉」的脑子看，说不定没那么复杂。你们继续，我负责戳窟窿、撒点不一样的料～`
  }

  // 发起人发了图但当前未接入视觉模型：规则回退也感知到图片，避免"假装没看到"
  if (opts?.images?.length) {
    const lead = `我看到你发的这张图了（当前未接入视觉大模型，我是按文字讨论来理解的）。关于「${ctx.topic}」，我的角度是：`
    const body = `我已接入主站点的${kb.dataSources.length}个数据源，包括${kb.dataSources.slice(0, 3).join('、')}等；主要技能有${kb.skills.slice(0, 3).join('、')}。如果图里是数据/截图/设计稿，建议你点开看细节，我可以结合图里的具体点帮你分析。`
    return lead + body
  }

  // 如果当前员工生成了文件附件，规则回退直接指向文件，不再说"没法发文件"
  if (opts?.isFileOwner && opts?.attachment) {
    const att = opts.attachment
    const rows = att.type === 'csv' ? Math.max(0, att.content.split('\n').length - 1) + '' : '若干'
    return `已按你的要求生成「${att.name}」（${att.type === 'csv' ? 'CSV 表格' : att.type === 'markdown' ? 'Markdown 文档' : '文本'}），点击下方文件即可下载。内容基于本次会议讨论整理，共 ${rows} 条要点。`
  }

  const text = (latest + ' ' + ctx.topic + ' ' + ctx.purpose).toLowerCase()
  const hit = kb.dataSources.some((sid) => text.includes(sid.toLowerCase()) || (sid.length >= 2 && text.includes(sid.toLowerCase().slice(0, 2))))
  const riskWord = /风险|不确定|担心|可能|存疑|隐患|翻车/.test(ctx.purpose + latest)
  const lead = riskWord ? `我比较谨慎——「${ctx.topic}」里我看到的隐患是：` : `关于「${ctx.topic}」，我的角度是这样的：`
  const body = `我已接入主站点的${kb.dataSources.length}个数据源，包括${kb.dataSources.slice(0, 3).join('、')}等；主要技能有${kb.skills.slice(0, 3).join('、')}。建议你先落到「${kb.deliverable}」上，证据足了再扩大。`
  const tail = hit ? '这一块我有现成的方法，可以直接接。' : '不过这块如果缺数据，结论要先打问号。'
  return `${lead}\n\n${body}\n\n${tail}`
}

/* ───────── 2. 规划：每位员工提议自己要认领的任务 ───────── */
export function buildPlanItems(invited: string[], ctx: MeetingContext): Array<{ ownerId: string; title: string }> {
  // 跨行业访客（豆包）只参与讨论、不认领执行任务，避免把外行塞进专业交付流程
  return invited.filter((id) => !isGuest(id)).map((id) => {
    const kb = kbOf(id)
    const topic = ctx.topic || '本次会议主题'
    const titleMap: Record<string, string> = {
      voc: `产出「${topic}」相关 VOC 标签分布与用户痛点摘要`,
      score: `对「${topic}」概念做四维评分并附证据`,
      lab: `对「${topic}」做数字世界多场景策略推演`,
      dev: `围绕「${topic}」生成产品开发方向与 FABE 文案`,
      idea: `为「${topic}」产出创意图与视觉概念`,
      stress: `对「${topic}」方案做虚拟用户压力测试`,
      pr: `将「${topic}」相关表达做多市场地道本地化`,
    }
    return { ownerId: id, title: titleMap[id] ?? `负责「${topic}」的${kb.role}` }
  })
}

/* ───────── 3. 任务产出（执行阶段的交付物） ───────── */
export async function buildTaskOutput(id: string, title: string, ctx: MeetingContext, nameOf: (id: string) => string): Promise<string> {
  const kb = kbOf(id)
  if (isLLMEnabled()) {
    try {
      const sys = `${composeSystemPrompt(id, memoryToText(id))}\n你是会议中被分派执行任务的一员，现在要交付真正的成果（不是占位）。\n\n【你当前可访问的数据源详情】\n${sourceContext(id)}\n\n交付要求：用 Markdown，中文，结构清晰、具体可落地。按「一、结论 / 二、依据（引用具体数据源与字段）/ 三、关键要点 / 四、可执行下一步」组织；需要对比、清单或评分时用 Markdown 表格；所有判断必须可溯源到已接入的数据源，证据不足处明确标注「数据不足」而非编造。不要寒暄、不要标题以外的客套。`
      const user = `会议主题：${ctx.topic}\n会议目的：${ctx.purpose}\n\n你的任务：${title}\n\n可接入的数据源：${describeSources(kb.dataSources)}\n你掌握的技能：${kb.skills.join('、')}\n期望交付物形态：${kb.deliverable}\n\n近期讨论（请据此收敛你的交付重点）：\n${threadToText(ctx.thread, nameOf)}\n\n请直接产出该任务的最终交付物正文：`
      const out = await chatOnce(sys, user, { temperature: 0.45 })
      if (out && out.trim().length > 0) return out.trim()
    } catch { /* 回退规则 */ }
  }
  return ruleTaskOutput(id, title, ctx)
}

function ruleTaskOutput(id: string, title: string, ctx: MeetingContext): string {
  const kb = kbOf(id)
  const topic = ctx.topic || '本次会议主题'
  if (kb.guest) {
    return `# ${title}\n\n> 负责人：${kb.name}（${kb.role}）\n> 会议主题：${topic}\n\n## 一、外行视角启发\n- 作为跨行业访客，我（${kb.name}）用「送咖啡的外卖员 / 局外人」视角，对本次主题补一段不按常理的启发式点评，不产出专业交付物。\n- 我的价值是「换个脑子」：用跨行业类比、普通人直觉，去戳专业框架的盲点或给点脑洞。\n\n## 二、下一步\n- 把我的反差视角交给在场的专业同事去收敛，我只负责让你们别钻进同一个框里。\n\n> 说明：访客不挂载任何本站知识库与技能，以上为外行创意视角，非专业结论。`
  }
  const lines: string[] = []
  lines.push(`# ${title}`)
  lines.push('')
  lines.push(`> 负责人：${kb.name}（${kb.role}）`)
  lines.push(`> 会议主题：${topic}`)
  lines.push('')
  lines.push('## 一、依据的数据源')
  kb.dataSources.forEach((sid) => lines.push(`- ${sid}`))
  lines.push('')
  lines.push('## 二、关键要点')
  lines.push(`- 围绕「${topic}」，从${kb.role}视角，优先确认最核心的 2-3 个判断依据。`)
  lines.push(`- 用${kb.dataSources[0] ?? '领域数据'}做证据底座，避免平均意见稀释。`)
  lines.push(`- 可用技能：${kb.skills.join('、')}。`)
  lines.push(`- 输出形态对齐预期交付物：${kb.deliverable}。`)
  lines.push('')
  lines.push('## 三、下一步')
  lines.push(`- 将以上要点沉淀为可交付的「${kb.deliverable}」，并标注数据缺口。`)
  lines.push('')
  lines.push('> 说明：当前为规则引擎生成的占位交付物（未接入大模型）。在会议室设置中填入 API Key 后，这里会自动替换为该员工基于真实知识库生成的实质内容。')
  return lines.join('\n')
}

/* ───────── 4. 任务阶段（把一次执行拆成可见进展的子步骤） ───────── */
export interface TaskStageSeed {
  name: string
  outputHint: string
}

/** 不同角色的阶段模板（统一四段：澄清→草案→评审→交付） */
const STAGE_TEMPLATES: Record<string, TaskStageSeed[]> = {
  voc: [
    { name: '数据接入与清洗', outputHint: '圈定相关 VOC 语料范围、剔除噪声' },
    { name: '标签分布计算', outputHint: '9 维标签覆盖度与高频痛点清单' },
    { name: '交叉校验', outputHint: '小测/小预对结论做信度复核' },
    { name: '洞察交付', outputHint: '用户痛点摘要 + 证据行号' },
  ],
  score: [
    { name: '维度建模', outputHint: '四维（痛点/技术/市场/竞争）打分框架' },
    { name: '证据打分', outputHint: '逐维匹配数据源并落分' },
    { name: '敏感性检查', outputHint: '小测复核打分鲁棒性' },
    { name: '评分交付', outputHint: '总分牌 + 短板说明' },
  ],
  lab: [
    { name: '场景拆解', outputHint: '数字世界多场景枚举' },
    { name: '策略推演', outputHint: '各场景下的打法与预期' },
    { name: '可行性评审', outputHint: '小创/小分对落地性评估' },
    { name: '推演交付', outputHint: '场景×策略矩阵' },
  ],
  dev: [
    { name: '需求澄清', outputHint: '明确产品开发边界与约束' },
    { name: '方案草案', outputHint: '产品方向与核心功能草案' },
    { name: 'FABE 打磨', outputHint: '卖点与详情页文案初稿' },
    { name: '交付', outputHint: '开发方向文档 + 文案' },
  ],
  idea: [
    { name: '概念发散', outputHint: '创意图方向枚举' },
    { name: '视觉草案', outputHint: '核心视觉概念稿' },
    { name: '风格评审', outputHint: '小设/小创评审一致性' },
    { name: '交付', outputHint: '创意 + 视觉概念说明' },
  ],
  stress: [
    { name: '用户构建', outputHint: '基于 VOC 的虚拟用户群' },
    { name: '压力测试', outputHint: '概念/功能/文案挑刺结论' },
    { name: '归因整理', outputHint: '支持/中立/反对立场与驱动因子' },
    { name: '交付', outputHint: '高风险用户排名 + 建议' },
  ],
  pr: [
    { name: '语料对齐', outputHint: '对齐目标市场用户真实表达' },
    { name: '地道改写', outputHint: '多市场本地化初稿' },
    { name: '文化校验', outputHint: '小测复核禁忌与歧义' },
    { name: '交付', outputHint: '各市场终稿表达' },
  ],
}

export function buildTaskStages(id: string, title: string): TaskStageSeed[] {
  return STAGE_TEMPLATES[id] ?? [
    { name: '需求澄清', outputHint: '明确任务边界与可用数据源' },
    { name: '草案产出', outputHint: '初版交付物草稿' },
    { name: '交叉评审', outputHint: '同事反馈与风险标注' },
    { name: '最终交付', outputHint: '可交付版本 + 数据缺口说明' },
  ]
}

/** 单个阶段的具体产出（规则版；LLM 接入后可在调用处替换为真实生成） */
export function buildStageOutput(
  id: string, title: string, stageName: string, stageHint: string, ctx: MeetingContext,
): string {
  const kb = kbOf(id)
  const topic = ctx.topic || '本次会议主题'
  if (kb.guest) {
    return `### ${stageName}\n> 本阶段产出：${stageHint}\n\n- 作为跨行业访客，我（${kb.name}）用外行视角对「${topic}」补一段启发式点评：${stageHint}。我不产出专业交付物，只负责让你们换个脑子。`
  }
  const lines: string[] = []
  lines.push(`### ${stageName}`)
  lines.push(`> 本阶段产出：${stageHint}`)
  lines.push('')
  switch (stageName) {
    case '数据接入与清洗':
    case '语料对齐':
    case '场景拆解':
    case '需求澄清':
    case '概念发散':
    case '用户构建':
      lines.push(`- 已锚定「${topic}」相关语料，主要来源：${kb.dataSources.join('、')}。`)
      lines.push(`- 可用技能：${kb.skills.join('、')}。`)
      lines.push(`- 边界确认：聚焦与「${title}」直接相关的部分，其余打回待定。`)
      break
    case '标签分布计算':
    case '证据打分':
    case '策略推演':
    case '方案草案':
    case '视觉草案':
    case '压力测试':
    case '地道改写':
      lines.push(`- 基于${kb.dataSources[0] ?? '领域数据'}与${kb.skills[0] ?? '领域技能'}产出初版内容，关键判断已标注证据。`)
      lines.push(`- 当前进展：核心要点已成形，待交叉评审收紧。`)
      break
    case '交叉校验':
    case '敏感性检查':
    case '可行性评审':
    case 'FABE 打磨':
    case '风格评审':
    case '文化校验':
    case '归因整理':
      lines.push(`- 使用技能 ${kb.skills.join('、')} 对初稿复核，已标注风险与待确认项。`)
      lines.push(`- 结论稳健性：在现有数据下可信，缺口处已显式标注。`)
      break
    default:
      lines.push(`- 阶段成果已沉淀为可交付内容，对齐预期交付物：${kb.deliverable}。`)
      lines.push(`- 说明：当前为规则引擎生成的阶段产出（未接入大模型）。在会议室设置中填入 API Key 后，此处会替换为该员工基于真实知识库生成的实质内容。`)
  }
  return lines.join('\n')
}

/* ───────── 0. 发言意图解析（点名 > 广播 > 全员） ───────── */
/** 用户发一句话，决定「谁该发言」：
 *  - 提到某员工姓名 → 仅该人发言（点名优先）
 *  - 出现广播词（大家/都来说/各自/分别…）→ 全员发言
 *  - 什么都没点 → 默认全员发言（未点名时大家轮流说）
 */
export function resolveSpeakers(text: string, invited: string[], nameOf: (id: string) => string): string[] {
  const t = text || ''
  const named = invited.filter((id) => {
    const n = nameOf(id)
    return n && t.includes(n)
  })
  if (named.length > 0) return named
  const broadcast = /(大家|所有人|全部|各位|各自|分别|一起|全体|都(来|说|发|表|讲|聊聊|谈谈|说说)|依次|轮到|每人|逐个|挨个|分头|各抒己见|群策群力|都发言|一起说|都来讲|都来聊)/.test(t)
  if (broadcast) return invited.slice()
  // 未点名且未广播 → 默认全员依次发言
  return invited.slice()
}

/** 根据主题、目的、真实讨论与分工，生成执行方案文档；接入 LLM 时做真正总结，否则回退到精简模板 */
export async function buildPlanDoc(
  topic: string, purpose: string, items: Array<{ ownerId: string; title: string }>,
  messages: ChatMsg[], nameOf: (id: string) => string,
): Promise<string> {
  if (isLLMEnabled()) {
    try {
      const sys = `你是一名资深会议 facilitator。请根据会议主题、目的、真实讨论记录与拟定分工，提炼成一份清晰、可执行的会议纪要 / 执行方案。

要求：
1. 不要简单罗列聊天记录，要基于讨论内容做归纳、收敛、提炼。
2. 结构必须包含：会议目标、关键结论、执行分工、下一步行动、主要风险/待确认项。
3. 用 Markdown，中文，条理清晰；分工部分用表格呈现（负责人 / 任务 / 预期产出）。
4. 结论必须能从讨论记录中找到依据，禁止编造未出现的内容。`
      const thread = messages
        .filter((m) => m.text && m.text.trim())
        .slice(-20)
        .map((m) => `${m.role === 'user' ? '发起人' : nameOf(m.role)}：${m.text.replace(/\n+/g, ' ').trim()}`)
        .join('\n')
      const itemsText = items.map((it, i) => `${i + 1}. ${nameOf(it.ownerId)}（${it.title}）`).join('\n')
      const user = `主题：${topic || '（未填写）'}\n目的：${purpose || '（未填写）'}\n\n讨论记录：\n${thread || '（暂无讨论）'}\n\n拟定执行分工：\n${itemsText || '（暂无分工）'}\n\n请直接生成 Markdown 执行方案：` 
      const out = await chatOnce(sys, user, { temperature: 0.5 })
      if (out && out.trim().length > 0) return out.trim()
    } catch { /* LLM 失败时回退规则版 */ }
  }

  // 规则兜底：精简，不照搬全部发言
  const lines: string[] = []
  lines.push('# 会议规划与执行方案')
  lines.push(`> 主题：${topic || '（未填写）'}`)
  lines.push(`> 目的：${purpose || '（未填写）'}`)
  lines.push(`> 生成时间：${new Date().toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push('## 一、会议目标')
  lines.push(`- 围绕「${topic || '本次会议主题'}」展开，目的为：${purpose || '（未填写）'}`)
  lines.push('')
  lines.push('## 二、执行分工')
  items.forEach((it, i) => {
    const kb = kbOf(it.ownerId)
    lines.push(`${i + 1}. **${nameOf(it.ownerId)}（${kb.role}）**：${it.title}`)
  })
  lines.push('')
  const realMsgs = messages.filter((m) => m.text && m.text.trim())
  if (realMsgs.length > 0) {
    lines.push('## 三、讨论要点（来自真实发言，仅保留最近几条）')
    realMsgs.slice(-6).forEach((m) => {
      const who = m.role === 'user' ? '发起人' : nameOf(m.role)
      const txt = m.text.replace(/\n+/g, ' ').trim()
      lines.push(`- **${who}**：${txt.length > 90 ? txt.slice(0, 90) + '…' : txt}`)
    })
    lines.push('')
    lines.push('## 四、分工说明')
  } else {
    lines.push('## 三、分工说明')
  }
  items.forEach((it) => {
    const kb = kbOf(it.ownerId)
    lines.push(`- ${nameOf(it.ownerId)} 将基于${kb.dataSources.length}个数据源产出「${kb.deliverable}」。`)
  })
  if (!isLLMEnabled()) {
    lines.push('')
    lines.push('> 当前为规则引擎生成的精简方案。在会议室设置中填入 API Key 后，此处会自动替换为大模型基于真实讨论内容生成的总结方案。')
  }
  return lines.join('\n')
}

/* ───────── 5. 阶段产出的 LLM 版本（真实干活） ───────── */
/** 基于真实会议上下文 + 员工知识库，产出某一阶段的实质内容；失败回退规则版 */
export async function buildStageOutputLLM(
  id: string, title: string, stageName: string, stageHint: string, ctx: MeetingContext, nameOf: (id: string) => string,
): Promise<string | null> {
  const kb = kbOf(id)
  try {
    const sys = `${composeSystemPrompt(id, memoryToText(id))}\n你是会议执行阶段「${stageName}」的产出者。请基于你已接入的真实数据源与技能，产出该阶段的实质内容，不要空话套话。\n\n【你当前可访问的数据源详情】\n${sourceContext(id)}\n\n要求：中文、Markdown、具体可落地；需要结构化对比时用 Markdown 表格；必须声明引用的数据源；证据不足时明确标注「数据不足」而非编造。不要寒暄、不要标题以外的客套，直接给内容。`
    const user = `会议主题：${ctx.topic}\n会议目的：${ctx.purpose}\n\n本任务：${title}\n当前阶段：${stageName}（预期产出：${stageHint}）\n\n近期讨论：\n${threadToText(ctx.thread, nameOf)}\n\n请给出该阶段的实质产出：`
    const out = await chatOnce(sys, user, { temperature: 0.5 })
    return out && out.trim().length > 0 ? out.trim() : null
  } catch {
    return null
  }
}
