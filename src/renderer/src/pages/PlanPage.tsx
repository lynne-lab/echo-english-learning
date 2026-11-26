import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  CalendarRange,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Flame,
  Headphones,
  LibraryBig,
  Loader2,
  MessageCircle,
  Mic,
  PenLine,
  Play,
  RefreshCw,
  Repeat2,
  RotateCcw,
  Target
} from 'lucide-react'
import { api } from '../api'
import { useToast } from '../components/Toast'
import type {
  PlanCatalogItem,
  PlanPhase,
  PlanTask,
  PlanTaskKind,
  StudyPlan,
  StudyPlanResponse
} from '../types'
import { errorMessage } from '../utils'

const TASK_ICONS: Record<PlanTaskKind, typeof Repeat2> = {
  review: Repeat2,
  listening: Headphones,
  dictation: PenLine,
  shadowing: Mic,
  conversation: MessageCircle
}

// 「开始」统一进入对应功能首页，由用户自己选素材，而不是直接跳到某个素材。
const TASK_ROUTES: Record<PlanTaskKind, string> = {
  review: '/review',
  listening: '/listening',
  dictation: '/dictation',
  shadowing: '/shadowing',
  conversation: '/talk'
}

function statusLabel(status: string): string {
  if (status === 'ready') return '已就绪'
  if (status === 'processing') return '转写中'
  if (status === 'error') return '处理失败'
  return status
}

function phasePercent(plan: StudyPlan): number {
  if (plan.total_days <= 0) return 0
  return Math.min(100, Math.round((plan.day_index / plan.total_days) * 100))
}

