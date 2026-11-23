import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  BookOpen,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Volume2
} from 'lucide-react'
import { api, mediaUrl } from '../api'
import { useToast } from '../components/Toast'
import type { ReviewCard, ReviewSummary } from '../types'
import { errorMessage, speakWord } from '../utils'

const STATE_LABELS: Record<string, string> = {
  new: '新词',
  learning: '学习中',
  review: '复习',
  relearning: '重学'
}

const RATING_OPTIONS = [
  { rating: 1, label: '再来一次', className: 'again', hint: '忘了' },
  { rating: 2, label: '有点难', className: 'hard', hint: '勉强想起' },
  { rating: 3, label: '记得', className: 'good', hint: '想起来了' },
  { rating: 4, label: '很简单', className: 'easy', hint: '毫不费力' }
]

function maskWord(text: string, word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return text.replace(
      new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'gi'),
      '_____'
    )
  } catch {
    return text
  }
}

function highlightWord(text: string, word: string): ReactNode {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    const parts = text.split(new RegExp(`(?<![A-Za-z])(${escaped})(?![A-Za-z])`, 'i'))
    return parts.map((part, index) =>
      index % 2 === 1 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>
    )
  } catch {
    return text
  }
}

export default function ReviewPage(): ReactElement {
  const { push } = useToast()
  const [cards, setCards] = useState<ReviewCard[]>([])
  const [summary, setSummary] = useState<ReviewSummary | null>(null)
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [previews, setPreviews] = useState<Array<{ rating: number; interval: string }>>([])
  const [submitting, setSubmitting] = useState(false)
  const [sessionRatings, setSessionRatings] = useState<number[]>([])
  const [playing, setPlaying] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stopAtRef = useRef<number | null>(null)
  const startedAtRef = useRef(Date.now())

  const current = cards[index] ?? null
  const done = index >= cards.length

  const loadQueue = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [data, saved] = await Promise.all([
        api.reviewQueue(20),
        api
          .moduleState<{
            word_id?: string | null
            revealed?: boolean
            ratings?: number[]
          }>('review')
          .catch(() => null)
      ])
      setCards(data.cards)
      setSummary(data.summary)
      const savedState = saved?.state
      const savedWord = savedState?.word_id ?? null
      const savedIndex = savedWord
        ? data.cards.findIndex((card) => card.word_id === savedWord)
        : -1
      setIndex(savedIndex >= 0 ? savedIndex : 0)
      setRevealed(savedIndex >= 0 ? Boolean(savedState?.revealed) : false)
      setSessionRatings(
        savedIndex >= 0 && Array.isArray(savedState?.ratings)
          ? savedState.ratings
          : []
      )
      setPreviews([])
      window.dispatchEvent(new Event('echo:review-changed'))
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    if (!current) {
      setPreviews([])
      return
    }
    let cancelled = false
    setPreviews([])
    startedAtRef.current = Date.now()
    api
      .reviewPreview(current.word_id)
      .then((result) => {
        if (!cancelled) setPreviews(result.previews)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [current?.word_id])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.pause()
    setPlaying(false)
    stopAtRef.current = null
  }, [current?.word_id])

  useEffect(() => {
    if (loading || !current) return
    void api
      .saveModuleState('review', {
        word_id: current.word_id,
        revealed,
        ratings: sessionRatings
      })
      .catch(() => undefined)
  }, [loading, current?.word_id, revealed, sessionRatings])

  const previewMap = useMemo(() => {
    const map: Record<number, string> = {}
    for (const item of previews) map[item.rating] = item.interval
    return map
  }, [previews])

  const toggleAudio = useCallback((): void => {
    const audio = audioRef.current
    const occurrence = current?.occurrence
    if (!audio || !occurrence) return
    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }
    const target = mediaUrl(occurrence.material_id)
    stopAtRef.current = occurrence.end
    const startPlayback = (): void => {
      audio.currentTime = occurrence.start
      void audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false))
    }
    if (audio.src !== target) {
      audio.src = target
      audio.onloadedmetadata = startPlayback
      audio.load()
    } else {
      startPlayback()
    }
  }, [current, playing])

  const handleAudioTimeUpdate = (): void => {
    const audio = audioRef.current
    if (!audio || stopAtRef.current === null) return
    if (audio.currentTime >= stopAtRef.current) {
      audio.pause()
      stopAtRef.current = null
      setPlaying(false)
    }
  }

  const rate = useCallback(
    async (rating: number): Promise<void> => {
      if (!current || submitting) return
      setSubmitting(true)
      try {
        const result = await api.rateReview(
          current.word_id,
          rating,
          Date.now() - startedAtRef.current
        )
        setSummary(result.summary)
        setSessionRatings((previous) => [...previous, rating])
        push(`已记录 · 下次复习在 ${result.interval} 后`, 'success')
        setIndex((value) => value + 1)
        setRevealed(false)
        window.dispatchEvent(new Event('echo:review-changed'))
      } catch (rateError) {
        push(errorMessage(rateError), 'error')
      } finally {
        setSubmitting(false)
      }
    },
    [current, submitting, push]
  )

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.isContentEditable)
      ) {
        return
      }
      if (!current) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (!revealed) setRevealed(true)
      } else if (event.code === 'KeyR') {
        toggleAudio()
      } else if (revealed && /^Digit[1-4]$/.test(event.code)) {
        void rate(Number(event.code.slice(-1)))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [current, revealed, rate, toggleAudio])

  if (loading) {
    return (
      <div className="page">
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在整理今天的复习…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <div className="status-panel">
          <div className="status-icon error">
            <AlertCircle size={30} />
          </div>
          <h2>复习队列加载失败</h2>
          <p className="status-error">{error}</p>
          <button className="btn btn-primary" onClick={() => void loadQueue()}>
            <RefreshCw size={16} /> 重试
          </button>
        </div>
      </div>
    )
  }

  if (done) {
    const counts = [1, 2, 3, 4].map(
      (rating) => sessionRatings.filter((value) => value === rating).length
    )
    const remaining = summary ? summary.due_reviews + summary.new_available : 0
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <div className="eyebrow">REVIEW</div>
            <h1>今日复习</h1>
            <p className="page-subtitle">FSRS 会根据你的回忆质量安排下一次复习时间。</p>
          </div>
        </header>

        <div className="review-done">
          <div className="done-icon">
            <Sparkles size={30} />
          </div>
          <h2>{sessionRatings.length > 0 ? '本轮复习完成' : '今天的复习已完成'}</h2>
          <p className="review-done-sub">
            {sessionRatings.length > 0
              ? `本轮复习了 ${sessionRatings.length} 张卡片。`
              : summary && summary.next_due_label
                ? `下一次到期在 ${summary.next_due_label} 后。`
                : '暂时没有到期的卡片，去添加一些生词吧。'}
          </p>

          {sessionRatings.length > 0 ? (
            <div className="rating-summary">
              {RATING_OPTIONS.map((option, optionIndex) => (
                <div className={`rating-summary-item ${option.className}`} key={option.rating}>
                  <span className="rating-summary-value">{counts[optionIndex]}</span>
                  <span className="rating-summary-label">{option.label}</span>
                </div>
              ))}
            </div>
          ) : null}

          {summary ? (
            <div className="review-done-stats">
              <span>今日已复习 {summary.reviews_today} 张</span>
              <span>生词总数 {summary.total_words}</span>
              {remaining > 0 ? <span>还有 {remaining} 张可复习</span> : null}
            </div>
          ) : null}

          <div className="done-actions">
            <button className="btn btn-primary" onClick={() => void loadQueue()}>
              <RefreshCw size={16} /> 继续复习
            </button>
            <Link className="btn" to="/dictation">
              <BookOpen size={16} /> 去默写
            </Link>
            <Link className="btn" to="/stats">
              查看统计
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!current) return <div className="page" />

  const occurrence = current.occurrence
  const word = occurrence?.surface || current.lemma
  const maskedText = occurrence ? maskWord(occurrence.context, word) : null
  const maskFailed = occurrence ? maskedText === occurrence.context : false
  const progress = cards.length > 0 ? (index / cards.length) * 100 : 0

  return (
    <div className="page review-page">
      <header className="review-header">
        <div>
          <div className="eyebrow">REVIEW</div>
          <h1>今日复习</h1>
        </div>
        <div className="review-queue-meta">
          {summary ? (
            <>
              <span>到期 {summary.due_reviews}</span>
              <span className="dot-separator">·</span>
              <span>新词 {summary.new_available}</span>
              <span className="dot-separator">·</span>
              <span>今日已复习 {summary.reviews_today}</span>
            </>
          ) : null}
        </div>
      </header>

      <div className="review-progress-row">
        <span>
          第 {Math.min(index + 1, cards.length)} / {cards.length} 张
        </span>
        <div className="review-progress-track">
          <div className="review-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className={`state-pill ${current.state_name}`}>
          {STATE_LABELS[current.state_name] ?? current.state_name}
        </span>
      </div>

      <div className="review-card">
        <div className="review-listen">
          <button
            className="review-play-button"
            onClick={toggleAudio}
            disabled={!occurrence}
            title={playing ? '暂停原句' : '播放原句 (R)'}
          >
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <div className="review-listen-body">
            <span className="review-kicker">
              听原句{occurrence?.material_title ? ` · ${occurrence.material_title}` : ''}
            </span>
            {occurrence ? (
              <p className={`review-context${!revealed && maskFailed ? ' blurred' : ''}`}>
                {revealed ? occurrence.context : maskedText}
              </p>
            ) : (
              <p className="review-context muted">这个词没有关联原句，仍然可以复习。</p>
            )}
          </div>
        </div>

        {revealed ? (
          <div className="review-answer">
            <div className="review-word-row">
              <h2>{word}</h2>
              {current.phonetic ? (
                <span className="phonetic">/{current.phonetic}/</span>
              ) : null}
              <button
                className="btn-icon review-speak"
                title="朗读单词"
                onClick={() => speakWord(word)}
              >
                <Volume2 size={17} />
              </button>
              {occurrence ? (
                <span className="review-source">来自《{occurrence.material_title ?? '素材'}》</span>
              ) : null}
            </div>

            <p className="review-translation">
              {current.translation || current.definition || 'ECDICT 未收录释义'}
            </p>

            {current.definition && current.translation ? (
              <details className="review-definition">
                <summary>英文释义</summary>
                <p>{current.definition}</p>
              </details>
            ) : null}

            {occurrence ? (
              <p className="review-full-sentence">
                {highlightWord(occurrence.context, word)}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="review-hidden">
            <div className="review-question-mark">?</div>
            <p>听句子，回忆这个单词</p>
            <button
              className="btn btn-primary"
              onClick={(event) => {
                event.currentTarget.blur()
                setRevealed(true)
              }}
            >
              显示答案 <kbd>Space</kbd>
            </button>
          </div>
        )}

        {revealed ? (
          <div className="rating-grid">
            {RATING_OPTIONS.map((option) => (
              <button
                key={option.rating}
                className={`rating-button ${option.className}`}
                onClick={() => void rate(option.rating)}
                disabled={submitting}
              >
                <span className="rating-name">{option.label}</span>
                <span className="rating-interval">
                  {previewMap[option.rating] ?? '…'}
                </span>
                <span className="rating-hint">{option.hint}</span>
                <kbd>{option.rating}</kbd>
              </button>
            ))}
            {submitting ? (
              <span className="rating-submitting">
                <Loader2 size={14} className="spin" /> 正在安排下次复习…
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="review-footer-hint">
        <span><kbd>Space</kbd> 显示答案</span>
        <span><kbd>1</kbd>–<kbd>4</kbd> 评价</span>
        <span><kbd>R</kbd> 重听原句</span>
      </div>

      <audio
        ref={audioRef}
        className="audio-element"
        onTimeUpdate={handleAudioTimeUpdate}
        onEnded={() => {
          setPlaying(false)
          stopAtRef.current = null
        }}
      />
    </div>
  )
}
