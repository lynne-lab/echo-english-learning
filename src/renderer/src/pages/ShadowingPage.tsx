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
  ChevronLeft,
  ChevronRight,
  Cloud,
  Loader2,
  Mic,
  Play,
  Repeat2,
  Sparkles,
  Square,
  Trash2,
  Volume2
} from 'lucide-react'
import {
  api,
  recordingAudioUrl,
  sentenceClipUrl
} from '../api'
import { DiffedSentence, ErrorChips } from '../components/GradeDiff'
import { useToast } from '../components/Toast'
import Waveform from '../components/Waveform'
import type {
  Material,
  PronunciationFeedback,
  PronunciationProvider,
  Recording,
  RecordingFeedback,
  Sentence
} from '../types'
import { errorMessage, formatDate } from '../utils'

const ORIGINAL_COLOR = '#3987e5'
const USER_COLOR = '#d95926'

const ERROR_LABELS: Record<string, string> = {
  Mispronunciation: '发音错误',
  Omission: '漏读',
  Insertion: '多读'
}

const PROVIDER_LABELS: Record<PronunciationProvider, string> = {
  tencent: '腾讯云智聆',
  azure: 'Microsoft Azure'
}

const PROVIDER_SHORT: Record<PronunciationProvider, string> = {
  tencent: '腾讯云',
  azure: 'Azure'
}

function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(Math.round(value))
}

function scoreClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  if (value >= 80) return 'score-good'
  if (value >= 60) return 'score-fair'
  return 'score-weak'
}

function pronunciationOf(recording: Recording): PronunciationFeedback | null {
  return recording.pronunciation ?? recording.azure ?? null
}

function pronunciationSummary(recording: Recording): string {
  const result = pronunciationOf(recording)
  if (!result || result.pron_score === null) return ''
  const provider = result.provider === 'tencent' ? '腾讯云' : 'Azure'
  return ` · ${provider} ${Math.round(result.pron_score)}`
}

function computePeaks(buffer: AudioBuffer, buckets = 180): number[] {
  const channel = buffer.getChannelData(0)
  const block = Math.max(1, Math.floor(channel.length / buckets))
  const peaks: number[] = []
  let maxPeak = 0
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    let peak = 0
    const start = bucket * block
    const end = Math.min(channel.length, start + block)
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(channel[index])
      if (value > peak) peak = value
    }
    if (peak > maxPeak) maxPeak = peak
    peaks.push(peak)
  }
  return maxPeak > 0 ? peaks.map((peak) => peak / maxPeak) : peaks
}