function PlanMaterials({ items }: { items: PlanCatalogItem[] }): ReactElement {
  return (
    <div className="plan-catalog-list">
      {items.map((item) => (
        <div className="plan-catalog-item" key={item.title}>
          <div className="plan-catalog-main">
            <h3>{item.title}</h3>
            <p>
              {item.accent} · {item.length} · {item.level}
            </p>
            <span>{item.note}</span>
          </div>
          {item.homepage ? (
            <a
              className="plan-catalog-link"
              href={item.homepage}
              target="_blank"
              rel="noreferrer"
            >
              官网 <ExternalLink size={12} />
            </a>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function PhaseCard({ phase }: { phase: PlanPhase }): ReactElement {
  return (
    <article className={`plan-phase-card phase-${phase.key}`}>
      <div className="plan-phase-card-head">
        <span>{phase.subtitle}</span>
        <h3>{phase.title}</h3>
      </div>
      <p>{phase.focus}</p>
      <div className="plan-phase-tags">
        {phase.materials.slice(0, 3).map((item) => (
          <span key={item.title}>{item.title}</span>
        ))}
      </div>
    </article>
  )
}

function StartPlan({
  data,
  selectedMaterial,
  onSelectMaterial,
  onStart,
  starting
}: {
  data: StudyPlanResponse
  selectedMaterial: string
  onSelectMaterial: (value: string) => void
  onStart: () => void
  starting: boolean
}): ReactElement {
  const ready = useMemo(
    () => data.materials.filter((item) => item.status === 'ready' && item.sentence_count > 0),
    [data.materials]
  )

  return (
    <>
      <section className="plan-intro">
        <div className="plan-intro-mark">
          <CalendarRange size={28} />
        </div>
        <div>
          <div className="eyebrow">24 WEEKS · 45 MIN / DAY</div>
          <h2>把“每天练一点”变成可执行的节奏</h2>
          <p>
            三个阶段从恢复听力到真实语速。计划只负责安排任务，具体素材可以随时换成你喜欢的。
          </p>
        </div>
      </section>

      <div className="plan-phase-grid">
        {data.phases.map((phase) => (
          <PhaseCard key={phase.key} phase={phase} />
        ))}
      </div>

      <section className="panel plan-start-panel">
        <div className="plan-start-copy">
          <div className="plan-start-icon">
            <Target size={20} />
          </div>
          <div>
            <h2>从今天开始</h2>
            <p>先选一个已经转写完成的素材作为主材料，之后也可以随时更换。</p>
          </div>
        </div>

        <div className="plan-start-form">
          <label className="field">
            <span>主材料</span>
            <select
              value={selectedMaterial}
              onChange={(event) => onSelectMaterial(event.target.value)}
              disabled={ready.length === 0}
            >
              {ready.length === 0 ? <option value="">还没有可用素材</option> : null}
              {ready.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.title} · {material.sentence_count} 句
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-primary"
            onClick={onStart}
            disabled={starting || ready.length === 0}
          >
            {starting ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            开始 24 周计划
          </button>
        </div>

        <p className="hint">
          还没有素材？先到 <Link to="/library">素材库</Link> 导入 VOA、6 Minute English 或
          ELLLO。计划开始后，每天会生成 5 个任务，大约 45 分钟。
        </p>
      </section>

      <section className="plan-rules">
        <div>
          <Clock size={17} />
          <strong>每天 45 分钟</strong>
          <span>复习 5 + 精听 10 + 默写 10 + 跟读 10 + 口语 10</span>
        </div>
        <div>
          <Flame size={17} />
          <strong>每周 5–6 天</strong>
          <span>周日复盘或休息，不追求全勤</span>
        </div>
        <div>
          <RotateCcw size={17} />
          <strong>随时可调整</strong>
          <span>换主材料、重置计划，数据不会丢</span>
        </div>
      </section>
    </>
  )
}

function ActivePlan({
  plan,
  materials,
  busyKind,
  changingMaterial,
  onToggle,
  onMaterialChange,
  onReset,
  resetting
}: {
  plan: StudyPlan
  materials: StudyPlanResponse['materials']
  busyKind: string | null
  changingMaterial: boolean
  onToggle: (task: PlanTask) => void
  onMaterialChange: (materialId: string) => void
  onReset: () => void
  resetting: boolean
}): ReactElement {
  const phase = plan.phase
  const percent = phasePercent(plan)
  const completed = plan.progress.completed_today
  const totalTasks = plan.tasks.length
  const readyChoices = materials.filter(
    (material) => material.status === 'ready' && material.sentence_count > 0
  )
  const currentNotInChoices =
    plan.material && !readyChoices.some((material) => material.id === plan.material?.id)

  return (
    <>
      <section className="plan-hero">
        <div className="plan-hero-body">
          <div className="plan-hero-top">
            <span className="plan-phase-pill">{phase.title}</span>
            <span className="plan-hero-week">
              第 {plan.week_number} / 24 周 · 第 {plan.day_index || 1} 天
            </span>
            {plan.finished ? <span className="plan-phase-pill muted">计划已完成</span> : null}
          </div>
          <h2>{phase.focus}</h2>
          <p>{phase.goal}</p>

          <div className="plan-progress-row">
            <div className="plan-progress-track" aria-label={`计划进度 ${percent}%`}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <strong>{percent}%</strong>
          </div>

          <div className="plan-hero-stats">
            <div>
              <strong>{plan.progress.streak}</strong>
              <span>连续学习</span>
            </div>
            <div>
              <strong>{plan.progress.full_days}</strong>
              <span>全勤天数</span>
            </div>
            <div>
              <strong>{Math.round(plan.progress.completion_rate * 100)}%</strong>
              <span>任务完成率</span>
            </div>
            <div>
              <strong>
                {completed}/{totalTasks}
              </strong>
              <span>今日完成</span>
            </div>
          </div>
        </div>

        <div className="plan-hero-aside">
          <span className="plan-kicker">本阶段素材</span>
          <div className="plan-hero-materials">
            {phase.materials.slice(0, 4).map((item) => (
              <span key={item.title}>{item.title}</span>
            ))}
          </div>
          <div className="plan-hero-actions">
            <button className="btn btn-ghost btn-small" onClick={onReset} disabled={resetting}>
              {resetting ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
              重置计划
            </button>
          </div>
        </div>
      </section>

      <div className="plan-layout">
        <section className="panel plan-tasks-panel">
          <header className="section-head">
            <div>
              <h2>今日任务</h2>
              <p>完成一项勾一项，不需要按顺序。</p>
            </div>
            <span className="section-count">
              {completed}/{totalTasks} · 约{' '}
              {plan.tasks.reduce((sum, task) => sum + task.minutes, 0)} 分钟
            </span>
          </header>

          <div className="plan-task-list">
            {plan.tasks.map((task) => {
              const Icon = TASK_ICONS[task.kind]
              const busy = busyKind === task.kind
              return (
                <div
                  className={`plan-task${task.completed ? ' completed' : ''}${
                    busy ? ' busy' : ''
                  }`}
                  key={task.kind}
                >
                  <button
                    className="plan-check"
                    aria-label={task.completed ? `取消完成${task.title}` : `完成${task.title}`}
                    aria-pressed={task.completed}
                    onClick={() => onToggle(task)}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 className="spin" size={20} />
                    ) : task.completed ? (
                      <CheckCircle2 size={21} />
                    ) : (
                      <Circle size={21} />
                    )}
                  </button>
                  <div className="plan-task-icon">
                    <Icon size={18} />
                  </div>
                  <div className="plan-task-body">
                    <div className="plan-task-title">
                      <h3>{task.title}</h3>
                      <span>{task.minutes} 分钟</span>
                    </div>
                    <p>{task.description}</p>
                  </div>
                  <Link className="btn btn-small plan-task-action" to={TASK_ROUTES[task.kind]}>
                    {task.action_label} <ArrowRight size={13} />
                  </Link>
                </div>
              )
            })}
          </div>
        </section>

        <aside className="plan-side">
          <section className="panel plan-side-card">
            <header className="section-head">
              <div>
                <h2>主材料</h2>
                <p>精听、默写、跟读共用</p>
              </div>
            </header>

            {readyChoices.length === 0 && !plan.material ? (
              <p className="plan-side-empty">还没有转写完成的素材。</p>
            ) : (
              <select
                className="plan-select"
                value={plan.material?.id ?? ''}
                onChange={(event) => onMaterialChange(event.target.value)}
                disabled={changingMaterial}
              >
                <option value="">未选择</option>
                {currentNotInChoices && plan.material ? (
                  <option value={plan.material.id}>
                    {plan.material.title}（{statusLabel(plan.material.status)}）
                  </option>
                ) : null}
                {readyChoices.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.title} · {material.sentence_count} 句
                  </option>
                ))}
              </select>
            )}

            {plan.material ? (
              <div className="plan-material-info">
                <span className={`plan-status ${plan.material.status}`}>
                  {statusLabel(plan.material.status)}
                </span>
                <span>{plan.material.sentence_count} 句可精听</span>
              </div>
            ) : null}

            <Link className="btn btn-ghost btn-small plan-side-link" to="/library">
              <LibraryBig size={14} /> 去素材库
            </Link>
          </section>

          <section className="panel plan-side-card">
            <header className="section-head">
              <div>
                <h2>最近 7 天</h2>
                <p>每格 5 个任务</p>
              </div>
            </header>
            <div className="plan-week">
              {plan.progress.week_days.map((day) => (
                <div
                  className={`plan-day${day.is_today ? ' today' : ''}${
                    day.total === 0 ? ' outside' : ''
                  }`}
                  key={day.date}
                  title={`${day.label} ${day.date}：${day.completed}/${day.total}`}
                >
                  <span className="plan-day-label">{day.label.replace('周', '')}</span>
                  <div className="plan-day-dots" aria-hidden="true">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <i
                        key={index}
                        className={index < day.completed ? 'on' : undefined}
                      />
                    ))}
                  </div>
                  <span className="plan-day-count">
                    {day.total === 0 ? '—' : `${day.completed}/${day.total}`}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel plan-side-card">
            <header className="section-head">
              <div>
                <h2>本阶段推荐</h2>
                <p>{phase.accent}</p>
              </div>
            </header>
            <PlanMaterials items={phase.materials} />
            <Link className="btn btn-ghost btn-small plan-side-link" to="/library">
              <BookOpen size={14} /> 导入素材
            </Link>
          </section>
        </aside>
      </div>
    </>
  )
}

export default function PlanPage(): ReactElement {
  const { push } = useToast()
  const [data, setData] = useState<StudyPlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startMaterial, setStartMaterial] = useState('')
  const [starting, setStarting] = useState(false)
  const [busyKind, setBusyKind] = useState<string | null>(null)
  const [changingMaterial, setChangingMaterial] = useState(false)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = await api.studyPlan()
      setData(next)
      setStartMaterial((previous) => {
        const ready = next.materials.filter(
          (material) => material.status === 'ready' && material.sentence_count > 0
        )
        if (ready.some((material) => material.id === previous)) return previous
        return ready[0]?.id ?? ''
      })
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleStart = async (): Promise<void> => {
    setStarting(true)
    try {
      const next = await api.startStudyPlan(startMaterial || null)
      setData(next)
      push('学习计划已开始，今天先完成 4 个小任务', 'success')
    } catch (startError) {
      push(errorMessage(startError), 'error')
    } finally {
      setStarting(false)
    }
  }

  const handleToggle = async (task: PlanTask): Promise<void> => {
    if (!data?.plan || busyKind) return
    setBusyKind(task.kind)
    try {
      const next = await api.togglePlanTask(task.kind, !task.completed)
      setData(next)
    } catch (toggleError) {
      push(errorMessage(toggleError), 'error')
    } finally {
      setBusyKind(null)
    }
  }

  const handleMaterialChange = async (materialId: string): Promise<void> => {
    setChangingMaterial(true)
    try {
      const next = await api.updateStudyPlan(materialId || null)
      setData(next)
      push('主材料已切换', 'success')
    } catch (changeError) {
      push(errorMessage(changeError), 'error')
    } finally {
      setChangingMaterial(false)
    }
  }

  const handleReset = async (): Promise<void> => {
    if (!window.confirm('重置学习计划？当前计划的完成记录会删除，素材、生词和复习数据不受影响。')) {
      return
    }
    setResetting(true)
    try {
      await api.resetStudyPlan()
      await load()
      push('学习计划已重置', 'success')
    } catch (resetError) {
      push(errorMessage(resetError), 'error')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="page plan-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">STUDY PLAN</div>
          <h1>学习计划</h1>
          <p className="page-subtitle">
            24 周，每天 45 分钟。计划负责节奏，Echo 负责精听、默写、跟读和口语对话。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : undefined} /> 刷新
          </button>
        </div>
      </header>

      {loading && !data ? (
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在读取学习计划…
        </div>
      ) : error ? (
        <div className="status-panel">
          <h2>加载失败</h2>
          <p className="status-error">{error}</p>
          <button className="btn btn-primary" onClick={() => void load()}>
            <RefreshCw size={15} /> 重试
          </button>
        </div>
      ) : data ? (
        data.plan ? (
          <ActivePlan
            plan={data.plan}
            materials={data.materials}
            busyKind={busyKind}
            changingMaterial={changingMaterial}
            onToggle={(task) => void handleToggle(task)}
            onMaterialChange={(materialId) => void handleMaterialChange(materialId)}
            onReset={() => void handleReset()}
            resetting={resetting}
          />
        ) : (
          <StartPlan
            data={data}
            selectedMaterial={startMaterial}
            onSelectMaterial={setStartMaterial}
            onStart={() => void handleStart()}
            starting={starting}
          />
        )
      ) : null}
    </div>
  )
}
