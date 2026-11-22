import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Film,
  Loader2,
  Music2,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  ScanText,
  Sparkles
} from 'lucide-react'
import { api, mediaUrl } from '../api'
import { DiffedSentence, ErrorChips } from '../components/GradeDiff'
import { useToast } from '../components/Toast'
import WordPanel from '../components/WordPanel'
import type {
  DictationErrors,
  DictationGrade,
  DictationItem,
  DictationMode,
  DictationSession,
  DictionaryEntry,
  Material
} from '../types'
import { errorMessage, formatDuration, speakWord, stripWord } from '../utils'

const COUNT_OPTIONS = [
  { value: 5, label: '5 句' },
  { value: 10, label: '10 句' },
  { value: 20, label: '20 句' },
  { value: 0, label: '全部' }
]

function GradePanel({
  grade,
  userText,
  isLast,
  onNext,
  onReplay,
  onWordClick,
  wordPanel
}: {
  grade: DictationGrade
  userText: string
  isLast: boolean
  onNext: () => void
  onReplay: () => void
  onWordClick?: (word: string) => void
  wordPanel?: ReactElement | null
}): ReactElement {
  const percent = Math.round(grade.accuracy * 100)
  const extras = grade.tokens.filter((token) => token.kind === 'extra')
  const corrections = grade.tokens.filter(
    (token) => token.kind === 'typo' || token.kind === 'wrong'
  )

  return (
    <div className={`grade-panel${percent >= 90 ? ' excellent' : percent >= 70 ? ' good' : ''}`}>
      <div className="grade-head">
        <div className="grade-score">
          <span>{percent}%</span>
          <small>准确率</small>
        </div>
        <div className="grade-title">
          <h3>
            {percent >= 99 ? '完全正确' : percent >= 80 ? '很接近了' : '再听一遍，对一下细节'}
          </h3>
          <p>
            {grade.word_correct} / {grade.scored_total} 个词正确
          </p>
        </div>
        <ErrorChips errors={grade.errors} />
      </div>

      <div className="diff-block">
        <span className="diff-label">
          原文批改
          {onWordClick ? <em className="diff-label-hint">点击单词可查词 / 加入生词本</em> : null}
        </span>
        <DiffedSentence
          text={grade.expected_text}
          tokens={grade.tokens}
          onWordClick={onWordClick}
        />
        {extras.length > 0 ? (
          <div className="extra-words">
            <span>多写：</span>
            {extras.map((token, index) => (
              <span className="diff-extra" key={index}>
                {token.actual}
              </span>
            ))}
          </div>
        ) : null}
        {!grade.punctuation_ok ? (
          <p className="punct-note">
            标点：原文 “{grade.expected_punctuation || '无'}”，你的答案 “
            {grade.actual_punctuation || '无'}”
          </p>
        ) : null}
      </div>

      {wordPanel ? <div className="grade-word-panel">{wordPanel}</div> : null}

      {corrections.length > 0 ? (
        <div className="corrections">
          <span className="diff-label">拼写 / 听错</span>
          <div className="correction-list">
            {corrections.map((token, index) => (
              <span className="correction-item" key={index}>
                <b>{token.expected}</b>
                <span>← 你写的是 {token.actual}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <details className="user-answer-block">
        <summary>你的答案</summary>
        <p>{userText || '（空）'}</p>
      </details>

      <div className="grade-actions">
        <button className="btn" onClick={onReplay}>
          <RotateCcw size={15} /> 再听一遍
        </button>
        <button className="btn btn-primary" onClick={onNext}>
          {isLast ? '完成并查看总结' : '下一句'} <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

export default function DictationPage(): ReactElement {
  const { id } = useParams<{ id: string }>()
  const { push } = useToast()

  const [material, setMaterial] = useState<Material | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'setup' | 'session' | 'summary'>('setup')
  const [mode, setMode] = useState<DictationMode>('full')
  const [count, setCount] = useState(10)
  const [starting, setStarting] = useState(false)
  const [session, setSession] = useState<DictationSession | null>(null)
  const [index, setIndex] = useState(0)
  const [userText, setUserText] = useState('')
  const [grade, setGrade] = useState<DictationGrade | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [attempts, setAttempts] = useState<
    Array<{ item: DictationItem; grade: DictationGrade }>
  >([])
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [audioTime, setAudioTime] = useState(0)
  const [speed, setSpeed] = useState(1)

  const [selectedWord, setSelectedWord] = useState<{
    word: string
    sentenceId: string
  } | null>(null)
  const [dictEntry, setDictEntry] = useState<DictionaryEntry | null>(null)
  const [dictLoading, setDictLoading] = useState(false)
  const [wordAdded, setWordAdded] = useState(false)
  const [wordAdding, setWordAdding] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stopAtRef = useRef<number | null>(null)
  const lookupSeqRef = useRef(0)

  const currentItem = session?.items[index] ?? null

  useEffect(() => {
    if (!id) return
    let cancelled = false
    api
      .material(id)
      .then((nextMaterial) => {
        if (!cancelled) setMaterial(nextMaterial)
      })
      .catch((loadErrorValue) => {
        if (!cancelled) setLoadError(errorMessage(loadErrorValue))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (phase !== 'session' || !currentItem || !material) return
    const audio = audioRef.current
    if (!audio) return
    const target = mediaUrl(material.id)
    stopAtRef.current = currentItem.end
    const startPlayback = (): void => {
      audio.playbackRate = speed
      audio.currentTime = currentItem.start
      setAudioTime(currentItem.start)
      void audio
        .play()
        .then(() => setAudioPlaying(true))
        .catch(() => setAudioPlaying(false))
    }
    if (audio.src !== target) {
      audio.src = target
      audio.onloadedmetadata = startPlayback
      audio.load()
    } else {
      startPlayback()
    }
    // speed changes are applied by the separate effect without restarting audio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentItem?.sentence_id, material?.id])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  useEffect(() => {
    if (grade) {
      audioRef.current?.pause()
      setAudioPlaying(false)
    }
  }, [grade])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  const playCurrent = (restart = false): void => {
    const audio = audioRef.current
    if (!audio || !currentItem || !material) return
    if (!restart && audioPlaying) {
      audio.pause()
      setAudioPlaying(false)
      return
    }
    const target = mediaUrl(material.id)
    stopAtRef.current = currentItem.end
    const startPlayback = (from: number): void => {
      audio.playbackRate = speed
      audio.currentTime = from
      setAudioTime(from)
      void audio
        .play()
        .then(() => setAudioPlaying(true))
        .catch(() => setAudioPlaying(false))
    }
    if (audio.src !== target) {
      audio.src = target
      audio.onloadedmetadata = () => startPlayback(currentItem.start)
      audio.load()
    } else {
      // resume from where the user dragged to; otherwise restart the sentence
      const canResume =
        !restart &&
        audio.currentTime >= currentItem.start - 0.05 &&
        audio.currentTime < currentItem.end - 0.05
      startPlayback(canResume ? audio.currentTime : currentItem.start)
    }
  }

  const seekWithinSentence = (value: number): void => {
    const audio = audioRef.current
    if (!audio || !currentItem) return
    const next = Math.max(currentItem.start, Math.min(value, currentItem.end))
    audio.currentTime = next
    setAudioTime(next)
    if (stopAtRef.current === null) stopAtRef.current = currentItem.end
  }

  const handleTimeUpdate = (): void => {
    const audio = audioRef.current
    if (!audio) return
    setAudioTime(audio.currentTime)
    if (stopAtRef.current === null) return
    if (audio.currentTime >= stopAtRef.current) {
      audio.pause()
      setAudioTime(stopAtRef.current)
      stopAtRef.current = null
      setAudioPlaying(false)
    }
  }

  const closeWordPanel = (): void => {
    lookupSeqRef.current += 1
    setSelectedWord(null)
    setDictEntry(null)
    setDictLoading(false)
    setWordAdded(false)
    setWordAdding(false)
  }

  const handleWordClick = async (raw: string): Promise<void> => {
    const word = stripWord(raw)
    if (!word || !currentItem) return
    const sentenceId = currentItem.sentence_id
    const seq = lookupSeqRef.current + 1
    lookupSeqRef.current = seq
    setSelectedWord({ word, sentenceId })
    setDictEntry(null)
    setWordAdded(false)
    setWordAdding(false)
    setDictLoading(true)
    try {
      const entry = await api.lookup(word)
      if (lookupSeqRef.current !== seq) return
      setDictEntry(entry)
      setWordAdded(entry.in_wordbook)
    } catch {
      if (lookupSeqRef.current !== seq) return
      setDictEntry(null)
    } finally {
      if (lookupSeqRef.current === seq) setDictLoading(false)
    }
  }

  const handleAddWord = async (): Promise<void> => {
    if (!selectedWord || wordAdding) return
    const seq = lookupSeqRef.current
    setWordAdding(true)
    try {
      const result = await api.addWord(selectedWord.word, selectedWord.sentenceId)
      if (lookupSeqRef.current !== seq) return
      setWordAdded(true)
      setDictEntry((previous) =>
        previous ? { ...previous, in_wordbook: true, word_id: result.id } : previous
      )
      window.dispatchEvent(new Event('echo:review-changed'))
      push(
        result.created ? `已加入生词本：${result.lemma}` : `已在生词本：${result.lemma}`,
        'success'
      )
    } catch (error) {
      if (lookupSeqRef.current === seq) push(errorMessage(error), 'error')
    } finally {
      if (lookupSeqRef.current === seq) setWordAdding(false)
    }
  }

  const startSession = async (): Promise<void> => {
    if (!material || starting) return
    setStarting(true)
    try {
      const nextSession = await api.createDictation(material.id, mode, count)
      setSession(nextSession)
      setIndex(0)
      setUserText('')
      setGrade(null)
      setAttempts([])
      closeWordPanel()
      setPhase('session')
    } catch (startError) {
      push(errorMessage(startError), 'error')
    } finally {
      setStarting(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (!session || !currentItem || grade || submitting) return
    setSubmitting(true)
    audioRef.current?.pause()
    setAudioPlaying(false)
    try {
      const result = await api.submitDictationAttempt(
        session.id,
        currentItem.sentence_id,
        userText
      )
      setGrade(result)
      setAttempts((previous) => [
        ...previous.filter((attempt) => attempt.item.sentence_id !== currentItem.sentence_id),
        { item: currentItem, grade: result }
      ])
      setSession((previous) =>
        previous ? { ...previous, ...result.session } : previous
      )
    } catch (submitError) {
      push(errorMessage(submitError), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const next = (): void => {
    if (!session) return
    closeWordPanel()
    if (index + 1 >= session.items.length) {
      audioRef.current?.pause()
      setAudioPlaying(false)
      setPhase('summary')
      return
    }
    setIndex((value) => value + 1)
    setUserText('')
    setGrade(null)
  }

  const resetToSetup = (): void => {
    audioRef.current?.pause()
    setAudioPlaying(false)
    closeWordPanel()
    setPhase('setup')
    setSession(null)
    setAttempts([])
    setIndex(0)
    setUserText('')
    setGrade(null)
  }

  const errorTotals = useMemo<DictationErrors>(() => {
    const totals: DictationErrors = {
      missing: 0,
      extra: 0,
      typo: 0,
      wrong: 0,
      punctuation: 0
    }
    for (const attempt of attempts) {
      for (const key of Object.keys(totals) as Array<keyof DictationErrors>) {
        totals[key] += attempt.grade.errors[key]
      }
    }
    return totals
  }, [attempts])

  if (loading) {
    return (
      <div className="page">
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在打开默写…
        </div>
      </div>
    )
  }

  if (loadError || !material) {
    return (
      <div className="page">
        <div className="status-panel">
          <div className="status-icon error">
            <AlertCircle size={30} />
          </div>
          <h2>找不到这个素材</h2>
          <p className="status-error">{loadError || '素材可能已经被删除。'}</p>
          <Link className="btn btn-primary" to="/dictation">
            返回默写首页
          </Link>
        </div>
      </div>
    )
  }

  if (material.status !== 'ready') {
    return (
      <div className="page">
        <div className="status-panel">
          <div className={`status-icon ${material.status === 'error' ? 'error' : ''}`}>
            {material.status === 'processing' ? (
              <Loader2 size={30} className="spin" />
            ) : (
              <AlertCircle size={30} />
            )}
          </div>
          <h2>{material.status === 'processing' ? '素材还在转写中' : '素材暂时不可用'}</h2>
          <p className="status-stage">{material.stage || material.error || '请稍后再试'}</p>
          <Link className="btn" to={`/player/${material.id}`}>
            去精听页查看
          </Link>
        </div>
      </div>
    )
  }

  if (phase === 'setup') {
    const willUse =
      count === 0 || count >= material.sentence_count ? material.sentence_count : count
    return (
      <div className="page dictation-page">
        <header className="dictation-header">
          <Link to="/dictation" className="btn-icon" title="返回默写首页">
            <ArrowLeft size={19} />
          </Link>
          <div className="dictation-header-title">
            <div className="eyebrow">DICTATION SETUP</div>
            <h1>{material.title}</h1>
            <div className="player-meta">
              <span>{material.media_type === 'video' ? '视频' : '音频'}</span>
              <span className="dot-separator">·</span>
              <span>{material.sentence_count} 句</span>
              <span className="dot-separator">·</span>
              <span>{formatDuration(material.duration)}</span>
            </div>
          </div>
        </header>

        <div className="dictation-setup-wrap">
          <div className="dictation-setup-card">
            <div className="setup-material-line">
              <div className={`material-icon ${material.media_type}`}>
                {material.media_type === 'video' ? <Film size={22} /> : <Music2 size={22} />}
              </div>
              <div>
                <h2>开始一次默写</h2>
                <p>音频逐句播放，提交后立即自动批改。</p>
              </div>
            </div>

            <div className="setup-section">
              <h3>练习方式</h3>
              <div className="mode-select-grid">
                <button
                  className={`mode-select-card${mode === 'full' ? ' active' : ''}`}
                  onClick={() => setMode('full')}
                >
                  <PenLine size={20} />
                  <strong>整句默写</strong>
                  <span>听完整句子，写出整句</span>
                </button>
                <button
                  className={`mode-select-card${mode === 'cloze' ? ' active' : ''}`}
                  onClick={() => setMode('cloze')}
                >
                  <ScanText size={20} />
                  <strong>抠词默写</strong>
                  <span>关键词被遮住，补全整句</span>
                </button>
              </div>
            </div>

            <div className="setup-section">
              <h3>本次句数</h3>
              <div className="count-chips">
                {COUNT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`count-chip${count === option.value ? ' active' : ''}`}
                    onClick={() => setCount(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="hint">
                {willUse >= material.sentence_count
                  ? `本次将练习全部 ${material.sentence_count} 句。`
                  : `将从 ${material.sentence_count} 句中随机抽取 ${willUse} 句，按原文顺序练习。`}
              </p>
            </div>

            <button
              className="btn btn-primary setup-start"
              onClick={() => void startSession()}
              disabled={starting}
            >
              {starting ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
              开始默写
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'summary' && session) {
    const percent = Math.round((session.accuracy ?? 0) * 100)
    return (
      <div className="page dictation-page">
        <header className="dictation-header">
          <Link to="/dictation" className="btn-icon" title="返回默写首页">
            <ArrowLeft size={19} />
          </Link>
          <div className="dictation-header-title">
            <div className="eyebrow">DICTATION SUMMARY</div>
            <h1>本次默写完成</h1>
          </div>
        </header>

        <div className="dictation-summary">
          <div className="summary-hero">
            <div className="summary-hero-icon">
              <Sparkles size={28} />
            </div>
            <div>
              <span className="summary-hero-label">整体准确率</span>
              <div className="summary-hero-value">{percent}%</div>
              <p>
                {material.title} · {session.mode === 'full' ? '整句默写' : '抠词默写'} ·{' '}
                {attempts.length} 句
              </p>
            </div>
          </div>

          <div className="stats-row">
            <div className="stat-card">
              <span className="stat-value">{session.correct_count}</span>
              <span className="stat-label">完全正确的句子</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">
                {session.word_correct}/{session.scored_total}
              </span>
              <span className="stat-label">正确单词</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">
                {errorTotals.missing +
                  errorTotals.extra +
                  errorTotals.typo +
                  errorTotals.wrong +
                  errorTotals.punctuation}
              </span>
              <span className="stat-label">错误总数</span>
            </div>
          </div>

          <ErrorChips errors={errorTotals} />

          <div className="summary-list">
            {session.items.map((item, itemIndex) => {
              const attempt = attempts.find(
                (entry) => entry.item.sentence_id === item.sentence_id
              )
              const itemPercent = attempt ? Math.round(attempt.grade.accuracy * 100) : 0
              return (
                <div className="summary-row" key={item.sentence_id}>
                  <span className="summary-row-index">{itemIndex + 1}</span>
                  <p>{item.text}</p>
                  <span
                    className={`summary-row-score${
                      itemPercent >= 90 ? ' excellent' : itemPercent >= 70 ? ' good' : ''
                    }`}
                  >
                    {itemPercent}%
                  </span>
                </div>
              )
            })}
          </div>

          <div className="done-actions">
            <button className="btn btn-primary" onClick={resetToSetup}>
              <RotateCcw size={16} /> 再练一次
            </button>
            <Link className="btn" to="/dictation">
              返回默写首页
            </Link>
            <Link className="btn" to="/stats">
              查看统计
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!session || !currentItem) {
    return (
      <div className="page">
        <div className="status-panel">
          <h2>没有可练习的句子</h2>
          <Link className="btn btn-primary" to="/dictation">
            返回默写首页
          </Link>
        </div>
      </div>
    )
  }

  const isLast = index + 1 >= session.items.length
  const segmentLength = Math.max(currentItem.end - currentItem.start, 0.01)
  const segmentTime = Math.min(Math.max(audioTime, currentItem.start), currentItem.end)
  const segmentPercent = ((segmentTime - currentItem.start) / segmentLength) * 100
  return (
    <div className="page dictation-page">
      <header className="dictation-header">
        <Link to="/dictation" className="btn-icon" title="退出练习">
          <ArrowLeft size={19} />
        </Link>
        <div className="dictation-header-title">
          <div className="eyebrow">DICTATION</div>
          <h1>{material.title}</h1>
          <div className="player-meta">
            <span>{mode === 'full' ? '整句默写' : '抠词默写'}</span>
            <span className="dot-separator">·</span>
            <span>
              第 {index + 1} / {session.items.length} 句
            </span>
          </div>
        </div>
        <div className="dictation-header-progress">
          <div className="review-progress-track">
            <div
              className="review-progress-fill"
              style={{ width: `${((index + (grade ? 1 : 0)) / session.items.length) * 100}%` }}
            />
          </div>
        </div>
      </header>

      <div className="dictation-session">
        <div className="listener-card">
          <button className="listener-play" onClick={() => playCurrent()} title="播放 / 暂停">
            {audioPlaying ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <div className="listener-body">
            <span className="eyebrow">LISTEN</span>
            <p>{mode === 'cloze' ? '听音频，补全被遮住的词' : '听音频，写出完整句子'}</p>
            <div className="listener-controls">
              <button className="btn btn-small" onClick={() => playCurrent(true)}>
                <RotateCcw size={14} /> 再听一遍
              </button>
              <div className="speed-chips">
                <button
                  className={`speed-chip${speed === 0.75 ? ' active' : ''}`}
                  onClick={() => setSpeed(0.75)}
                >
                  0.75x
                </button>
                <button
                  className={`speed-chip${speed === 1 ? ' active' : ''}`}
                  onClick={() => setSpeed(1)}
                >
                  1x
                </button>
              </div>
            </div>
            <div className="dictation-seek">
              <span className="dictation-seek-time">
                {formatDuration(segmentTime - currentItem.start)}
              </span>
              <input
                className="seek-bar dictation-seek-bar"
                type="range"
                min={currentItem.start}
                max={currentItem.end}
                step={0.05}
                value={segmentTime}
                style={{
                  background: `linear-gradient(to right, var(--accent) ${segmentPercent}%, var(--border-strong) ${segmentPercent}%)`
                }}
                onChange={(event) => seekWithinSentence(Number(event.target.value))}
                title="拖动进度条可回听句子中的任意片段"
                aria-label="本句播放进度"
              />
              <span className="dictation-seek-time">
                {formatDuration(segmentLength)}
              </span>
            </div>
          </div>
          <div className={`equalizer mini${audioPlaying ? ' active' : ''}`} aria-hidden="true">
            {[0, 1, 2, 3, 4].map((bar) => (
              <span key={bar} style={{ animationDelay: `${bar * 0.12}s` }} />
            ))}
          </div>
        </div>

        {mode === 'cloze' && currentItem.cloze_segments ? (
          <div className="cloze-card">
            <span className="diff-label">填空提示</span>
            <p className="cloze-text">
              {currentItem.cloze_segments.map((segment, segmentIndex) =>
                segment.blank ? (
                  <span
                    className="cloze-blank"
                    key={segmentIndex}
                    style={{ minWidth: `${Math.max(48, segment.text.length * 8)}px` }}
                    aria-label="填空"
                  />
                ) : (
                  <span key={segmentIndex}>{segment.text}</span>
                )
              )}
            </p>
          </div>
        ) : null}

        <div className="dictation-input-card">
          <label className="field">
            <span>你的答案</span>
            <textarea
              rows={3}
              value={userText}
              onChange={(event) => setUserText(event.target.value)}
              disabled={Boolean(grade) || submitting}
              placeholder="听完后在这里写出句子（标点差异会单独提示，单词准确率不受影响）…"
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  if (grade) next()
                  else void submit()
                }
              }}
            />
          </label>
          <div className="input-actions">
            <span className="hint">Ctrl + Enter 提交</span>
            <button
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={submitting || Boolean(grade)}
            >
              {submitting ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              提交批改
            </button>
          </div>
        </div>

        {grade ? (
          <GradePanel
            grade={grade}
            userText={userText}
            isLast={isLast}
            onNext={next}
            onReplay={() => playCurrent(true)}
            onWordClick={(word) => void handleWordClick(word)}
            wordPanel={
              selectedWord ? (
                <WordPanel
                  word={selectedWord.word}
                  entry={dictEntry}
                  loading={dictLoading}
                  added={wordAdded}
                  adding={wordAdding}
                  onAdd={() => void handleAddWord()}
                  onSpeak={() => speakWord(selectedWord.word)}
                  onClose={closeWordPanel}
                />
              ) : null
            }
          />
        ) : null}
      </div>

      <audio
        ref={audioRef}
        className="audio-element"
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => {
          setAudioPlaying(false)
          stopAtRef.current = null
        }}
      />
    </div>
  )
}
