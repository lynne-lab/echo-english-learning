import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import {
  BookMarked,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  Search,
  Square,
  Trash2,
  Volume2
} from 'lucide-react'
import { api, mediaUrl } from '../api'
import EmptyState from '../components/EmptyState'
import { useToast } from '../components/Toast'
import type { Occurrence, WordEntry } from '../types'
import { errorMessage, formatDuration, speakWord } from '../utils'

function HighlightedContext({ text, lemma }: { text: string; lemma: string }): ReactElement {
  const parts = useMemo(() => {
    const escaped = lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!escaped) return [text]
    return text.split(new RegExp(`(${escaped})`, 'ig'))
  }, [text, lemma])

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === lemma.toLowerCase() ? (
          <mark key={index}>{part}</mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}

export default function WordsPage(): ReactElement {
  const { push } = useToast()
  const [words, setWords] = useState<WordEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stopAtRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const data = await api.words()
        if (!cancelled) setWords(data)
      } catch {
        /* keep previous data */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return words
    return words.filter(
      (word) =>
        word.lemma.toLowerCase().includes(keyword) ||
        (word.translation ?? '').toLowerCase().includes(keyword) ||
        (word.definition ?? '').toLowerCase().includes(keyword)
    )
  }, [words, query])

  const totalOccurrences = useMemo(
    () => words.reduce((sum, word) => sum + word.occurrences.length, 0),
    [words]
  )

  const stopClip = (): void => {
    const audio = audioRef.current
    if (audio) audio.pause()
    stopAtRef.current = null
    setPlayingId(null)
  }

  const playClip = (occurrence: Occurrence): void => {
    const audio = audioRef.current
    if (!audio) return
    if (playingId === occurrence.id) {
      stopClip()
      return
    }
    stopClip()
    const target = mediaUrl(occurrence.material_id)
    stopAtRef.current = occurrence.end
    setPlayingId(occurrence.id)
    const startPlayback = (): void => {
      audio.currentTime = occurrence.start
      void audio.play().catch(() => stopClip())
    }
    if (audio.src !== target) {
      audio.src = target
      audio.onloadedmetadata = startPlayback
      audio.load()
    } else {
      startPlayback()
    }
  }

  const handleTimeUpdate = (): void => {
    const audio = audioRef.current
    if (!audio || stopAtRef.current === null) return
    if (audio.currentTime >= stopAtRef.current) stopClip()
  }

  const handleDelete = async (word: WordEntry): Promise<void> => {
    if (!window.confirm(`从生词本删除「${word.lemma}」？`)) return
    try {
      await api.deleteWord(word.id)
      setWords((previous) => previous.filter((item) => item.id !== word.id))
      push('已从生词本删除', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">VOCABULARY</div>
          <h1>生词本</h1>
          <p className="page-subtitle">
            在精听时点选单词就会保存到这里，每条都带着原句和原声片段。
          </p>
        </div>
        <div className="page-actions">
          <Link className="btn" to="/review">
            去复习
          </Link>
        </div>
      </header>

      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-value">{words.length}</span>
          <span className="stat-label">生词</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{totalOccurrences}</span>
          <span className="stat-label">出处句子</span>
        </div>
      </div>

      <div className="toolbar">
        <label className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索单词或释义…"
          />
        </label>
        <span className="toolbar-hint">
          {filtered.length === words.length ? `${words.length} 个生词` : `${filtered.length} 个结果`}
        </span>
      </div>

      {loading ? (
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在读取生词本…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<BookMarked size={30} />}
          title={words.length === 0 ? '生词本还是空的' : '没有匹配的单词'}
          description={
            words.length === 0
              ? '打开一个素材，在精听页面点击原文里的任意单词，就能查词并加入生词本。'
              : '换一个关键词试试。'
          }
        />
      ) : (
        <div className="word-list">
          {filtered.map((word) => {
            const expanded = expandedId === word.id
            return (
              <article className={`word-card${expanded ? ' expanded' : ''}`} key={word.id}>
                <div className="word-main">
                  <div className="word-heading">
                    <h3>{word.lemma}</h3>
                    {word.phonetic ? <span className="phonetic">/{word.phonetic}/</span> : null}
                    <button
                      className="btn-icon"
                      title="朗读单词"
                      onClick={() => speakWord(word.lemma)}
                    >
                      <Volume2 size={16} />
                    </button>
                    {word.review ? (
                      <span
                        className={`word-review-pill ${word.review.state_name}`}
                        title={
                          word.review.state_name === 'new'
                            ? '还没有复习过'
                            : `下次复习：${word.review.due_label ?? '—'}`
                        }
                      >
                        {word.review.state_name === 'new'
                          ? '新词'
                          : word.review.state_name === 'learning'
                            ? '学习中'
                            : word.review.state_name === 'relearning'
                              ? '重学'
                              : `复习 · ${word.review.due_label ?? ''}`}
                      </span>
                    ) : null}
                    <span className="occ-badge">{word.occurrences.length} 处</span>
                  </div>

                  <p className="word-translation">
                    {word.translation || word.definition || '未收录释义'}
                  </p>

                  <div className="word-actions">
                    {word.occurrences.length > 0 ? (
                      <button
                        className="btn btn-small btn-ghost"
                        onClick={() => setExpandedId(expanded ? null : word.id)}
                      >
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {expanded ? '收起出处' : `查看 ${word.occurrences.length} 个出处`}
                      </button>
                    ) : (
                      <span className="hint">暂无出处</span>
                    )}
                    <button
                      className="btn-icon danger-hover"
                      title="删除"
                      onClick={() => void handleDelete(word)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div className="occurrences">
                    {word.occurrences.map((occurrence) => (
                      <div className="occurrence" key={occurrence.id}>
                        <div className="occurrence-top">
                          <span className="occ-source">{occurrence.material_title}</span>
                          <span className="occ-time">
                            {formatDuration(occurrence.start)} – {formatDuration(occurrence.end)}
                          </span>
                          <button
                            className="btn-icon"
                            title={playingId === occurrence.id ? '停止' : '播放原句'}
                            onClick={() => playClip(occurrence)}
                          >
                            {playingId === occurrence.id ? <Square size={14} /> : <Play size={15} />}
                          </button>
                        </div>
                        <p className="occ-context">
                          “<HighlightedContext text={occurrence.context} lemma={word.lemma} />”
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}

      <audio
        ref={audioRef}
        className="audio-element"
        onTimeUpdate={handleTimeUpdate}
        onEnded={stopClip}
      />
    </div>
  )
}