function extensionForMime(mime: string): string {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

function rateLabel(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '语速 —'
  if (ratio < 0.85) return '语速偏慢'
  if (ratio > 1.2) return '语速偏快'
  return '语速接近原声'
}

export default function ShadowingPage(): ReactElement {
  const { id } = useParams<{ id: string }>()
  const { push } = useToast()

  const [material, setMaterial] = useState<Material | null>(null)
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [recordings, setRecordings] = useState<Recording[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [recordingState, setRecordingState] = useState<
    'idle' | 'recording' | 'uploading'
  >('idle')
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [analyzing, setAnalyzing] = useState(false)
  const [feedback, setFeedback] = useState<RecordingFeedback | null>(null)
  const [pronunciationResult, setPronunciationResult] =
    useState<PronunciationFeedback | null>(null)
  const [pronunciationScoring, setPronunciationScoring] = useState(false)
  const [pronunciationConfigured, setPronunciationConfigured] = useState(false)
  const [pronunciationProvider, setPronunciationProvider] =
    useState<PronunciationProvider | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)

  const [originalPeaks, setOriginalPeaks] = useState<number[] | null>(null)
  const [originalDuration, setOriginalDuration] = useState(0)
  const [originalWaveLoading, setOriginalWaveLoading] = useState(false)
  const [userPeaks, setUserPeaks] = useState<number[] | null>(null)
  const [userDuration, setUserDuration] = useState(0)
  const [userWaveLoading, setUserWaveLoading] = useState(false)

  const [originalPlaying, setOriginalPlaying] = useState(false)
  const [userPlaying, setUserPlaying] = useState(false)
  const [originalPlayhead, setOriginalPlayhead] = useState(0)
  const [userPlayhead, setUserPlayhead] = useState(0)

  const originalAudioRef = useRef<HTMLAudioElement | null>(null)
  const userAudioRef = useRef<HTMLAudioElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const abRef = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const waveCacheRef = useRef<
    Map<string, { peaks: number[]; duration: number }>
  >(new Map())
  const mimeRef = useRef('audio/webm')

  const currentSentence = sentences[index] ?? null
  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedId) ?? null,
    [recordings, selectedId]
  )
  const busy = recordingState !== 'idle' || analyzing || pronunciationScoring
  // The action button follows the configured provider; a stored result keeps
  // the provider that actually produced it.
  const actionProviderLabel = pronunciationProvider
    ? PROVIDER_LABELS[pronunciationProvider]
    : '在线'
  const actionProviderShort = pronunciationProvider
    ? PROVIDER_SHORT[pronunciationProvider]
    : '在线'
  const resultProvider = pronunciationResult?.provider ?? pronunciationProvider
  const resultProviderLabel = resultProvider
    ? PROVIDER_LABELS[resultProvider]
    : '在线'
  const resultProviderShort = resultProvider
    ? PROVIDER_SHORT[resultProvider]
    : '在线'
  const maxDuration = Math.max(originalDuration, userDuration, 0.1)

  useEffect(() => {
    api
      .settings()
      .then((settings) => {
        setPronunciationConfigured(settings.pronunciation_configured)
        setPronunciationProvider(settings.pronunciation_provider)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    Promise.all([
      api.material(id),
      api.sentences(id),
      api.progress('shadowing', id).catch(() => null)
    ])
      .then(([nextMaterial, nextSentences, saved]) => {
        if (cancelled) return
        setMaterial(nextMaterial)
        setSentences(nextSentences)
        const savedIndex = saved?.sentence_id
          ? nextSentences.findIndex(
              (sentence) => sentence.id === saved.sentence_id
            )
          : -1
        setIndex(savedIndex >= 0 ? savedIndex : 0)
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

  useEffect(() => {
    if (!material || !currentSentence) return
    void api
      .saveProgress(
        'shadowing',
        material.id,
        currentSentence.id,
        currentSentence.idx
      )
      .catch(() => undefined)
  }, [material?.id, currentSentence?.id])

  useEffect(() => {
    if (!currentSentence) {
      setRecordings([])
      setSelectedId(null)
      setFeedback(null)
      return
    }
    let cancelled = false
    setRecordings([])
    setSelectedId(null)
    setFeedback(null)
    setPronunciationResult(null)
    setMicError(null)
    setAudioError(null)
    api
      .recordings(currentSentence.id)
      .then((items) => {
        if (cancelled) return
        setRecordings(items)
        setSelectedId(items[0]?.id ?? null)
        setFeedback(items[0]?.feedback ?? null)
        setPronunciationResult(items[0] ? pronunciationOf(items[0]) : null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [currentSentence?.id])

  useEffect(() => {
    setOriginalPeaks(null)
    setOriginalDuration(0)
    setOriginalPlayhead(0)
    if (!currentSentence) return
    let cancelled = false
    setOriginalWaveLoading(true)
    const url = sentenceClipUrl(currentSentence.id)
    const load = async (): Promise<void> => {
      try {
        const cached = waveCacheRef.current.get(url)
        const value =
          cached ??
          (await (async () => {
            const response = await fetch(url)
            if (!response.ok) throw new Error('clip')
            const data = await response.arrayBuffer()
            if (!audioContextRef.current) {
              audioContextRef.current = new AudioContext()
            }
            const buffer = await audioContextRef.current.decodeAudioData(data)
            const decoded = {
              peaks: computePeaks(buffer),
              duration: buffer.duration
            }
            waveCacheRef.current.set(url, decoded)
            return decoded
          })())
        if (cancelled) return
        setOriginalPeaks(value.peaks)
        setOriginalDuration(value.duration)
      } catch {
        if (!cancelled) {
          setOriginalPeaks(null)
          setOriginalDuration(
            Math.max(0.1, currentSentence.end - currentSentence.start)
          )
        }
      } finally {
        if (!cancelled) setOriginalWaveLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [currentSentence?.id])

  useEffect(() => {
    setUserPeaks(null)
    setUserDuration(selectedRecording?.duration ?? 0)
    setUserPlayhead(0)
    if (!selectedRecording) return
    let cancelled = false
    setUserWaveLoading(true)
    const url = recordingAudioUrl(selectedRecording.id)
    const load = async (): Promise<void> => {
      try {
        const cached = waveCacheRef.current.get(url)
        const value =
          cached ??
          (await (async () => {
            const response = await fetch(url)
            if (!response.ok) throw new Error('recording')
            const data = await response.arrayBuffer()
            if (!audioContextRef.current) {
              audioContextRef.current = new AudioContext()
            }
            const buffer = await audioContextRef.current.decodeAudioData(data)
            const decoded = {
              peaks: computePeaks(buffer),
              duration: buffer.duration
            }
            waveCacheRef.current.set(url, decoded)
            return decoded
          })())
        if (cancelled) return
        setUserPeaks(value.peaks)
        setUserDuration(value.duration)
      } catch {
        if (!cancelled) setUserPeaks(null)
      } finally {
        if (!cancelled) setUserWaveLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [selectedRecording?.id, selectedRecording?.duration])

  useEffect(() => {
    const audio = originalAudioRef.current
    if (!audio) return
    audio.pause()
    abRef.current = false
    setOriginalPlaying(false)
    setOriginalPlayhead(0)
    if (!currentSentence) {
      audio.removeAttribute('src')
      audio.load()
      return
    }
    audio.src = sentenceClipUrl(currentSentence.id)
    audio.playbackRate = speed
    audio.load()
    // speed is applied by the separate effect; this only resets the clip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSentence?.id])

  useEffect(() => {
    const audio = userAudioRef.current
    if (!audio) return
    audio.pause()
    abRef.current = false
    setUserPlaying(false)
    setUserPlayhead(0)
    if (!selectedRecording) {
      audio.removeAttribute('src')
      audio.load()
      return
    }
    audio.src = recordingAudioUrl(selectedRecording.id)
    audio.playbackRate = speed
    audio.load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRecording?.id])

  useEffect(() => {
    if (originalAudioRef.current) originalAudioRef.current.playbackRate = speed
    if (userAudioRef.current) userAudioRef.current.playbackRate = speed
  }, [speed])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      const recorder = recorderRef.current
      if (recorder) {
        recorder.onstop = null
        try {
          if (recorder.state !== 'inactive') recorder.stop()
        } catch {
          /* ignore */
        }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      originalAudioRef.current?.pause()
      userAudioRef.current?.pause()
      void audioContextRef.current?.close()
    }
  }, [])

  const stopBoth = (): void => {
    originalAudioRef.current?.pause()
    userAudioRef.current?.pause()
    abRef.current = false
    setOriginalPlaying(false)
    setUserPlaying(false)
  }

  const playOriginal = (): void => {
    const audio = originalAudioRef.current
    if (!audio) return
    stopBoth()
    setAudioError(null)
    audio.currentTime = 0
    void audio
      .play()
      .then(() => setOriginalPlaying(true))
      .catch(() => setAudioError('无法播放原句音频'))
  }

  const playUser = (): void => {
    if (!selectedRecording) return
    const audio = userAudioRef.current
    if (!audio) return
    stopBoth()
    setAudioError(null)
    audio.currentTime = 0
    void audio
      .play()
      .then(() => setUserPlaying(true))
      .catch(() => setAudioError('无法播放你的录音'))
  }

  const playAB = (): void => {
    if (!selectedRecording) {
      playOriginal()
      return
    }
    const audio = originalAudioRef.current
    if (!audio) return
    stopBoth()
    setAudioError(null)
    abRef.current = true
    audio.currentTime = 0
    void audio
      .play()
      .then(() => setOriginalPlaying(true))
      .catch(() => {
        abRef.current = false
        setAudioError('无法播放原句音频')
      })
  }

  const handleOriginalEnded = (): void => {
    setOriginalPlaying(false)
    if (abRef.current && selectedRecording) {
      const audio = userAudioRef.current
      if (audio) {
        audio.currentTime = 0
        void audio
          .play()
          .then(() => setUserPlaying(true))
          .catch(() => {
            abRef.current = false
            setAudioError('无法播放你的录音')
          })
      }
    } else {
      abRef.current = false
    }
  }

  const stopRecording = (): void => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const finishRecording = async (): Promise<void> => {
    if (!material || !currentSentence) {
      setRecordingState('idle')
      return
    }
    const blob = new Blob(chunksRef.current, {
      type: mimeRef.current || 'audio/webm'
    })
    chunksRef.current = []
    setRecordingState('uploading')
    try {
      const form = new FormData()
      form.append('material_id', material.id)
      form.append('sentence_id', currentSentence.id)
      form.append(
        'file',
        blob,
        `shadowing.${extensionForMime(mimeRef.current)}`
      )
      const recording = await api.uploadRecording(form)
      setRecordings((previous) => [recording, ...previous])
      setSelectedId(recording.id)
      setFeedback(recording.feedback)
      setPronunciationResult(pronunciationOf(recording))
      push('跟读录音已保存', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    } finally {
      setRecordingState('idle')
    }
  }

  const startRecording = async (): Promise<void> => {
    if (busy || !material || !currentSentence) return
    setMicError(null)
    setAudioError(null)
    stopBoth()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true
      })
      streamRef.current = stream
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4'
      ]
      const mime =
        candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
      mimeRef.current = mime || 'audio/webm'
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        void finishRecording()
      }
      recorderRef.current = recorder
      recorder.start()
      setRecordingState('recording')
      setRecordSeconds(0)
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((seconds) => seconds + 1)
      }, 1000)
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setMicError(
        '无法访问麦克风。请在 Windows「设置 → 隐私和安全 → 麦克风」中允许桌面应用访问麦克风。'
      )
      push('麦克风不可用', 'error')
    }
  }

  const selectRecording = (recording: Recording): void => {
    if (busy) return
    stopBoth()
    setSelectedId(recording.id)
    setFeedback(recording.feedback)
    setPronunciationResult(pronunciationOf(recording))
    setAudioError(null)
  }

  const deleteRecording = async (recording: Recording): Promise<void> => {
    if (!window.confirm('删除这条跟读录音？')) return
    try {
      await api.deleteRecording(recording.id)
      const remaining = recordings.filter((item) => item.id !== recording.id)
      setRecordings(remaining)
      if (selectedId === recording.id) {
        const next = remaining[0] ?? null
        setSelectedId(next?.id ?? null)
        setFeedback(next?.feedback ?? null)
        setPronunciationResult(next ? pronunciationOf(next) : null)
      }
      push('已删除录音', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    }
  }

  const analyzeSelected = async (): Promise<void> => {
    if (!selectedRecording || busy) return
    setAnalyzing(true)
    try {
      const result = await api.analyzeRecording(selectedRecording.id)
      setFeedback(result)
      setRecordings((previous) =>
        previous.map((recording) =>
          recording.id === selectedRecording.id
            ? {
                ...recording,
                accuracy: result.accuracy,
                recognized_text: result.recognized_text,
                feedback: result
              }
            : recording
        )
      )
      push('本地评测完成', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    } finally {
      setAnalyzing(false)
    }
  }

  const scorePronunciation = async (): Promise<void> => {
    if (!selectedRecording || busy) return
    if (!pronunciationConfigured) {
      push('请先在设置页配置腾讯云智聆或 Azure 的评测凭据', 'info')
      return
    }
    const providerLabel = pronunciationProvider
      ? PROVIDER_LABELS[pronunciationProvider]
      : '所选服务'
    if (
      !window.confirm(
        `发音评分会把这条录音发送到 ${providerLabel} 云端，是否继续？`
      )
    ) {
      return
    }
    setPronunciationScoring(true)
    setAudioError(null)
    try {
      const result = await api.pronunciationScoreRecording(
        selectedRecording.id
      )
      setPronunciationResult(result)
      setRecordings((previous) =>
        previous.map((recording) =>
          recording.id === selectedRecording.id
            ? {
                ...recording,
                pronunciation: result,
                azure: result
              }
            : recording
        )
      )
      push('音素评分完成', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    } finally {
      setPronunciationScoring(false)
    }
  }

  const jumpToSentence = (target: number): void => {
    if (busy) return
    const next = Math.max(0, Math.min(sentences.length - 1, target))
    if (next !== index) {
      stopBoth()
      setIndex(next)
    }
  }

  const moveSentence = (delta: number): void => {
    jumpToSentence(index + delta)
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在准备跟读…
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
          <Link className="btn btn-primary" to="/library">
            返回素材库
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
          <h2>
            {material.status === 'processing' ? '素材还在转写中' : '素材暂时不可用'}
          </h2>
          <p className="status-stage">{material.stage || material.error || '请稍后再试'}</p>
          <Link className="btn" to={`/player/${material.id}`}>
            去精听页查看
          </Link>
        </div>
      </div>
    )
  }

  if (!currentSentence) {
    return (
      <div className="page">
        <div className="status-panel">
          <h2>这个素材还没有句子</h2>
          <p className="status-stage">完成转写后才能跟读。</p>
          <Link className="btn btn-primary" to={`/player/${material.id}`}>
            返回精听页
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page shadow-page">
      <header className="shadow-header">
        <Link to={`/player/${material.id}`} className="btn-icon" title="返回精听">
          <ArrowLeft size={19} />
        </Link>
        <div className="shadow-header-title">
          <div className="eyebrow">SHADOWING</div>
          <h1>{material.title}</h1>
          <div className="player-meta">
            <span>{material.media_type === 'video' ? '视频' : '音频'}</span>
            <span className="dot-separator">·</span>
            <span>
              第 {index + 1} / {sentences.length} 句
            </span>
          </div>
        </div>
        <div className="shadow-header-actions">
          <select
            className="sentence-jump"
            value={index}
            onChange={(event) => jumpToSentence(Number(event.target.value))}
            disabled={busy}
            title="跳到指定句子"
          >
            {sentences.map((sentence, sentenceIndex) => (
              <option key={sentence.id} value={sentenceIndex}>
                第 {sentenceIndex + 1} 句 · {sentence.text.slice(0, 40)}
              </option>
            ))}
          </select>
          <button
            className="btn-icon"
            title="上一句"
            onClick={() => moveSentence(-1)}
            disabled={busy || index === 0}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="btn-icon"
            title="下一句"
            onClick={() => moveSentence(1)}
            disabled={busy || index >= sentences.length - 1}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </header>

      <section className="shadow-sentence-card">
        <span className="shadow-kicker">CURRENT SENTENCE</span>
        <p className="shadow-sentence-text">{currentSentence.text}</p>
        <div className="shadow-sentence-meta">
          <span>
            {formatDurationLabel(currentSentence.start)} –{' '}
            {formatDurationLabel(currentSentence.end)}
          </span>
          <span className="dot-separator">·</span>
          <span>点麦克风录下你的跟读</span>
        </div>
      </section>

      {micError ? (
        <div className="shadow-mic-error">
          <AlertCircle size={16} />
          <span>{micError}</span>
        </div>
      ) : null}

      {audioError ? (
        <div className="shadow-mic-error">
          <AlertCircle size={16} />
          <span>{audioError}</span>
        </div>
      ) : null}

      <section className="shadow-practice-card">
        <div className="shadow-record-row">
          <button
            className={`record-button ${recordingState}`}
            onClick={() =>
              recordingState === 'recording'
                ? stopRecording()
                : void startRecording()
            }
            disabled={recordingState === 'uploading' || analyzing || pronunciationScoring}
            title={recordingState === 'recording' ? '停止录音' : '开始录音'}
          >
            {recordingState === 'uploading' ? (
              <Loader2 size={24} className="spin" />
            ) : recordingState === 'recording' ? (
              <Square size={20} />
            ) : (
              <Mic size={24} />
            )}
          </button>
          <div className="shadow-record-status">
            <strong>
              {recordingState === 'recording'
                ? `正在录音 ${formatClock(recordSeconds)}`
                : recordingState === 'uploading'
                  ? '正在保存录音…'
                  : '点击麦克风开始跟读'}
            </strong>
            <span>
              {recordingState === 'recording'
                ? '再点一次停止并保存'
                : '录完可以播放原声、录音或 A/B 连续对比'}
            </span>
          </div>
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

        <div className="shadow-waveforms">
          <div className="waveform-legend">
            <span>
              <i style={{ background: ORIGINAL_COLOR }} /> 原声
            </span>
            <span>
              <i style={{ background: USER_COLOR }} /> 我的录音
            </span>
            <span className="waveform-scale">同一时间轴对比</span>
          </div>
          <Waveform
            peaks={originalPeaks}
            duration={originalDuration}
            maxDuration={maxDuration}
            color={ORIGINAL_COLOR}
            label="原声"
            playhead={originalPlayhead}
            emptyText={originalWaveLoading ? '正在生成波形…' : '暂无波形'}
          />
          <Waveform
            peaks={userPeaks}
            duration={userDuration}
            maxDuration={maxDuration}
            color={USER_COLOR}
            label="我的录音"
            playhead={userPlayhead}
            emptyText={
              userWaveLoading
                ? '正在生成波形…'
                : selectedRecording
                  ? '无法读取波形'
                  : '录一段后显示'
            }
          />
        </div>

        <div className="shadow-play-controls">
          <button className="btn" onClick={playOriginal}>
            <Play size={15} /> 播放原声
          </button>
          <button
            className="btn"
            onClick={playUser}
            disabled={!selectedRecording}
          >
            <Volume2 size={15} /> 播放我的录音
          </button>
          <button
            className="btn btn-primary"
            onClick={playAB}
            disabled={!selectedRecording}
          >
            <Repeat2 size={15} /> A/B 对比
          </button>
          <button className="btn" onClick={stopBoth}>
            <Square size={14} /> 停止
          </button>
          <span className="shadow-play-state">
            {originalPlaying
              ? '正在播放原声…'
              : userPlaying
                ? '正在播放你的录音…'
                : 'A/B 会先播原声，再播你的录音'}
          </span>
        </div>
      </section>

      <div className="shadow-bottom-grid">
        <section className="panel shadow-recordings">
          <header className="section-head">
            <div>
              <h2>这句的录音</h2>
              <p>选一条录音来对比或评测，按时间倒序。</p>
            </div>
            <div className="section-actions">
              <button
                className="btn btn-small"
                onClick={() => void analyzeSelected()}
                disabled={!selectedRecording || busy}
              >
                {analyzing ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                {analyzing ? '识别中…' : '本地评测'}
              </button>
              {pronunciationConfigured ? (
                <button
                  className="btn btn-small"
                  onClick={() => void scorePronunciation()}
                  disabled={!selectedRecording || busy}
                >
                  {pronunciationScoring ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Cloud size={14} />
                  )}
                  {pronunciationScoring
                    ? `${actionProviderShort} 评分中…`
                    : `${actionProviderShort} 评分`}
                </button>
              ) : (
                <Link className="btn btn-small" to="/settings">
                  <Cloud size={14} /> 配置发音评测
                </Link>
              )}
            </div>
          </header>

          {recordings.length === 0 ? (
            <div className="shadow-empty">
              还没有录音。点击上面的麦克风，先录一遍试试。
            </div>
          ) : (
            <div className="recording-list">
              {recordings.map((recording) => (
                <div
                  key={recording.id}
                  className={`recording-row${
                    recording.id === selectedId ? ' selected' : ''
                  }`}
                  onClick={() => selectRecording(recording)}
                >
                  <span className="recording-dot" />
                  <div className="recording-info">
                    <strong>
                      {formatDate(recording.created_at)} ·{' '}
                      {recording.duration.toFixed(1)}s
                    </strong>
                    <span>
                      {recording.accuracy !== null
                        ? `识别准确率 ${Math.round(recording.accuracy * 100)}%`
                        : '未评测'}
                      {pronunciationSummary(recording)}
                      {recording.id === selectedId ? ' · 已选中' : ''}
                    </span>
                  </div>
                  <button
                    className="btn-icon danger-hover"
                    title="删除录音"
                    onClick={(event) => {
                      event.stopPropagation()
                      void deleteRecording(recording)
                    }}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel shadow-feedback-card">
          <header className="section-head">
            <div>
              <h2>本地评测</h2>
              <p>基于本地 Whisper 转写，不是音素级发音评分。</p>
            </div>
          </header>

          {feedback ? (
            <div className="shadow-feedback">
              <div className="shadow-feedback-head">
                <div className="grade-score">
                  <span>{Math.round(feedback.accuracy * 100)}%</span>
                  <small>识别准确率</small>
                </div>
                <div className="shadow-feedback-summary">
                  <h3>
                    {feedback.accuracy >= 0.95
                      ? '识别得很清楚'
                      : feedback.accuracy >= 0.75
                        ? '大部分能识别'
                        : '再试一次，放慢一点'}
                  </h3>
                  <p>
                    原句 {feedback.target_duration.toFixed(1)}s · 录音{' '}
                    {feedback.recording_duration.toFixed(1)}s ·{' '}
                    {rateLabel(feedback.rate_ratio)}
                  </p>
                </div>
                <ErrorChips errors={feedback.errors} />
              </div>

              <div className="shadow-recognized">
                <span className="diff-label">识别结果</span>
                <p>{feedback.recognized_text || '（没有识别到语音）'}</p>
              </div>

              <div className="diff-block">
                <span className="diff-label">原文对照</span>
                <DiffedSentence
                  text={currentSentence.text}
                  tokens={feedback.tokens}
                />
              </div>
            </div>
          ) : (
            <div className="shadow-empty">
              {selectedRecording
                ? '选中的录音还没有评测。点击「本地评测」让 Whisper 听一遍。'
                : '录一段并选中后，可以做本地评测。'}
            </div>
          )}
        </section>
      </div>

      <section className="panel azure-score-card">
        <header className="section-head">
          <div>
            <h2>音素级发音评分</h2>
            <p>
              {pronunciationConfigured
                ? `可选 · 录音会上传到 ${actionProviderLabel} 云端`
                : '可选 · 需要先在设置页配置评测服务'}
            </p>
          </div>
          {pronunciationResult ? (
            <span className="azure-badge">
              {resultProvider === 'azure' ? 'AZURE' : 'TENCENT'}
            </span>
          ) : (
            <Link className="btn btn-small" to="/settings">
              <Cloud size={14} /> 配置发音评测
            </Link>
          )}
        </header>

        {pronunciationScoring ? (
          <div className="azure-loading">
            <Loader2 size={18} className="spin" /> 正在请求{' '}
            {actionProviderLabel} 发音评估…
          </div>
        ) : pronunciationResult ? (
          <div className="azure-result">
            <div className="azure-hero">
              <div className="azure-main-score">
                <span>{formatScore(pronunciationResult.pron_score)}</span>
                <small>综合发音</small>
              </div>
              <div className="azure-sub-scores">
                {(
                  [
                    { label: '准确度', value: pronunciationResult.accuracy_score },
                    { label: '流利度', value: pronunciationResult.fluency_score },
                    { label: '完整度', value: pronunciationResult.completeness_score },
                    ...(pronunciationResult.prosody_score !== null
                      ? [{ label: '韵律', value: pronunciationResult.prosody_score }]
                      : [])
                  ] as Array<{ label: string; value: number | null }>
                ).map((item) => (
                  <div className="azure-sub-score" key={item.label}>
                    <span className={scoreClass(item.value)}>
                      {formatScore(item.value)}
                    </span>
                    <small>{item.label}</small>
                  </div>
                ))}
              </div>
            </div>

            <p className="azure-recognized">
              <span className="diff-label">{resultProviderLabel} 识别</span>
              {pronunciationResult.recognized_text || '—'}
            </p>

            {pronunciationResult.words.length > 0 ? (
              <div className="azure-words">
                {pronunciationResult.words.map((word, index) => (
                  <details
                    className={`azure-word ${scoreClass(word.accuracy)}`}
                    key={`${word.word}-${index}`}
                  >
                    <summary>
                      <span className="azure-word-text">{word.word}</span>
                      <span className="azure-word-score">
                        {formatScore(word.accuracy)}
                      </span>
                    </summary>
                    <div className="azure-word-body">
                      {word.error_type && word.error_type !== 'None' ? (
                        <span className="azure-error-tag">
                          {ERROR_LABELS[word.error_type] ?? word.error_type}
                        </span>
                      ) : null}
                      {word.phonemes.length > 0 ? (
                        <div className="azure-phonemes">
                          {word.phonemes.map((phoneme, phonemeIndex) => (
                            <span
                              className={`phoneme-chip ${scoreClass(
                                phoneme.score
                              )}`}
                              key={`${phoneme.phoneme}-${phonemeIndex}`}
                            >
                              <span>{phoneme.phoneme || '?'}</span>
                              <b>{formatScore(phoneme.score)}</b>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="azure-no-phonemes">
                          {resultProviderShort} 没有返回这个单词的音素明细。
                        </p>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="azure-no-phonemes">
                {resultProviderShort} 没有返回词级明细。
              </p>
            )}

            <p className="azure-note">
              {resultProvider === 'azure'
                ? `评分来自 Microsoft Azure · 区域 ${pronunciationResult.region} · ${formatDate(pronunciationResult.scored_at)}`
                : `评分来自腾讯云智聆 · ${formatDate(pronunciationResult.scored_at)}`}
            </p>
          </div>
        ) : (
          <div className="shadow-empty">
            选中一条录音，点击上方「{actionProviderShort} 评分」查看音素级结果。
            {pronunciationConfigured
              ? ''
              : '需要先在设置页配置腾讯云智聆或 Azure 的评测凭据。'}
          </div>
        )}
      </section>

      <audio
        ref={originalAudioRef}
        className="audio-element"
        onTimeUpdate={() => {
          const audio = originalAudioRef.current
          if (audio) setOriginalPlayhead(audio.currentTime)
        }}
        onEnded={handleOriginalEnded}
        onError={() => setAudioError('无法加载原句音频，请检查素材文件。')}
      />
      <audio
        ref={userAudioRef}
        className="audio-element"
        onTimeUpdate={() => {
          const audio = userAudioRef.current
          if (audio) setUserPlayhead(audio.currentTime)
        }}
        onEnded={() => {
          abRef.current = false
          setUserPlaying(false)
        }}
        onError={() => setAudioError('无法加载你的录音。')}
      />
    </div>
  )
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${minutes}:${String(remaining).padStart(2, '0')}`
}

function formatDurationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
