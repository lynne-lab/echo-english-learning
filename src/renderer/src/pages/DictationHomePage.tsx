import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ChevronRight,
  Film,
  Loader2,
  Music2,
  PenLine,
  ScanText,
  Trash2
} from 'lucide-react'
import { api } from '../api'
import EmptyState from '../components/EmptyState'
import { useToast } from '../components/Toast'
import type { DictationSessionSummary, Material } from '../types'
import { errorMessage, formatDate, formatDuration } from '../utils'

export default function DictationHomePage(): ReactElement {
  const navigate = useNavigate()
  const { push } = useToast()
  const [materials, setMaterials] = useState<Material[]>([])
  const [sessions, setSessions] = useState<DictationSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const [nextMaterials, nextSessions] = await Promise.all([
          api.materials(),
          api.dictationSessions()
        ])
        if (!cancelled) {
          setMaterials(nextMaterials)
          setSessions(nextSessions)
        }
      } catch (loadError) {
        if (!cancelled) setError(errorMessage(loadError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const readyMaterials = useMemo(
    () => materials.filter((material) => material.status === 'ready' && material.sentence_count > 0),
    [materials]
  )

  const handleDeleteSession = async (session: DictationSessionSummary): Promise<void> => {
    if (!window.confirm(`删除这次默写记录？句子批改数据会一起删除。`)) return
    try {
      await api.deleteDictationSession(session.id)
      setSessions((previous) => previous.filter((item) => item.id !== session.id))
      push('已删除默写记录', 'success')
    } catch (deleteError) {
      push(errorMessage(deleteError), 'error')
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">DICTATION</div>
          <h1>默写</h1>
          <p className="page-subtitle">
            听音频写句子，系统自动批改漏词、拼写和多余内容，错误会记进学习统计。
          </p>
        </div>
        <div className="page-actions">
          <Link className="btn" to="/library">
            去素材库
          </Link>
        </div>
      </header>

      <div className="dictation-mode-overview">
        <div className="mode-overview-card">
          <div className="mode-overview-icon">
            <PenLine size={20} />
          </div>
          <div>
            <strong>整句默写</strong>
            <p>听完整句子，凭记忆写出整句。最接近真实听力输出。</p>
          </div>
        </div>
        <div className="mode-overview-card">
          <div className="mode-overview-icon">
            <ScanText size={20} />
          </div>
          <div>
            <strong>抠词默写</strong>
            <p>原文里随机遮住部分关键词，补全整句。难度更低，适合起步。</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在读取默写素材…
        </div>
      ) : error ? (
        <div className="status-panel">
          <h2>加载失败</h2>
          <p className="status-error">{error}</p>
        </div>
      ) : readyMaterials.length === 0 ? (
        <EmptyState
          icon={<PenLine size={30} />}
          title="还没有可以默写的素材"
          description="先在素材库导入音频或视频，等转写完成后就可以开始默写。"
        >
          <Link className="btn btn-primary" to="/library">
            去导入素材
          </Link>
        </EmptyState>
      ) : (
        <div className="dictation-home-grid">
          <section className="panel">
            <header className="section-head">
              <div>
                <h2>选择素材</h2>
                <p>所有已经转写完成的素材都可以用来默写。</p>
              </div>
              <span className="section-count">{readyMaterials.length} 个</span>
            </header>

            <div className="dictation-material-list">
              {readyMaterials.map((material) => (
                <div className="dictation-material-row" key={material.id}>
                  <div className={`material-icon ${material.media_type}`}>
                    {material.media_type === 'video' ? <Film size={20} /> : <Music2 size={20} />}
                  </div>
                  <div className="dictation-material-info">
                    <h3>{material.title}</h3>
                    <p>
                      {material.sentence_count} 句 · {formatDuration(material.duration)}
                    </p>
                  </div>
                  <button
                    className="btn btn-small btn-primary"
                    onClick={() => navigate(`/dictation/${material.id}`)}
                  >
                    开始默写 <ChevronRight size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <header className="section-head">
              <div>
                <h2>最近记录</h2>
                <p>每次默写的成绩都会保存下来。</p>
              </div>
            </header>

            {sessions.length === 0 ? (
              <div className="session-empty">
                <p>还没有默写记录。选一个素材开始吧。</p>
              </div>
            ) : (
              <div className="session-list">
                {sessions.map((session) => {
                  const percent = Math.round(session.accuracy * 100)
                  return (
                    <div className="session-row" key={session.id}>
                      <div className="session-info">
                        <div className="session-title-line">
                          <span className={`mode-tag ${session.mode}`}>
                            {session.mode === 'full' ? '整句' : '抠词'}
                          </span>
                          <h3>{session.material_title}</h3>
                        </div>
                        <p>
                          {formatDate(session.created_at)} · {session.completed_count}/
                          {session.item_count} 句
                          {session.completed ? '' : ' · 未完成'}
                        </p>
                      </div>
                      <div className="session-right">
                        <span
                          className={`session-score${
                            percent >= 90 ? ' excellent' : percent >= 70 ? ' good' : ''
                          }`}
                        >
                          {percent}%
                        </span>
                        <button
                          className="btn-icon danger-hover"
                          title="删除记录"
                          onClick={() => void handleDeleteSession(session)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
