import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  BookMarked,
  CalendarDays,
  Flame,
  Loader2,
  PenLine,
  RefreshCw,
  Target
} from 'lucide-react'
import { api } from '../api'
import { useToast } from '../components/Toast'
import type {
  DictationErrors,
  Stats,
  StatsDay,
  StatsForecastDay,
  StatsHeatCell,
  StatsRecentSession
} from '../types'
import { errorMessage, formatDate, formatNumber } from '../utils'

const ERROR_ORDER: Array<keyof DictationErrors> = [
  'missing',
  'typo',
  'wrong',
  'extra',
  'punctuation'
]

const ERROR_LABELS: Record<keyof DictationErrors, string> = {
  missing: '漏词',
  typo: '拼写',
  wrong: '听错',
  extra: '多写',
  punctuation: '标点'
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function niceMax(value: number): number {
  if (value <= 1) return 1
  if (value <= 2) return 2
  if (value <= 4) return 4
  if (value <= 10) return Math.ceil(value / 2) * 2
  if (value <= 50) return Math.ceil(value / 10) * 10
  return Math.ceil(value / 50) * 50
}

function heatLevel(count: number, max: number): number {
  if (count <= 0) return 0
  if (max <= 0) return 0
  const ratio = count / max
  if (ratio <= 0.2) return 1
  if (ratio <= 0.4) return 2
  if (ratio <= 0.6) return 3
  if (ratio <= 0.8) return 4
  return 5
}

function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function DailyChart({ days }: { days: StatsDay[] }): ReactElement {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(1, ...days.flatMap((day) => [day.reviews, day.dictations])))
  const defaultDay = days[days.length - 1]
  const active = hover !== null ? days[hover] : defaultDay

  return (
    <section className="viz-card span-2">
      <header className="viz-card-head">
        <div>
          <div className="eyebrow">ACTIVITY</div>
          <h2>最近 7 天</h2>
          <p>复习卡片与默写尝试的次数</p>
        </div>
        <div className="viz-legend">
          <span>
            <i className="viz-swatch series-1" /> 复习
          </span>
          <span>
            <i className="viz-swatch series-2" /> 默写
          </span>
        </div>
      </header>

      <div className="viz-readout" aria-live="polite">
        <span className="viz-readout-date">{active?.label ?? '—'}</span>
        <span>
          <i className="viz-key series-1" /> 复习 {active?.reviews ?? 0}
        </span>
        <span>
          <i className="viz-key series-2" /> 默写 {active?.dictations ?? 0}
        </span>
      </div>

      <div className="viz-bars-wrap">
        <div className="viz-y-axis">
          <span>{max}</span>
          {max >= 2 ? <span>{Math.round(max / 2)}</span> : null}
          <span>0</span>
        </div>
        <div className="viz-bars-plot">
          <div className="viz-gridlines" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="viz-groups">
            {days.map((day, index) => {
              const latest = index === days.length - 1
              return (
                <div
                  key={day.date}
                  className={`viz-group${hover === index ? ' is-hover' : ''}`}
                  tabIndex={0}
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  aria-label={`${day.label}，复习 ${day.reviews} 次，默写 ${day.dictations} 次`}
                >
                  <div className="viz-bar-pair">
                    <div
                      className="viz-bar series-1"
                      style={{
                        height: `${(day.reviews / max) * 100}%`,
                        minHeight: day.reviews > 0 ? '2px' : 0
                      }}
                    >
                      {latest ? <span className="viz-bar-value">{day.reviews}</span> : null}
                    </div>
                    <div
                      className="viz-bar series-2"
                      style={{
                        height: `${(day.dictations / max) * 100}%`,
                        minHeight: day.dictations > 0 ? '2px' : 0
                      }}
                    >
                      {latest ? <span className="viz-bar-value">{day.dictations}</span> : null}
                    </div>
                  </div>
                  <span className="viz-x-label">{day.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <details className="viz-table">
        <summary>数据表</summary>
        <div className="viz-table-scroll">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>复习</th>
                <th>默写</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td>{shortDate(day.date)}</td>
                  <td>{day.reviews}</td>
                  <td>{day.dictations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

function Heatmap({ cells }: { cells: StatsHeatCell[] }): ReactElement {
  const [hover, setHover] = useState<StatsHeatCell | null>(null)
  const max = Math.max(0, ...cells.map((cell) => cell.count))
  const total = cells.reduce((sum, cell) => sum + cell.count, 0)
  const weekdays = ['一', '', '三', '', '五', '', '日']

  return (
    <section className="viz-card span-2">
      <header className="viz-card-head">
        <div>
          <div className="eyebrow">CONSISTENCY</div>
          <h2>学习热力图</h2>
          <p>最近 16 周的复习与默写活动</p>
        </div>
        <div className="heat-legend" aria-label="颜色越深，学习次数越多">
          <span>少</span>
          {[1, 2, 3, 4, 5].map((level) => (
            <i key={level} className={`heat-level heat-${level}`} />
          ))}
          <span>多</span>
        </div>
      </header>

      <div className="viz-readout" aria-live="polite">
        {hover ? (
          <>
            <span className="viz-readout-date">{shortDate(hover.date)}</span>
            <span>{hover.count} 次学习</span>
          </>
        ) : (
          <span className="viz-readout-date">16 周内共 {total} 次学习</span>
        )}
      </div>

      <div className="heatmap-wrap">
        <div className="heatmap-weekdays" aria-hidden="true">
          {weekdays.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
        <div className="heatmap-grid" role="img" aria-label="最近 16 周学习热力图">
          {cells.map((cell) => (
            <div
              key={cell.date}
              className={`heat-cell heat-${heatLevel(cell.count, max)}`}
              title={`${shortDate(cell.date)} · ${cell.count} 次学习`}
              aria-label={`${shortDate(cell.date)}，${cell.count} 次学习`}
              onMouseEnter={() => setHover(cell)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </div>
      </div>

      <details className="viz-table">
        <summary>数据表</summary>
        <div className="viz-table-scroll">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>学习次数</th>
              </tr>
            </thead>
            <tbody>
              {cells.map((cell) => (
                <tr key={cell.date}>
                  <td>{shortDate(cell.date)}</td>
                  <td>{cell.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

function Forecast({ days }: { days: StatsForecastDay[] }): ReactElement {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(1, ...days.map((day) => day.count)))
  const total = days.reduce((sum, day) => sum + day.count, 0)
  const active = hover !== null ? days[hover] : null

  return (
    <section className="viz-card">
      <header className="viz-card-head">
        <div>
          <div className="eyebrow">SCHEDULE</div>
          <h2>未来 7 天到期</h2>
          <p>FSRS 安排的下次复习分布</p>
        </div>
      </header>

      <div className="viz-readout" aria-live="polite">
        {active ? (
          <>
            <span className="viz-readout-date">{active.label}</span>
            <span>{active.count} 张到期</span>
          </>
        ) : (
          <span className="viz-readout-date">共 {total} 张卡片将在 7 天内到期</span>
        )}
      </div>

      {total === 0 ? (
        <div className="viz-empty">未来 7 天没有到期卡片。</div>
      ) : (
        <div className="viz-bars-wrap">
          <div className="viz-y-axis">
            <span>{max}</span>
            {max >= 2 ? <span>{Math.round(max / 2)}</span> : null}
            <span>0</span>
          </div>
          <div className="viz-bars-plot forecast">
            <div className="viz-gridlines" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="viz-groups">
              {days.map((day, index) => (
                <div
                  key={day.date}
                  className={`viz-group${hover === index ? ' is-hover' : ''}`}
                  tabIndex={0}
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  aria-label={`${day.label}，到期 ${day.count} 张`}
                >
                  <div className="viz-bar-pair single">
                    <div
                      className="viz-bar series-1"
                      style={{
                        height: `${(day.count / max) * 100}%`,
                        minHeight: day.count > 0 ? '2px' : 0
                      }}
                    >
                      {index === 0 ? <span className="viz-bar-value">{day.count}</span> : null}
                    </div>
                  </div>
                  <span className="viz-x-label">{day.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <details className="viz-table">
        <summary>数据表</summary>
        <div className="viz-table-scroll">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>到期卡片</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td>{day.label}</td>
                  <td>{day.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

function ErrorBars({ errors }: { errors: DictationErrors }): ReactElement {
  const [hover, setHover] = useState<keyof DictationErrors | null>(null)
  const rows = useMemo(() => {
    return [...ERROR_ORDER]
      .map((key, index) => ({ key, count: errors[key], index }))
      .sort((a, b) => b.count - a.count || a.index - b.index)
  }, [errors])
  const max = Math.max(1, ...rows.map((row) => row.count))
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <section className="viz-card">
      <header className="viz-card-head">
        <div>
          <div className="eyebrow">ERRORS</div>
          <h2>默写错误分布</h2>
          <p>近 30 天自动批改统计</p>
        </div>
      </header>

      <div className="viz-readout" aria-live="polite">
        {hover ? (
          <>
            <span className="viz-readout-date">{ERROR_LABELS[hover]}</span>
            <span>{errors[hover]} 次</span>
          </>
        ) : (
          <span className="viz-readout-date">近 30 天共 {total} 个错误</span>
        )}
      </div>

      {total === 0 ? (
        <div className="viz-empty">
          还没有默写错误记录。
          <Link to="/dictation">去做一次默写</Link>
        </div>
      ) : (
        <div className="error-bars">
          {rows.map((row) => (
            <div
              className={`error-bar-row${hover === row.key ? ' is-hover' : ''}`}
              key={row.key}
              tabIndex={0}
              onMouseEnter={() => setHover(row.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(row.key)}
              onBlur={() => setHover(null)}
              aria-label={`${ERROR_LABELS[row.key]} ${row.count} 次`}
            >
              <span className="error-bar-label">{ERROR_LABELS[row.key]}</span>
              <div className="error-bar-track">
                <div
                  className="error-bar-fill"
                  style={{ width: `${(row.count / max) * 100}%` }}
                />
              </div>
              <span className="error-bar-value">{row.count}</span>
            </div>
          ))}
        </div>
      )}

      <details className="viz-table">
        <summary>数据表</summary>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>次数</th>
            </tr>
          </thead>
          <tbody>
            {ERROR_ORDER.map((key) => (
              <tr key={key}>
                <td>{ERROR_LABELS[key]}</td>
                <td>{errors[key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}

function ReviewStateCard({ stats }: { stats: Stats }): ReactElement {
  const states = [
    { label: '新词', value: stats.review_states.new },
    { label: '学习中', value: stats.review_states.learning },
    { label: '复习中', value: stats.review_states.review },
    { label: '重学', value: stats.review_states.relearning }
  ]
  return (
    <section className="viz-card">
      <header className="viz-card-head">
        <div>
          <div className="eyebrow">VOCABULARY</div>
          <h2>生词卡片</h2>
          <p>FSRS 队列状态</p>
        </div>
        <div className="viz-card-icon">
          <BookMarked size={18} />
        </div>
      </header>

      <div className="state-grid">
        {states.map((state) => (
          <div className="state-item" key={state.label}>
            <span className="state-value">{state.value}</span>
            <span className="state-label">{state.label}</span>
          </div>
        ))}
      </div>

      <div className="viz-fact-row">
        <span>生词总数 {formatNumber(stats.totals.words)}</span>
        <span>原句出处 {formatNumber(stats.totals.occurrences)}</span>
        <span>素材 {formatNumber(stats.totals.materials)}</span>
      </div>
    </section>
  )
}

function RecentSessions({ sessions }: { sessions: StatsRecentSession[] }): ReactElement {
  return (
    <section className="viz-card">
      <header className="viz-card-head">
        <div>
          <div className="eyebrow">DICTATION LOG</div>
          <h2>最近默写</h2>
          <p>每次练习都会保存成绩</p>
        </div>
        <Link className="viz-card-link" to="/dictation">
          去默写
        </Link>
      </header>

      {sessions.length === 0 ? (
        <div className="viz-empty">还没有默写记录。</div>
      ) : (
        <div className="recent-session-list">
          {sessions.map((session) => {
            const score = Math.round(session.accuracy * 100)
            return (
              <div className="recent-session-row" key={session.id}>
                <div className="recent-session-main">
                  <span className={`mode-tag ${session.mode}`}>
                    {session.mode === 'full' ? '整句' : '抠词'}
                  </span>
                  <div>
                    <h3>{session.material_title}</h3>
                    <p>
                      {formatDate(session.created_at)} · {session.completed_count}/
                      {session.item_count} 句
                    </p>
                  </div>
                </div>
                <span
                  className={`recent-session-score${
                    score >= 90 ? ' excellent' : score >= 70 ? ' good' : ''
                  }`}
                >
                  {score}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default function StatsPage(): ReactElement {
  const { push } = useToast()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async (initial = false): Promise<void> => {
    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      setStats(await api.stats())
    } catch (loadError) {
      if (initial) setError(errorMessage(loadError))
      else push(errorMessage(loadError), 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="page">
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在统计学习数据…
        </div>
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="page">
        <div className="status-panel">
          <div className="status-icon error">
            <AlertCircle size={30} />
          </div>
          <h2>统计加载失败</h2>
          <p className="status-error">{error || '本地引擎没有响应'}</p>
          <button className="btn btn-primary" onClick={() => void load(true)}>
            <RefreshCw size={16} /> 重试
          </button>
        </div>
      </div>
    )
  }

  const totalToday = stats.today.reviews + stats.today.dictations

  return (
    <div className="page stats-page stats-viz">
      <header className="page-header">
        <div>
          <div className="eyebrow">INSIGHTS</div>
          <h1>学习统计</h1>
          <p className="page-subtitle">
            复习、默写和记忆保持率都在本地计算。热力图展示最近 16 周。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => void load()} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'spin' : undefined} /> 刷新
          </button>
        </div>
      </header>

      <div className={refreshing ? 'stats-content is-refreshing' : 'stats-content'}>
        <div className="stats-hero-row">
          <section className="stats-hero">
            <div className="stats-hero-icon">
              <Flame size={24} />
            </div>
            <div>
              <span className="stats-hero-label">连续学习</span>
              <div className="stats-hero-value">
                {stats.streak}
                <small>天</small>
              </div>
              <p>
                {stats.studied_today
                  ? '今天已经学习过了，保持住。'
                  : totalToday > 0
                    ? '今天有学习记录。'
                    : '今天还没有学习，先复习几张卡片吧。'}
              </p>
            </div>
          </section>

          <div className="stats-kpis">
            <div className="viz-kpi">
              <Activity size={16} />
              <span className="viz-kpi-label">今日复习</span>
              <span className="viz-kpi-value">{stats.today.reviews}</span>
              <span className="viz-kpi-suffix">张</span>
            </div>
            <div className="viz-kpi">
              <PenLine size={16} />
              <span className="viz-kpi-label">今日默写</span>
              <span className="viz-kpi-value">{stats.today.dictations}</span>
              <span className="viz-kpi-suffix">句</span>
            </div>
            <div className="viz-kpi">
              <Target size={16} />
              <span className="viz-kpi-label">记忆保持率</span>
              <span className="viz-kpi-value">{percent(stats.retention)}</span>
            </div>
            <div className="viz-kpi">
              <CalendarDays size={16} />
              <span className="viz-kpi-label">默写正确率</span>
              <span className="viz-kpi-value">{percent(stats.dictation_accuracy)}</span>
            </div>
          </div>
        </div>

        <div className="stats-grid">
          <DailyChart days={stats.daily} />
          <Heatmap cells={stats.heatmap} />
          <Forecast days={stats.forecast} />
          <ErrorBars errors={stats.errors} />
          <ReviewStateCard stats={stats} />
          <RecentSessions sessions={stats.recent_sessions} />
        </div>
      </div>
    </div>
  )
}
