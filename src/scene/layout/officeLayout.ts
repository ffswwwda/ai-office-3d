import type { Agent, AgentState, Desk } from '@/types/agent'

export const SCENE_WIDTH = 960
export const SCENE_HEIGHT = 640

export const COLORS = {
  floor: 0xffffff,
  wall: 0xe8e6e1,
  desk: 0xffffff,
  deskShadow: 0x00000014,
  monitor: 0x2a2a2a,
  chair: 0xd4d2cc,
  agentBody: 0x1a1a1a,
} as const

/** 7 个工位：前排 4 个 + 后排 3 个（左右居中） */
const FRONT_Y = 430
const BACK_Y = 230
export const SEAT_OFFSET_Y = 45

const FRONT_X = [160, 340, 520, 700]
const BACK_X = [250, 460, 670]

function buildDesks(): Desk[] {
  const desks: Desk[] = []
  let n = 0
  for (let i = 0; i < FRONT_X.length; i++) {
    const x = FRONT_X[i]; const y = FRONT_Y
    desks.push({
      id: `desk-${n}`,
      x, y,
      seatX: x, seatY: y + SEAT_OFFSET_Y,
    })
    n++
  }
  for (let i = 0; i < BACK_X.length; i++) {
    const x = BACK_X[i]; const y = BACK_Y
    desks.push({
      id: `desk-${n}`,
      x, y,
      seatX: x, seatY: y + SEAT_OFFSET_Y,
    })
    n++
  }
  return desks
}

export const DESKS: Desk[] = buildDesks()

export type AgentRosterEntry = {
  id: string
  name: string
  color: number
  task: string
}

/** 7 位模块同事 */
export const AGENT_ROSTER: AgentRosterEntry[] = [
  { id: 'voc',      name: '小灵', color: 0x00d4ff, task: 'VOC 智能打标' },
  { id: 'score',    name: '小分', color: 0xa855f7, task: '需求跳远评分' },
  { id: 'lab',      name: '小预', color: 0x4a90d9, task: '数字世界预测' },
  { id: 'dev',      name: '小创', color: 0xf5c542, task: '新品开发盲盒' },
  { id: 'idea',     name: '小设', color: 0xf97316, task: '抓金矿创意图' },
  { id: 'stress',   name: '小测', color: 0x34c759, task: '虚拟用户压力' },
  { id: 'pr',       name: '小展', color: 0x9b6dd7, task: '原理展厅画廊' },
]

export const INITIAL_AGENTS: Agent[] = AGENT_ROSTER.map((entry, i) => {
  const desk = DESKS[i]
  return {
    id: entry.id,
    name: entry.name,
    color: entry.color,
    gender: (i < 3 ? 'female' : 'male') as 'female' | 'male',
    x: desk.seatX, y: desk.seatY,
    state: 'working' as AgentState,
    currentTask: entry.task,
    assignedDeskId: desk.id,
    facing: i % 2 === 0 ? 1 : -1,
    viewFacing: 'back' as const,
  }
})

/** 自动工作流话术 */
export const HANDOFF_STATUS = {
  delivering: '交接递送中…',
  handingOff: '正在交接…',
  receiving: '接收交接中…',
  wrappingUp: '交接收尾中…',
  planning: '规划交接中…',
} as const

export const HANDOFF_VISIT_MESSAGES: ((hostName: string) => string)[] = [
  (n) => `${n}，这件事交给你了。`,
  (n) => `${n}，轮到你了，说明在工单里。`,
  (n) => `${n}，接力给你，上下文在线程里。`,
  (n) => `${n}，你队列里有最新的交接包。`,
  (n) => `${n}，工单已转给你，我这边解除了阻塞。`,
  (n) => `${n}，能从这里接手吗？`,
  (n) => `${n}，我这边交接完成，交给你了。`,
  (n) => `${n}，收到后请确认一下。`,
]

export function pickHandoffVisitMessage(hostName: string, hostRosterNo: number): string {
  const i = Math.abs(hostRosterNo - 1) % HANDOFF_VISIT_MESSAGES.length
  return HANDOFF_VISIT_MESSAGES[i]!(hostName)
}

/** 真实项目（点侧边栏「项目」展开，展示分工 / 进展 / 输出成果） */
export type ProjectMember = { id: string; role: string }
export type Project = {
  id: string
  name: string
  icon: string
  status: '进行中' | '规划中' | '已完成'
  progress: number
  ownerId: string
  memberIds: string[]
  desc: string
  division: string[]
  progressText: string
  outputs: string[]
  link?: string
}

