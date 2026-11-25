import { useEffect, useState, type ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2
} from 'lucide-react'
import { api } from '../api'
import { useToast } from '../components/Toast'
import type {
  Material,
  ShadowCoverage,
  ShadowReview,
  ShadowReviewSummary
} from '../types'
import { errorMessage, formatDate } from '../utils'

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault()
        if (href) window.open(href, '_blank')
      }}
    >
      {children}
    </a>
  )
}

function ProviderText({
  providers
}: {
  providers: Record<string, number> | undefined
}): ReactElement | null {
  if (!providers) return null
  const parts: string[] = []
  if (providers.tencent) parts.push(`腾讯云 ${providers.tencent}`)
  if (providers.azure) parts.push(`Azure ${providers.azure}`)
  if (!parts.length) return null
  return <span className="review-provider">· {parts.join(' · ')}</span>
}

export default function ShadowingReviewPage(): ReactElement {
  const { id } = useParams<{ id: string }>()
  const { push } = useToast()

  const [material, setMaterial] = useState<Material | null>(null)
  const [coverage, setCoverage] = useState<ShadowCoverage | null>(null)
  const [reviews, setReviews] = useState<ShadowReviewSummary[]>([])
  const [selected, setSelected] = useState<ShadowReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [loadingReportId, setLoadingReportId] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setMaterial(null)
    setCoverage(null)
    setReviews([])
    setSelected(null)
    setGenerateError(null)
    setLoadingReportId(null)
    Promise.all([
      api.material(id),
      api.shadowCoverage(id),
      api.shadowReviews(id)
    ])
      .then(async ([nextMaterial, nextCoverage, nextReviews]) => {
        if (cancelled) return
        setMaterial(nextMaterial)
        setCoverage(nextCoverage)
        setReviews(nextReviews)
        if (nextReviews[0]) {
          const full = await api.shadowReview(nextReviews[0].id).catch(() => null)
          if (!cancelled && full) setSelected(full)
        }
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const refreshCoverage = async (): Promise<void> => {
    if (!id) return
    try {
      setCoverage(await api.shadowCoverage(id))
    } catch {
      /* keep the last snapshot */
    }
  }

  const generate = async (): Promise<void> => {
    if (!id || generating) return
    setGenerating(true)
    setGenerateError(null)
    try {
      const report = await api.generateShadowReview(id)
      setSelected(report)
      setReviews((previous) => [
        {
          id: report.id,
          material_id: report.material_id,
          material_title: report.material_title,
          model: report.model,
          coverage: report.coverage,
          created_at: report.created_at
        },
        ...previous.filter((item) => item.id !== report.id)
      ])
      push('跟读复盘已生成', 'success')
      await refreshCoverage()
    } catch (error) {
      setGenerateError(errorMessage(error))
    } finally {
      setGenerating(false)
    }
  }

  const openReport = async (review: ShadowReviewSummary): Promise<void> => {
    if (loadingReportId === review.id || selected?.id === review.id) return
    setLoadingReportId(review.id)
    try {
      setSelected(await api.shadowReview(review.id))
    } catch (error) {
      push(errorMessage(error), 'error')
    } finally {
      setLoadingReportId(null)
    }
  }

  const removeReport = async (review: ShadowReviewSummary): Promise<void> => {
    if (!window.confirm('删除这份复盘报告？')) return
    try {
      await api.deleteShadowReview(review.id)
      const remaining = reviews.filter((item) => item.id !== review.id)
      setReviews(remaining)
      if (selected?.id === review.id) {
        setSelected(null)
        if (remaining[0]) {
          void api
            .shadowReview(remaining[0].id)
            .then(setSelected)
            .catch(() => undefined)
        }
      }
      push('已删除复盘报告', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在读取复盘…
        </div>
      </div>
    )
  }

  if (loadError || !material) {
    return (
      <div className="page">
        <div className="status-panel">
          <h2>找不到这个素材</h2>
          <p className="status-error">{loadError || '素材可能已被删除。'}</p>
          <Link className="btn btn-primary" to="/shadowing">
            返回跟读
          </Link>
        </div>
      </div>
    )
  }

  const llmConfigured = coverage?.llm_configured ?? false
  const recorded = coverage?.recorded ?? 0
  const canGenerate = llmConfigured && recorded > 0 && !generating

  return (
    <div className="page shadow-page">
      <header className="shadow-header">
        <Link to={`/shadow/${material.id}`} className="btn-icon" title="返回跟读">
          <ArrowLeft size={19} />
        </Link>
        <div className="shadow-header-title">
          <div className="eyebrow">SHADOW REVIEW</div>
          <h1>跟读复盘</h1>
          <div className="player-meta">
            <span>{material.title}</span>
            <span className="dot-separator">·</span>
            <span>
              {coverage?.sentence_count ?? material.sentence_count} 句
            </span>
            {coverage ? (
              <>
                <span className="dot-separator">·</span>
                <span>已录 {coverage.recorded} 句</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="shadow-header-actions">
          <Link className="btn btn-small" to={`/shadow/${material.id}`}>
            继续跟读
          </Link>
        </div>
      </header>

      {coverage ? (
        <section className="panel review-hero">
          <div className="review-hero-main">
            <div className="review-hero-icon">
              <Sparkles size={20} />
            </div>
            <div>
              <h2>
                {coverage.all_recorded
                  ? '全篇跟读已完成'
                  : `已录 ${coverage.recorded}/${coverage.sentence_count} 句`}
              </h2>
              <p>
                本地 Whisper 评测 {coverage.local_scored} 句 · 在线音素评分{' '}
                {coverage.phoneme_scored} 句
                <ProviderText providers={coverage.phoneme_providers} />
              </p>
            </div>
          </div>
          <div className="review-hero-actions">
            <button
              className="btn btn-primary"
              onClick={() => void generate()}
              disabled={!canGenerate}
              title={
                !llmConfigured
                  ? '请先在设置页配置 AI 复盘服务'
                  : recorded === 0
                    ? '先录几句再来复盘'
                    : '调用 AI 生成复盘报告'
              }
            >
              {generating ? (
                <Loader2 size={15} className="spin" />
              ) : selected ? (
                <RefreshCw size={15} />
              ) : (
                <Sparkles size={15} />
              )}
              {generating ? '正在分析…' : selected ? '重新生成复盘' : '生成复盘'}
            </button>
          </div>
        </section>
      ) : null}

      {!llmConfigured ? (
        <div className="review-notice">
          <AlertCircle size={16} />
          <div>
            <strong>还没有配置 AI 复盘服务</strong>
            <p>
              在设置页填写 Base URL、API Key 和模型后，就能根据评测数据生成发音总结和训练方案。
            </p>
          </div>
          <Link className="btn btn-small" to="/settings">
            <Settings2 size={14} /> 去设置
          </Link>
        </div>
      ) : null}

      {generating ? (
        <section className="panel review-generating">
          <Loader2 size={22} className="spin" />
          <div>
            <strong>AI 正在阅读这篇跟读数据…</strong>
            <p>
              它会归纳薄弱单词和音素、对应到具体句子，再给出下一轮练习方案。通常需要
              30–90 秒，请不要关闭页面。
            </p>
          </div>
        </section>
      ) : null}

      {generateError ? (
        <div className="review-notice error">
          <AlertCircle size={16} />
          <div>
            <strong>生成失败</strong>
            <p>{generateError}</p>
          </div>
          <button className="btn btn-small" onClick={() => void generate()}>
            重试
          </button>
        </div>
      ) : null}

      {selected && !generating ? (
        <section className="panel review-report">
          <header className="review-report-head">
            <div>
              <div className="eyebrow">REPORT</div>
              <h2>发音复盘报告</h2>
              <p>
                {formatDate(selected.created_at)} · {selected.model} · 录音{' '}
                {selected.coverage.recorded ?? '—'} 句 · 音素评分{' '}
                {selected.coverage.phoneme_scored ?? '—'} 句
              </p>
            </div>
            <button
              className="btn-icon danger-hover"
              title="删除这份报告"
              onClick={() => void removeReport(selected)}
            >
              <Trash2 size={15} />
            </button>
          </header>
          <div className="review-markdown">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {selected.report_markdown}
            </Markdown>
          </div>
        </section>
      ) : null}

      {!selected && !generating ? (
        <section className="panel review-empty">
          <Sparkles size={26} />
          <h2>还没有复盘报告</h2>
          <p>
            录完一段跟读后点「生成复盘」，AI 会结合本地词级评测和在线音素评分，
            找出问题最大的单词、音素和句子，并给出可执行的练习方案。
          </p>
          {reviews.length > 0 ? (
            <p className="hint">已有一份历史报告，正在读取…</p>
          ) : null}
        </section>
      ) : null}

      {reviews.length > 0 ? (
        <section className="panel review-history">
          <header className="section-head">
            <div>
              <h2>历史复盘</h2>
              <p>每次生成都会保留，可对比不同轮次的进步。</p>
            </div>
            <span className="section-count">{reviews.length} 份</span>
          </header>
          <div className="review-history-list">
            {reviews.map((review) => (
              <button
                key={review.id}
                className={`review-history-item${
                  selected?.id === review.id ? ' active' : ''
                }`}
                onClick={() => void openReport(review)}
              >
                <span className="review-history-time">
                  {formatDate(review.created_at)}
                </span>
                <span className="review-history-meta">
                  {review.model} · 录音 {review.coverage.recorded ?? '—'} 句 ·
                  音素 {review.coverage.phoneme_scored ?? '—'} 句
                </span>
                {loadingReportId === review.id ? (
                  <Loader2 size={14} className="spin" />
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
