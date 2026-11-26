import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarRange,
  ChevronRight,
  FileText,
  Film,
  Headphones,
  Loader2,
  Mic,
  Music2
} from 'lucide-react'
import { api } from '../api'
import EmptyState from '../components/EmptyState'
import type { LearningProgress, Material, ShadowArchive } from '../types'
import { errorMessage, formatDate, formatDuration } from '../utils'

type PracticeMode = 'player' | 'shadowing'

const COPY: Record<
  PracticeMode,
  { eyebrow: string; title: string; subtitle: string; action: string; icon: typeof Headphones }
> = {
  player: {
    eyebrow: 'LISTENING',
    title: '精听',
    subtitle: '逐句听、看原文、查词和校对，进度会自动保存。',
    action: '精听',
    icon: Headphones
  },
  shadowing: {
    eyebrow: 'SHADOWING',
    title: '跟读',
    subtitle: '跟着原声逐句跟读，录音、对比波形并查看评测。',
    action: '跟读',
    icon: Mic
  }
}

export default function PracticeHomePage({
  mode
}: {
  mode: PracticeMode
}): ReactElement {
  const copy = COPY[mode]
  const Icon = copy.icon
  const [materials, setMaterials] = useState<Material[]>([])
  const [progress, setProgress] = useState<LearningProgress[]>([])
  const [planMaterialId, setPlanMaterialId] = useState<string | null>(null)
  const [archives, setArchives] = useState<ShadowArchive[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      api.materials(),
      api.progressList(mode).catch(() => [] as LearningProgress[]),
      api.studyPlan().catch(() => null),
      mode === 'shadowing'
        ? api.shadowArchives().catch(() => [] as ShadowArchive[])
        : Promise.resolve([] as ShadowArchive[])
    ])
      .then(([nextMaterials, nextProgress, plan, nextArchives]) => {
        if (cancelled) return
        setMaterials(nextMaterials)
        setProgress(nextProgress)
        setPlanMaterialId(plan?.plan?.material?.id ?? null)
        setArchives(nextArchives)
      })
      .catch((loadError) => {
        if (!cancelled) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode])

  const progressByMaterial = useMemo(
    () => new Map(progress.map((entry) => [entry.material_id, entry])),
    [progress]
  )

  const readyMaterials = useMemo(() => {
    const ready = materials.filter(
      (material) => material.status === 'ready' && material.sentence_count > 0
    )
    return [...ready].sort((left, right) => {
      const leftPlan = left.id === planMaterialId ? 1 : 0
      const rightPlan = right.id === planMaterialId ? 1 : 0
      if (leftPlan !== rightPlan) return rightPlan - leftPlan
      return right.updated_at.localeCompare(left.updated_at)
    })
  }, [materials, planMaterialId])

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{copy.eyebrow}</div>
          <h1>{copy.title}</h1>
          <p className="page-subtitle">{copy.subtitle}</p>
        </div>
        <div className="page-actions">
          <Link className="btn" to="/library">
            去素材库
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在读取素材…
        </div>
      ) : error ? (
        <div className="status-panel">
          <h2>加载失败</h2>
          <p className="status-error">{error}</p>
        </div>
      ) : readyMaterials.length === 0 && archives.length === 0 ? (
        <EmptyState
          icon={<Icon size={30} />}
          title={`还没有可以${copy.action}的素材`}
          description="先在素材库导入音频或视频，等转写完成后就可以开始。"
        >
          <Link className="btn btn-primary" to="/library">
            去导入素材
          </Link>
        </EmptyState>
      ) : (
        <>
        {readyMaterials.length > 0 ? (
        <section className="panel">
          <header className="section-head">
            <div>
              <h2>选择素材</h2>
              <p>学习进度会按素材保存，下次打开自动回到上次的位置。</p>
            </div>
            <span className="section-count">{readyMaterials.length} 个</span>
          </header>

          <div className="dictation-material-list">
            {readyMaterials.map((material) => {
              const saved = progressByMaterial.get(material.id)
              const savedSentence =
                saved?.sentence_idx !== null &&
                saved?.sentence_idx !== undefined
                  ? saved.sentence_idx + 1
                  : null
              const isPlanMaterial = material.id === planMaterialId
              return (
                <div className="dictation-material-row" key={material.id}>
                  <div className={`material-icon ${material.media_type}`}>
                    {material.media_type === 'video' ? (
                      <Film size={20} />
                    ) : (
                      <Music2 size={20} />
                    )}
                  </div>
                  <div className="dictation-material-info">
                    <h3>
                      {material.title}
                      {isPlanMaterial ? (
                        <span className="practice-plan-tag">
                          <CalendarRange size={11} /> 学习计划
                        </span>
                      ) : null}
                    </h3>
                    <p>
                      {material.sentence_count} 句 ·{' '}
                      {formatDuration(material.duration)}
                      {savedSentence !== null
                        ? ` · 上次学到第 ${savedSentence} 句`
                        : ''}
                    </p>
                  </div>
                  <Link
                    className="btn btn-small btn-primary"
                    to={`/${mode === 'player' ? 'player' : 'shadow'}/${material.id}`}
                  >
                    {savedSentence !== null ? '继续' : '开始'}
                    {copy.action} <ChevronRight size={14} />
                  </Link>
                </div>
              )
            })}
          </div>
        </section>
        ) : null}

        {archives.length > 0 ? (
          <section className="panel">
            <header className="section-head">
              <div>
                <h2>已删除素材的复盘</h2>
                <p>这些素材已从素材库删除，跟读复盘记录仍然保留。</p>
              </div>
              <span className="section-count">{archives.length} 个</span>
            </header>
            <div className="dictation-material-list">
              {archives.map((archive) => (
                <div className="dictation-material-row" key={archive.material_id}>
                  <div className="material-icon">
                    <FileText size={20} />
                  </div>
                  <div className="dictation-material-info">
                    <h3>{archive.material_title}</h3>
                    <p>
                      素材已删除 · {archive.review_count} 份复盘 · 最近{' '}
                      {formatDate(archive.last_created_at)}
                    </p>
                  </div>
                  <Link
                    className="btn btn-small"
                    to={`/shadow/${archive.material_id}/review`}
                  >
                    跟读复盘记录 <ChevronRight size={14} />
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        </>
      )}
    </div>
  )
}