export const PROJECTS: Project[] = [
  {
    id: 'user-research',
    name: '用户研究 · 类目洞察',
    icon: 'i-users',
    status: '进行中',
    progress: 75,
    ownerId: 'voc',
    memberIds: ['voc', 'lab', 'pr'],
    desc: '围绕飞机杯 / 震动棒 / 润滑液等成人用品类目，从 VOC 评论出发做标签化洞察，沉淀标签体系与预测能力。',
    division: [
      '小灵：VOC 9 维智能打标（动机 / 场景 / 痛点 / 需求…），含否定保护与情感分析。',
      '小预：把真实用户分群放进数字世界，做定价 / 卖点 / 渠道变量的策略推演。',
      '小展：把工具原理做成双视角（使用 / 看背后工作）可演示的展厅。',
    ],
    progressText: '已完成 DE / US / JP / UK / EU 多站评论打标，标签体系 9 维稳定；数字世界预测 L2 引擎已可纯前端跑通；原理展厅已上线 VOC 打标与需求打分两个 demo。',
    outputs: ['VOC 标签分布报告', '情感极性统计', '预测报告（爆款率 / 翻车风险）', '原理展厅画廊'],
    link: 'https://ffswwwda.github.io/category-insight-hub/category-insight-hub.html',
  },
  {
    id: 'new-product',
    name: '新品开发 · 创意到 listing',
    icon: 'i-box',
    status: '进行中',
    progress: 60,
    ownerId: 'dev',
    memberIds: ['dev', 'idea', 'score'],
    desc: '从创新方法（TRIZ / SCAMPER）到可执行的创意图，再到产品需求打分与多语言 listing。',
    division: [
      '小创：用 TRIZ 40 发明原理 / SCAMPER 盲盒抽创意，每条长出 3 个产品开发方向。',
      '小设：从六维创意矿脉（外观 / 功能 / 场景 / 情感 / 技术 / 叙事）挖金块拼创意图。',
      '小分：给概念做四维评分（痛点匹配 / 技术可行 / 市场机会 / 竞争差异），附证据溯源。',
    ],
    progressText: '盲盒已支持反复"重抽"；创意图六维生成可用；需求打分引擎规则稳定，支持点击追溯原文。',
    outputs: ['产品设计需求文档（PRD）', 'FABE 文案', '多语言 listing 详情页', '需求评分报告'],
    link: 'https://ffswwwda.github.io/category-insight-hub/category-insight-hub.html',
  },
  {
    id: 'digital-world',
    name: '数字世界预测 · 多智能体仿真',
    icon: 'i-globe',
    status: '进行中',
    progress: 50,
    ownerId: 'lab',
    memberIds: ['lab'],
    desc: '用 Agent-Based Model 把真实用户分群放进数字沙盒，注入变量观察群体演化。',
    division: [
      '小预：Hegselmann-Krause 观点演化 + 蒙特卡洛复算 + 三场景（乐观 / 中性 / 悲观）差异化输出。',
    ],
    progressText: 'L2 纯前端引擎已可离线跑通；正在接入更细的用户分群聚类，减少被 LLM"平均意见"稀释。',
    outputs: ['预测报告（爆款率 / 触达率 / 翻车风险）', '多场景对比', '敏感性分析'],
    link: 'https://ffswwwda.github.io/category-insight-hub/category-insight-hub.html',
  },
  {
    id: 'capability-risk',
    name: '能力风险引擎 · 通用思考引擎',
    icon: 'i-target',
    status: '规划中',
    progress: 20,
    ownerId: 'stress',
    memberIds: ['stress', 'lab'],
    desc: '通用"思考引擎"——以矛盾论 / 调查研究 / 实践论方法论做盲点扫描与压力测试，知识库可插拔。',
    division: [
      '小测：压力测试与极端用户（von Hippel 领先用户）识别，输出风险预警清单。',
      '小预：把用户分群接入引擎，作为可插拔的岗位知识库。',
    ],
    progressText: '纯规则 MVP 已落地（analyze(kb) 内核 + 知识库样例），正在扩展岗位知识库 JSON Schema。',
    outputs: ['风险 / 盲点扫描报告', '岗位知识库 JSON Schema', '决策前查漏清单'],
    link: 'https://ffswwwda.github.io/capability-risk-engine/',
  },
  {
    id: 'ai-office',
    name: 'AI 办公全景 · 本 3D 办公室',
    icon: 'i-office',
    status: '进行中',
    progress: 85,
    ownerId: 'pr',
    memberIds: ['pr', 'voc', 'score', 'lab', 'dev', 'idea', 'stress'],
    desc: '用 PixiJS 把 7 个模块同事做成可交互的 3D 办公室，串起所有工具与真实项目。',
    division: [
      '小展：负责场景、员工卡与原理展厅，是"办公室"本身的作者。',
      '其余同事：作为工位上的"数字员工"被接入，各自暴露身份 / 能力 / 操作。',
    ],
    progressText: '已上线侧边栏 / 今日日报 / 昼夜循环 / 员工卡；正在接入真实项目弹窗，把每个模块的工作成果落到办公室里。',
    outputs: ['ai-office-3d 站点', '员工身份卡', '今日办公报告'],
  },
  {
    id: 'stress-test',
    name: '虚拟用户压力测试',
    icon: 'i-robot',
    status: '进行中',
    progress: 55,
    ownerId: 'stress',
    memberIds: ['stress'],
    desc: '把产品概念丢进虚拟用户群，找最极端的反对声音，提前发现翻车风险。',
    division: [
      '小测：虚拟用户群生成 + 立场归因（支持 / 中立 / 反对）+ 极端用户 Top5 识别。',
    ],
    progressText: '已支持从 VOC 原文提取用户立场特征，让虚拟用户群更贴合真实分布；报告含立场分布与高风险用户排名。',
    outputs: ['压力测试报告', '极端用户画像 Top5', '风险预警清单'],
    link: 'https://ffswwwda.github.io/category-insight-hub/category-insight-hub.html',
  },
]
