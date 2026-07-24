/** 任务阶段可视化看板：把一次执行拆成可见进展的时间线
 *  阶段节点 + 每阶段进度 + 可展开看该阶段实际产出。
 *  会议室「执行」步与项目看板共用，保证两处看到一致的实时进展。
 */
import type { ProjectTask } from '@/store/workspaceStore'

function SvgIcon({ id, size = 14 }: { id: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size}><use href={'#' + id}/></svg>
}

const stageStatusLabel: Record<string, string> = {
  todo: '待开始', doing: '进行中', done: '已完成',
}

export function TaskStageBoard({
  task,
  nameOf,
  colorHex,
  openStageId,
  onToggleStage,
}: {
  task: ProjectTask
  nameOf: (id: string) => string
  colorHex: (id: string) => string
  openStageId: string | null
  onToggleStage: (stageId: string) => void
}) {
  const stages = task.stages ?? []
  const doneCount = stages.filter((s) => s.status === 'done').length
  const progress = task.progress ?? 0
  const color = colorHex(task.ownerId)

  return (
    <div className="tsb">
      {/* 顶部：负责人 + 任务进度条 */}
      <div className="tsb-head">
        <span className="tsb-owner">
          <span className="tsb-owner-dot" style={{ background: color }} />
          {nameOf(task.ownerId)}
        </span>
        <span className="tsb-progress-val">{progress}%</span>
      </div>
      <div className="tsb-progress-track">
        <div className="tsb-progress-fill" style={{ width: progress + '%', background: color }} />
      </div>

      {/* 阶段时间线 */}
      <ul className="tsb-stages">
        {stages.map((s, i) => (
          <li key={s.id} className={'tsb-stage' + (s.status === 'done' ? ' done' : s.status === 'doing' ? ' doing' : '')}>
            {/* 左侧节点 */}
            <div className="tsb-node-col">
              <span className="tsb-node" style={{ borderColor: color }}>
                {s.status === 'done' ? <SvgIcon id="i-check" size={12} /> : <em>{i + 1}</em>}
              </span>
              {i < stages.length - 1 && <span className="tsb-connector" />}
            </div>
            {/* 右侧内容 */}
            <div className="tsb-stage-body">
              <button className="tsb-stage-toggle" onClick={() => onToggleStage(s.id)}>
                <span className="tsb-stage-name">{s.name}</span>
                <span className={'tsb-stage-state'} data-status={s.status}>{stageStatusLabel[s.status]}</span>
              </button>
              <p className="tsb-stage-hint">产出：{s.outputHint}</p>
              {s.output && openStageId === s.id && (
                <pre className="tsb-stage-output">{s.output}</pre>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
