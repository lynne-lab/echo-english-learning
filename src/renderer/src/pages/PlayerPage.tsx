import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Captions,
  Check,
  FastForward,
  Loader2,
  Maximize2,
  Mic,
  Music2,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  PenLine,
  Pencil,
  Play,
  RefreshCw,
  Repeat2,
  Rewind,
  X
} from 'lucide-react'
import { api, mediaUrl } from '../api'
import { useToast } from '../components/Toast'
import WordPanel from '../components/WordPanel'
import type { DictionaryEntry, Material, Sentence } from '../types'
import {
  errorMessage,
  formatDuration,
  sentencePlaybackEnd,
  speakWord,
  stripWord
} from '../utils'

const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5]

export default function PlayerPage(): ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { push } = useToast()

  const [material, setMaterial] = useState<Material | null>(null)
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [loopSentenceId, setLoopSentenceId] = useState<string | null>(null)
  const [showSubtitle, setShowSubtitle] = useState(true)
  const [showTranscript, setShowTranscript] = useState(true)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [progressReady, setProgressReady] = useState(false)
  const progressReadyRef = useRef(false)
  const latestProgressRef = useRef<{
    materialId: string
    sentenceId: string
    idx: number
  } | null>(null)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const [selected, setSelected] = useState<{ word: string; sentence: Sentence } | null>(null)
  const [dictEntry, setDictEntry] = useState<DictionaryEntry | null>(null)
  const [dictLoading, setDictLoading] = useState(false)
  const [added, setAdded] = useState(false)
  const [adding, setAdding] = useState(false)

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const pendingSeekRef = useRef<number | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    let timer = 0

    setLoading(true)
    setNotFound(false)
    setSentences([])
    setCurrentTime(0)
    setPlaying(false)
    setLoopSentenceId(null)
    setMediaError(null)
    setSelected(null)
    setEditingId(null)
    setProgressReady(false)
    progressReadyRef.current = false
    pendingSeekRef.current = null

    const tick = async (): Promise<void> => {
      try {
        const nextMaterial = await api.material(id)
        if (cancelled) return
        setMaterial(nextMaterial)
        setDuration(nextMaterial.duration ?? 0)
        setLoading(false)

        if (nextMaterial.status === 'ready') {
          const [nextSentences, saved] = await Promise.all([
            api.sentences(id),
            api.progress('player', id).catch(() => null)
          ])
          if (cancelled) return
          setSentences(nextSentences)
          const last = nextSentences[nextSentences.length - 1]
          if (!nextMaterial.duration && last) setDuration(last.end)
          let restorePending = false
          if (saved) {
            const target =
              nextSentences.find(
                (sentence) => sentence.id === saved.sentence_id
              ) ??
              nextSentences.find(
                (sentence) => sentence.idx === saved.sentence_idx
              )
            if (target) {
              pendingSeekRef.current = target.start
              restorePending = true
              const media = mediaRef.current
              if (
                media &&
                media.readyState >= 1 &&
                media.getAttribute('src') === mediaUrl(nextMaterial.id)
              ) {
                pendingSeekRef.current = null
                media.currentTime = target.start
                setCurrentTime(target.start)
                restorePending = false
              }
            }
          }
          if (!restorePending) {
            setProgressReady(true)
            progressReadyRef.current = true
          }
        } else if (nextMaterial.status === 'processing') {
          timer = window.setTimeout(() => {
            void tick()
          }, 1500)
        }
      } catch {
        if (!cancelled) {
          setNotFound(true)
          setLoading(false)
        }
      }
    }

    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [id, reloadKey])

  const activeSentence = useMemo<Sentence | null>(() => {
    if (!sentences.length) return null
    const exact = sentences.find(
      (sentence) => currentTime >= sentence.start - 0.06 && currentTime < sentence.end + 0.1
    )
    if (exact) return exact
    return sentences.find((sentence) => sentence.start > currentTime) ?? sentences[sentences.length - 1]
  }, [sentences, currentTime])

  const togglePlay = useCallback((): void => {
    const media = mediaRef.current
    if (!media) return
    if (media.paused) void media.play().catch(() => undefined)
    else media.pause()
  }, [])

  const seekTo = useCallback(
    (time: number): void => {
      const media = mediaRef.current
      if (!media) return
      const limit = duration || media.duration || 0
      const next = Math.max(0, Math.min(time, limit > 0 ? limit : time))
      media.currentTime = next
      setCurrentTime(next)
    },
    [duration]
  )

  const playMedia = useCallback((): void => {
    const media = mediaRef.current
    if (media) void media.play().catch(() => undefined)
  }, [])

  const selectSentence = useCallback(
    (sentence: Sentence): void => {
      if (editingId === sentence.id) return
      pendingSeekRef.current = null
      seekTo(sentence.start)
      playMedia()
    },
    [editingId, seekTo, playMedia]
  )

  const jumpSentence = useCallback(
    (delta: number): void => {
      if (!sentences.length) return
      const currentIndex = activeSentence
        ? sentences.findIndex((sentence) => sentence.id === activeSentence.id)
        : 0
      const nextIndex = Math.max(0, Math.min(sentences.length - 1, currentIndex + delta))
      selectSentence(sentences[nextIndex])
    },
    [sentences, activeSentence, selectSentence]
  )

  const toggleLoopActive = useCallback((): void => {
    if (loopSentenceId) {
      setLoopSentenceId(null)
      return
    }
    if (!activeSentence) return
    setLoopSentenceId(activeSentence.id)
    seekTo(activeSentence.start)
    playMedia()
  }, [loopSentenceId, activeSentence, seekTo, playMedia])

  const handleTimeUpdate = (): void => {
    const media = mediaRef.current
    if (!media) return
    setCurrentTime(media.currentTime)
    if (loopSentenceId) {
      const index = sentences.findIndex(
        (sentence) => sentence.id === loopSentenceId
      )
      const target = index >= 0 ? sentences[index] : null
      if (target) {
        const end = sentencePlaybackEnd(
          target,
          sentences[index + 1] ?? null,
          duration
        )
        if (media.currentTime >= end) {
          media.currentTime = target.start
          void media.play().catch(() => undefined)
        }
      }
    }
  }

  const handleLoadedMetadata = (): void => {
    const media = mediaRef.current
    if (!media) return
    media.playbackRate = speed
    if (Number.isFinite(media.duration) && media.duration > 0) {
      setDuration(media.duration)
    }
    if (pendingSeekRef.current !== null) {
      const target = Math.max(
        0,
        Math.min(
          pendingSeekRef.current,
          Number.isFinite(media.duration) ? media.duration : pendingSeekRef.current
        )
      )
      pendingSeekRef.current = null
      media.currentTime = target
      setCurrentTime(target)
    }
    // The saved position has been applied (or there was none); progress can
    // now be written without overwriting the previous position.
    setProgressReady(true)
    progressReadyRef.current = true
  }

  useEffect(() => {
    if (material && activeSentence) {
      latestProgressRef.current = {
        materialId: material.id,
        sentenceId: activeSentence.id,
        idx: activeSentence.idx
      }
    }
  }, [material?.id, activeSentence?.id])

  useEffect(() => {
    return () => {
      const latest = latestProgressRef.current
      if (!progressReadyRef.current || !latest) return
      void api
        .saveProgress(
          'player',
          latest.materialId,
          latest.sentenceId,
          latest.idx
        )
        .catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (!material || !activeSentence || !progressReady) return
    const timer = window.setTimeout(() => {
      void api
        .saveProgress(
          'player',
          material.id,
          activeSentence.id,
          activeSentence.idx
        )
        .catch(() => undefined)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [material?.id, activeSentence?.id, progressReady])

  useEffect(() => {
    const media = mediaRef.current
    if (media) media.playbackRate = speed
  }, [speed])

  useEffect(() => {
    if (!playing || !showTranscript) return
    const activeId = activeSentence?.id
    if (!activeId) return
    rowRefs.current.get(activeId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeSentence?.id, playing, showTranscript])

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

      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault()
        seekTo((mediaRef.current?.currentTime ?? 0) - 5)
      } else if (event.code === 'ArrowRight') {
        event.preventDefault()
        seekTo((mediaRef.current?.currentTime ?? 0) + 5)
      } else if (event.code === 'ArrowUp') {
        event.preventDefault()
        jumpSentence(-1)
      } else if (event.code === 'ArrowDown') {
        event.preventDefault()
        jumpSentence(1)
      } else if (event.code === 'KeyL') {
        toggleLoopActive()
      } else if (event.code === 'KeyS') {
        setShowSubtitle((previous) => !previous)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [togglePlay, seekTo, jumpSentence, toggleLoopActive])

  const startTitleEdit = (): void => {
    if (!material) return
    setTitleDraft(material.title)
    setEditingTitle(true)
  }

  const saveTitle = async (): Promise<void> => {
    if (!material) return
    const nextTitle = titleDraft.trim()
    if (!nextTitle || nextTitle === material.title) {
      setEditingTitle(false)
      return
    }
    try {
      const updated = await api.patchMaterial(material.id, nextTitle)
      setMaterial(updated)
      setEditingTitle(false)
      push('标题已更新', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    }
  }

  const handleRetry = async (): Promise<void> => {
    if (!material) return
    if (
      material.status === 'ready' &&
      !window.confirm('重新转写会重新生成句子，已校对的文本会被覆盖（生词出处会尽量保留）。继续吗？')
    ) {
      return
    }
    try {
      await api.retryMaterial(material.id)
      setReloadKey((value) => value + 1)
      push('已重新开始转写', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    }
  }

  const startEdit = (sentence: Sentence): void => {
    setEditingId(sentence.id)
    setEditDraft(sentence.text)
  }

  const saveEdit = async (sentence: Sentence): Promise<void> => {
    const text = editDraft.trim()
    if (!text) {
      push('句子不能为空', 'error')
      return
    }
    try {
      const updated = await api.patchSentence(sentence.id, text)
      setSentences((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item))
      )
      setEditingId(null)
      push('已保存校对', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    }
  }

  const toggleLoopSentence = (sentence: Sentence): void => {
    if (loopSentenceId === sentence.id) {
      setLoopSentenceId(null)
      return
    }
    setLoopSentenceId(sentence.id)
    seekTo(sentence.start)
    playMedia()
  }

  const handleWordClick = async (raw: string, sentence: Sentence): Promise<void> => {
    const word = stripWord(raw)
    if (!word) return
    setSelected({ word, sentence })
    setDictEntry(null)
    setAdded(false)
    setDictLoading(true)
    try {
      const entry = await api.lookup(word)
      setDictEntry(entry)
      setAdded(entry.in_wordbook)
    } catch {
      setDictEntry(null)
    } finally {
      setDictLoading(false)
    }
  }

  const handleAddWord = async (): Promise<void> => {
    if (!selected) return
    setAdding(true)
    try {
      const result = await api.addWord(selected.word, selected.sentence.id)
      setAdded(true)
      setDictEntry((previous) =>
        previous ? { ...previous, in_wordbook: true, word_id: result.id } : previous
      )
      window.dispatchEvent(new Event('echo:review-changed'))
      push(
        result.created ? `已加入生词本：${result.lemma}` : `已在生词本：${result.lemma}`,
        'success'
      )
    } catch (error) {
      push(errorMessage(error), 'error')
    } finally {
      setAdding(false)
    }
  }

  const handleFullscreen = (): void => {
    const frame = frameRef.current
    if (!frame) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void frame.requestFullscreen()
  }

  const renderTokens = (text: string, sentence: Sentence): ReactNode => {
    const parts = text.split(/([A-Za-z]+(?:['’\-][A-Za-z]+)*)/g)
    return parts.map((part, index) => {
      if (!/^[A-Za-z]/.test(part)) return <span key={index}>{part}</span>
      return (
        <button
          key={index}
          className="word-token"
          onClick={(event) => {
            event.stopPropagation()
            void handleWordClick(part, sentence)
          }}
        >
          {part}
        </button>
      )
    })
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在打开素材…
        </div>
      </div>
    )
  }

  if (notFound || !material) {
    return (
      <div className="page">
        <div className="status-panel">
          <div className="status-icon error">
            <AlertCircle size={30} />
          </div>
          <h2>找不到这个素材</h2>
          <p className="status-stage">它可能已经被删除。</p>
          <Link className="btn btn-primary" to="/library">
            返回素材库
          </Link>
        </div>
      </div>
    )
  }

  const isReady = material.status === 'ready' && sentences.length > 0
  const displayDuration = duration || material.duration || 0
  const progressPercent = Math.round(Math.min(Math.max(material.progress, 0), 1) * 100)

  return (
    <div className="page player-page">
      <header className="player-header">
        <Link to="/library" className="btn-icon" title="返回素材库">
          <ArrowLeft size={19} />
        </Link>

        <div className="player-title-block">
          <div className="eyebrow">LISTENING</div>
          {editingTitle ? (
            <form
              className="title-edit-form"
              onSubmit={(event) => {
                event.preventDefault()
                void saveTitle()
              }}
            >
              <input
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setEditingTitle(false)
                }}
              />
              <button className="btn-icon" type="submit" title="保存">
                <Check size={16} />
              </button>
              <button
                className="btn-icon"
                type="button"
                title="取消"
                onClick={() => setEditingTitle(false)}
              >
                <X size={16} />
              </button>
            </form>
          ) : (
            <h1>
              {material.title}
              {isReady ? (
                <button className="btn-icon title-edit-button" onClick={startTitleEdit} title="重命名">
                  <Pencil size={14} />
                </button>
              ) : null}
            </h1>
          )}
          <div className="player-meta">
            <span>{material.source_type === 'url' ? '在线链接' : '本地文件'}</span>
            <span className="dot-separator">·</span>
            <span>{sentences.length || material.sentence_count} 句</span>
            <span className="dot-separator">·</span>
            <span>{formatDuration(material.duration)}</span>
          </div>
        </div>

        <div className="player-header-actions">
          {material.status === 'ready' && sentences.length > 0 && activeSentence ? (
            <select
              className="sentence-jump"
              value={activeSentence.id}
              onChange={(event) => {
                const target = sentences.find(
                  (sentence) => sentence.id === event.target.value
                )
                if (target) selectSentence(target)
              }}
              title="跳到指定句子"
            >
              {sentences.map((sentence, sentenceIndex) => (
                <option key={sentence.id} value={sentence.id}>
                  第 {sentenceIndex + 1} 句 · {sentence.text.slice(0, 40)}
                </option>
              ))}
            </select>
          ) : null}
          {material.status === 'ready' && sentences.length > 0 ? (
            <>
              <button
                className="btn btn-small"
                onClick={() => navigate(`/shadow/${material.id}`)}
              >
                <Mic size={14} /> 跟读
              </button>
              <button
                className="btn btn-small"
                onClick={() => navigate(`/dictation/${material.id}`)}
              >
                <PenLine size={14} /> 默写
              </button>
            </>
          ) : null}
          {material.status !== 'processing' ? (
            <button className="btn btn-small" onClick={() => void handleRetry()}>
              <RefreshCw size={14} /> 重新转写
            </button>
          ) : null}
        </div>
      </header>

      {material.status === 'processing' || material.status === 'error' ? (
        <div className="status-panel">
          <div className={`status-icon ${material.status}`}>
            {material.status === 'processing' ? (
              <Loader2 size={30} className="spin" />
            ) : (
              <AlertCircle size={30} />
            )}
          </div>
          <h2>{material.status === 'processing' ? '正在准备素材' : '处理失败'}</h2>
          <p className="status-stage">{material.stage || '处理中…'}</p>

          {material.status === 'processing' ? (
            <>
              <div className="progress-track large">
                <div className="progress-fill" style={{ width: `${Math.max(progressPercent, 3)}%` }} />
              </div>
              <p className="status-hint">
                首次使用会下载识别模型，可能需要几分钟。你可以先去素材库添加其他内容。
              </p>
            </>
          ) : (
            <>
              <p className="status-error">{material.error || '未知错误'}</p>
              <button className="btn btn-primary" onClick={() => void handleRetry()}>
                <RefreshCw size={16} /> 重试
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="player-workspace">
          <div className="player-left">
            <div className={`media-frame ${material.media_type}`} ref={frameRef}>
              {material.media_type === 'video' ? (
                <video
                  key={material.id}
                  className="media-video"
                  src={mediaUrl(material.id)}
                  ref={(element) => {
                    mediaRef.current = element
                  }}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onClick={togglePlay}
                  onError={() =>
                    setMediaError('无法播放这个文件，建议使用 MP4 / M4A / MP3 格式。')
                  }
                  playsInline
                />
              ) : (
                <div className="audio-stage">
                  <div className={`equalizer${playing ? ' active' : ''}`} aria-hidden="true">
                    {[0, 1, 2, 3, 4, 5, 6].map((bar) => (
                      <span key={bar} style={{ animationDelay: `${bar * 0.12}s` }} />
                    ))}
                  </div>
                  <Music2 size={34} />
                  <div className="audio-title">{material.title}</div>
                  <audio
                    key={material.id}
                    className="audio-element"
                    src={mediaUrl(material.id)}
                    ref={(element) => {
                      mediaRef.current = element
                    }}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                    onError={() =>
                      setMediaError('无法播放这个文件，建议使用 MP4 / M4A / MP3 格式。')
                    }
                  />
                </div>
              )}

              {!playing && !mediaError ? (
                <div className="media-play-overlay">
                  <Play size={34} />
                </div>
              ) : null}

              {showSubtitle && activeSentence ? (
                <div className="subtitle-overlay">{activeSentence.text}</div>
              ) : null}

              {mediaError ? <div className="media-error">{mediaError}</div> : null}
            </div>

            <div className="controls">
              <button className="play-button" onClick={togglePlay} title="播放 / 暂停">
                {playing ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button
                className="btn-icon"
                title="后退 5 秒"
                onClick={() => seekTo((mediaRef.current?.currentTime ?? 0) - 5)}
              >
                <Rewind size={17} />
              </button>
              <button
                className="btn-icon"
                title="前进 5 秒"
                onClick={() => seekTo((mediaRef.current?.currentTime ?? 0) + 5)}
              >
                <FastForward size={17} />
              </button>

              <span className="time-display">
                {formatDuration(currentTime)} / {formatDuration(displayDuration)}
              </span>

              <input
                className="seek-bar"
                type="range"
                min={0}
                max={displayDuration || 0}
                step={0.05}
                value={Math.min(currentTime, displayDuration || 0)}
                onChange={(event) => seekTo(Number(event.target.value))}
                disabled={!displayDuration}
                aria-label="播放进度"
              />

              <select
                className="speed-select"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                title="播放速度"
              >
                {SPEEDS.map((value) => (
                  <option key={value} value={value}>
                    {value}x
                  </option>
                ))}
              </select>

              <button
                className={`btn-icon${loopSentenceId ? ' active' : ''}`}
                title="循环当前句 (L)"
                onClick={toggleLoopActive}
              >
                <Repeat2 size={17} />
              </button>
              <button
                className={`btn-icon${showSubtitle ? ' active' : ''}`}
                title="字幕开关 (S)"
                onClick={() => setShowSubtitle((previous) => !previous)}
              >
                <Captions size={17} />
              </button>
              <button
                className={`btn-icon${showTranscript ? ' active' : ''}`}
                title={showTranscript ? '隐藏原文' : '显示原文'}
                onClick={() => setShowTranscript((previous) => !previous)}
              >
                {showTranscript ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
              </button>
              {material.media_type === 'video' ? (
                <button className="btn-icon" title="全屏" onClick={handleFullscreen}>
                  <Maximize2 size={17} />
                </button>
              ) : null}
            </div>

            {showTranscript ? (
              <section className="transcript-card">
                <header className="transcript-head">
                  <div>
                    <div className="eyebrow">TRANSCRIPT</div>
                    <h2>原文</h2>
                  </div>
                  <div className="transcript-tools">
                    {loopSentenceId ? (
                      <span className="loop-pill">
                        <Repeat2 size={12} /> 单句循环
                      </span>
                    ) : null}
                    <span className="transcript-hint">点单词查词 · 点句子跳转 · 可校对转写</span>
                  </div>
                </header>

                <div className="sentence-list">
                  {sentences.map((sentence) => (
                    <div
                      key={sentence.id}
                      ref={(element) => {
                        if (element) rowRefs.current.set(sentence.id, element)
                        else rowRefs.current.delete(sentence.id)
                      }}
                      className={`sentence-row${activeSentence?.id === sentence.id ? ' active' : ''}${
                        loopSentenceId === sentence.id ? ' looping' : ''
                      }${editingId === sentence.id ? ' editing' : ''}`}
                      onClick={() => selectSentence(sentence)}
                    >
                      <span className="sentence-time">{formatDuration(sentence.start)}</span>

                      <div className="sentence-body">
                        {editingId === sentence.id ? (
                          <div
                            className="sentence-editor"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <textarea
                              autoFocus
                              rows={2}
                              value={editDraft}
                              onChange={(event) => setEditDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  setEditingId(null)
                                } else if (event.key === 'Enter' && !event.shiftKey) {
                                  event.preventDefault()
                                  void saveEdit(sentence)
                                }
                              }}
                            />
                            <div className="editor-actions">
                              <button className="btn btn-small" onClick={() => setEditingId(null)}>
                                取消
                              </button>
                              <button
                                className="btn btn-small btn-primary"
                                onClick={() => void saveEdit(sentence)}
                              >
                                <Check size={14} /> 保存
                              </button>
                            </div>
                            <p className="editor-hint">Enter 保存 · Shift+Enter 换行 · Esc 取消</p>
                          </div>
                        ) : (
                          <p className="sentence-text">{renderTokens(sentence.text, sentence)}</p>
                        )}
                      </div>

                      <div className="sentence-actions">
                        {sentence.original_text && sentence.original_text !== sentence.text ? (
                          <span className="edited-badge" title={`原始转写：${sentence.original_text}`}>
                            已校对
                          </span>
                        ) : null}
                        <button
                          className="btn-icon"
                          title="循环这一句"
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleLoopSentence(sentence)
                          }}
                        >
                          <Repeat2 size={15} />
                        </button>
                        <button
                          className="btn-icon"
                          title="校对原文"
                          onClick={(event) => {
                            event.stopPropagation()
                            startEdit(sentence)
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <button className="transcript-collapsed" onClick={() => setShowTranscript(true)}>
                <PanelRightOpen size={16} /> 原文已隐藏，点击显示
              </button>
            )}
          </div>

          <aside className="player-side">
            <WordPanel
              word={selected?.word ?? null}
              entry={dictEntry}
              loading={dictLoading}
              added={added}
              adding={adding}
              onAdd={() => void handleAddWord()}
              onSpeak={() => {
                if (selected) speakWord(selected.word)
              }}
              onClose={() => setSelected(null)}
            />
          </aside>
        </div>
      )}
    </div>
  )
}
