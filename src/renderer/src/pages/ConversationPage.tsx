import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  Mic,
  Pause,
  RefreshCw,
  Square,
  Trash2,
  Volume2,
  Wand2
} from 'lucide-react'
import { api } from '../api'
import { useToast } from '../components/Toast'
import type { Conversation, ConversationTurn, DrillResult } from '../types'
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

const LEVEL_LABELS: Record<string, string> = {
  beginner: '初级',
  intermediate: '中级',
  advanced: '高级'
}

function extensionForMime(mime: string): string {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

export default function ConversationPage(): ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { push } = useToast()

  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [hintPrompt, setHintPrompt] = useState(false)
  const [hintSuppressed, setHintSuppressed] = useState(false)
  const [hintBusy, setHintBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [ttsFallback, setTtsFallback] = useState(false)
  const [expandedDrill, setExpandedDrill] = useState<number | null>(null)
  const [drillRecording, setDrillRecording] = useState<number | null>(null)
  const [drillBusy, setDrillBusy] = useState<number | null>(null)
  const [drillSeconds, setDrillSeconds] = useState(0)
  const [drillResults, setDrillResults] = useState<Record<number, DrillResult>>({})
  const [drillErrors, setDrillErrors] = useState<Record<number, string>>({})

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef('audio/webm')
  const timerRef = useRef<number | null>(null)
  const vadRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const startedAtRef = useRef(0)
  const lastSoundRef = useRef(0)
  const spokeRef = useRef(false)
  const cancelRef = useRef(false)

  const drillRecorderRef = useRef<MediaRecorder | null>(null)
  const drillStreamRef = useRef<MediaStream | null>(null)
  const drillChunksRef = useRef<Blob[]>([])
  const drillMimeRef = useRef('audio/webm')
  const drillTimerRef = useRef<number | null>(null)
  const drillAutoStopRef = useRef<number | null>(null)
  const drillSentenceRef = useRef('')
  const lastSpokenTextRef = useRef('')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setConversation(null)
    setError(null)
    setHintPrompt(false)
    setHintSuppressed(false)
    setPlayingId(null)
    setDrillResults({})
    setExpandedDrill(null)
    api
      .conversation(id)
      .then((data) => {
        if (!cancelled) setConversation(data)
      })
      .catch((loadFailure) => {
        if (!cancelled) setLoadError(errorMessage(loadFailure))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [conversation?.turns.length, uploading, hintPrompt])

  const autoSpokenRef = useRef<string | null>(null)

  useEffect(() => {
    if (!conversation || conversation.status !== 'active') return
    if (autoSpokenRef.current === conversation.id) return
    const last = [...conversation.turns]
      .reverse()
      .find((turn) => turn.role === 'assistant')
    if (!last) return
    const timer = window.setTimeout(() => {
      autoSpokenRef.current = conversation.id
      playTurn(last)
    }, 450)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, conversation?.status])

  useEffect(() => {
    if (!conversation || conversation.status !== 'active') return
    if (recording || uploading || hintPrompt || hintSuppressed || finishing) return
    const timer = window.setTimeout(() => setHintPrompt(true), 20000)
    return () => window.clearTimeout(timer)
  }, [
    conversation?.turns.length,
    conversation?.status,
    recording,
    uploading,
    hintPrompt,
    hintSuppressed,
    finishing
  ])

  useEffect(() => {
    return () => {
      stopAllAudio()
      closeMainRecorder(true)
      closeDrillRecorder(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopAllAudio(): void {
    lastSpokenTextRef.current = ''
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    try {
      window.speechSynthesis?.cancel()
    } catch {
      /* ignore */
    }
    setPlayingId(null)
  }

  function fallbackSpeak(text: string): void {
    try {
      if (!('speechSynthesis' in window) || !text.trim()) return
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'en-US'
      utterance.rate = 0.95
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
      setTtsFallback(true)
    } catch {
      push('语音朗读失败', 'error')
    }
  }

  function playTurn(turn: ConversationTurn): void {
    if (!conversation) return
    const audio = audioRef.current
    if (!audio) return
    if (playingId === turn.id) {
      audio.pause()
      setPlayingId(null)
      return
    }
    try {
      window.speechSynthesis?.cancel()
    } catch {
      /* ignore */
    }
    lastSpokenTextRef.current = turn.role === 'user' ? '' : turn.text
    audio.src = api.conversationTurnAudioUrl(conversation.id, turn.id)
    void audio
      .play()
      .then(() => setPlayingId(turn.id))
      .catch(() => {
        setPlayingId(null)
        if (turn.role !== 'user') fallbackSpeak(turn.text)
      })
  }

  function playDemo(index: number, sentence: string): void {
    if (!conversation) return
    const audio = audioRef.current
    if (!audio) return
    const key = `demo-${index}`
    if (playingId === key) {
      audio.pause()
      setPlayingId(null)
      return
    }
    try {
      window.speechSynthesis?.cancel()
    } catch {
      /* ignore */
    }
    lastSpokenTextRef.current = sentence
    audio.src = api.conversationTtsUrl(conversation.id, sentence)
    void audio
      .play()
      .then(() => setPlayingId(key))
      .catch(() => {
        setPlayingId(null)
        fallbackSpeak(sentence)
      })
  }

  async function uploadTurn(blob: Blob, mime: string): Promise<void> {
    if (!conversation || !id) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', blob, `turn.${extensionForMime(mime)}`)
      const result = await api.conversationTurn(id, form)
      setConversation((previous) =>
        previous
          ? {
              ...previous,
              turns: [...previous.turns, result.user_turn, result.assistant_turn]
            }
          : previous
      )
      setHintPrompt(false)
      setHintSuppressed(false)
      playTurn(result.assistant_turn)
    } catch (uploadError) {
      const message = errorMessage(uploadError)
      setError(message)
      push(message, 'error')
    } finally {
      setUploading(false)
    }
  }

  function closeMainRecorder(cancel: boolean): void {
    if (cancel) cancelRef.current = true
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (vadRef.current) {
      window.clearInterval(vadRef.current)
      vadRef.current = null
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined)
      audioContextRef.current = null
    }
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    setRecording(false)
  }

  function stopRecording(): void {
    closeMainRecorder(false)
  }

  async function startRecording(): Promise<void> {
    if (!conversation || conversation.status !== 'active' || recording || uploading) {
      return
    }
    setError(null)
    stopAllAudio()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      const mime =
        candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
      mimeRef.current = mime || 'audio/webm'
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      cancelRef.current = false
      spokeRef.current = false
      startedAtRef.current = Date.now()
      lastSoundRef.current = Date.now()
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const cancelled = cancelRef.current
        cancelRef.current = false
        const captured = new Blob(chunksRef.current, {
          type: mimeRef.current || 'audio/webm'
        })
        chunksRef.current = []
        if (cancelled || captured.size < 1200) return
        void uploadTurn(captured, mimeRef.current)
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setRecordSeconds(0)
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((value) => value + 1)
      }, 1000)

      const context = new AudioContext()
      audioContextRef.current = context
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      vadRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i += 1) {
          const value = (data[i] - 128) / 128
          sum += value * value
        }
        const rms = Math.sqrt(sum / data.length)
        const now = Date.now()
        if (rms > 0.02) {
          spokeRef.current = true
          lastSoundRef.current = now
        }
        const elapsed = (now - startedAtRef.current) / 1000
        if (spokeRef.current && now - lastSoundRef.current > 1600 && elapsed > 0.8) {
          stopRecording()
        } else if (!spokeRef.current && elapsed > 8) {
          // Still send quiet speech to Whisper instead of discarding it.
          stopRecording()
        } else if (elapsed > 55) {
          stopRecording()
        }
      }, 120)
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setRecording(false)
      push('无法访问麦克风，请在 Windows 隐私设置里允许桌面应用使用麦克风', 'error')
    }
  }

  async function requestHint(): Promise<void> {
    if (!conversation || hintBusy) return
    setHintBusy(true)
    try {
      const { hint } = await api.conversationHint(conversation.id)
      setConversation((previous) =>
        previous ? { ...previous, turns: [...previous.turns, hint] } : previous
      )
      setHintPrompt(false)
      setHintSuppressed(true)
      playTurn(hint)
    } catch (hintError) {
      push(errorMessage(hintError), 'error')
    } finally {
      setHintBusy(false)
    }
  }

  async function finish(): Promise<void> {
    if (!conversation || finishing) return
    if (!window.confirm('结束这次对话并生成复盘？')) return
    stopAllAudio()
    if (recording) closeMainRecorder(false)
    setFinishing(true)
    try {
      const finished = await api.finishConversation(conversation.id)
      setConversation(finished)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (finishError) {
      push(errorMessage(finishError), 'error')
    } finally {
      setFinishing(false)
    }
  }

  async function removeConversation(): Promise<void> {
    if (!conversation) return
    if (!window.confirm('删除这次对话？对话原文、录音和复盘都会删除。')) return
    try {
      stopAllAudio()
      await api.deleteConversation(conversation.id)
      navigate('/talk')
    } catch (removeError) {
      push(errorMessage(removeError), 'error')
    }
  }

  function closeDrillRecorder(cancel: boolean): void {
    if (drillTimerRef.current) {
      window.clearInterval(drillTimerRef.current)
      drillTimerRef.current = null
    }
    if (drillAutoStopRef.current) {
      window.clearTimeout(drillAutoStopRef.current)
      drillAutoStopRef.current = null
    }
    const recorder = drillRecorderRef.current
    if (recorder) {
      if (cancel) {
        recorder.onstop = null
      }
      if (recorder.state !== 'inactive') recorder.stop()
    }
    drillStreamRef.current?.getTracks().forEach((track) => track.stop())
    drillStreamRef.current = null
    drillRecorderRef.current = null
    setDrillRecording(null)
  }

  async function startDrillRecording(index: number, sentence: string): Promise<void> {
    if (drillRecording !== null || drillBusy !== null) return
    stopAllAudio()
    setExpandedDrill(index)
    setDrillErrors((previous) => ({ ...previous, [index]: '' }))
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      drillStreamRef.current = stream
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      const mime =
        candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
      drillMimeRef.current = mime || 'audio/webm'
      drillSentenceRef.current = sentence
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      drillChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) drillChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(drillChunksRef.current, {
          type: drillMimeRef.current || 'audio/webm'
        })
        drillChunksRef.current = []
        if (blob.size < 1200) return
        void scoreDrill(index, sentence, blob)
      }
      drillRecorderRef.current = recorder
      recorder.start()
      setDrillRecording(index)
      setDrillSeconds(0)
      drillTimerRef.current = window.setInterval(() => {
        setDrillSeconds((value) => value + 1)
      }, 1000)
      drillAutoStopRef.current = window.setTimeout(() => stopDrillRecording(), 30000)
    } catch {
      drillStreamRef.current?.getTracks().forEach((track) => track.stop())
      drillStreamRef.current = null
      setDrillRecording(null)
      push('无法访问麦克风，请在 Windows 隐私设置里允许桌面应用使用麦克风', 'error')
    }
  }

  function stopDrillRecording(): void {
    closeDrillRecorder(false)
  }

  async function scoreDrill(
    index: number,
    sentence: string,
    blob: Blob
  ): Promise<void> {
    if (!conversation || !id) return
    setDrillBusy(index)
    setDrillErrors((previous) => ({ ...previous, [index]: '' }))
    try {
      const form = new FormData()
      form.append('ref_text', sentence)
      form.append('file', blob, `drill.${extensionForMime(drillMimeRef.current)}`)
      const result = await api.conversationDrill(id, form)
      setDrillResults((previous) => ({ ...previous, [index]: result }))
    } catch (drillError) {
      setDrillErrors((previous) => ({
        ...previous,
        [index]: errorMessage(drillError)
      }))
    } finally {
      setDrillBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在读取对话…
        </div>
      </div>
    )
  }

  if (loadError || !conversation) {
    return (
      <div className="page">
        <div className="status-panel">
          <h2>找不到这次对话</h2>
          <p className="status-error">{loadError || '对话可能已经被删除。'}</p>
          <Link className="btn btn-primary" to="/talk">
            返回口语对话
          </Link>
        </div>
      </div>
    )
  }

  const active = conversation.status === 'active'
  const hintsUsed = conversation.turns.filter((turn) => turn.role === 'hint').length
  const practice = Array.isArray(conversation.report?.practice_sentences)
    ? conversation.report.practice_sentences
    : []

  return (
    <div className="page talk-page">
      <header className="talk-header">
        <Link to="/talk" className="btn-icon" title="返回口语对话">
          <ArrowLeft size={19} />
        </Link>
        <div className="talk-header-title">
          <div className="eyebrow">{active ? 'CONVERSATION' : 'CONVERSATION REVIEW'}</div>
          <h1>{active ? conversation.scenario_title : '对话复盘'}</h1>
          <div className="player-meta">
            <span>{conversation.scenario_title}</span>
            <span className="dot-separator">·</span>
            <span>{LEVEL_LABELS[conversation.level] ?? conversation.level}</span>
            <span className="dot-separator">·</span>
            <span>{formatDate(conversation.created_at)}</span>
            {hintsUsed > 0 ? (
              <>
                <span className="dot-separator">·</span>
                <span>使用提示 {hintsUsed} 次</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="talk-header-actions">
          {active ? (
            <button
              className="btn btn-small btn-primary"
              onClick={() => void finish()}
              disabled={finishing || recording || uploading}
            >
              {finishing ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
              {finishing ? '生成复盘中…' : '结束并复盘'}
            </button>
          ) : (
            <button
              className="btn btn-small"
              onClick={() => {
                void api
                  .createConversation(
                    conversation.scenario,
                    conversation.level,
                    conversation.voice
                  )
                  .then((created) => navigate(`/talk/${created.id}`))
                  .catch((restartError) => push(errorMessage(restartError), 'error'))
              }}
            >
              <RefreshCw size={14} /> 再练一次
            </button>
          )}
          <button
            className="btn-icon danger-hover"
            title="删除这次对话"
            onClick={() => void removeConversation()}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="review-notice error">
          <AlertCircle size={16} />
          <div>
            <strong>这一句没有发出去</strong>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {ttsFallback ? (
        <div className="review-notice">
          <AlertCircle size={16} />
          <div>
            <p>AI 神经网络语音暂时不可用，已改用系统语音朗读。</p>
          </div>
        </div>
      ) : null}

      {active ? (
        <>
          <section className="panel talk-chat-panel">
            <div className="talk-messages">
              {conversation.turns.map((turn) => (
                <div className={`talk-msg ${turn.role}`} key={turn.id}>
                  {turn.role !== 'user' ? (
                    <div className="talk-msg-avatar">
                      {turn.role === 'assistant' ? 'Echo' : '提示'}
                    </div>
                  ) : null}
                  <div className="talk-msg-body">
                    <div className="talk-bubble">
                      <p>{turn.text}</p>
                      {turn.role === 'hint' && turn.meta.chinese ? (
                        <p className="talk-hint-translation">{turn.meta.chinese}</p>
                      ) : null}
                    </div>
                    <div className="talk-msg-actions">
                      <button
                        className="talk-play"
                        onClick={() => playTurn(turn)}
                        title={playingId === turn.id ? '暂停' : '播放'}
                      >
                        {playingId === turn.id ? (
                          <Pause size={13} />
                        ) : (
                          <Volume2 size={13} />
                        )}
                        {playingId === turn.id ? '暂停' : '播放'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {uploading ? (
                <div className="talk-msg assistant">
                  <div className="talk-msg-avatar">Echo</div>
                  <div className="talk-msg-body">
                    <div className="talk-bubble talk-thinking">
                      <span className="pulse-dot" /> 正在听你说的内容，并想下一句…
                    </div>
                  </div>
                </div>
              ) : null}

              {hintPrompt && !uploading ? (
                <div className="talk-msg hint-prompt">
                  <div className="talk-msg-avatar">Echo</div>
                  <div className="talk-msg-body">
                    <div className="talk-bubble">
                      <p>需要我提示一种说法吗？</p>
                      <div className="talk-hint-actions">
                        <button
                          className="btn btn-small btn-primary"
                          onClick={() => void requestHint()}
                          disabled={hintBusy}
                        >
                          {hintBusy ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <Wand2 size={14} />
                          )}
                          {hintBusy ? '正在想提示…' : '给点提示'}
                        </button>
                        <button
                          className="btn btn-small"
                          onClick={() => {
                            setHintPrompt(false)
                            setHintSuppressed(true)
                          }}
                        >
                          先不用
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div ref={messagesEndRef} />
            </div>
          </section>

          <section className="panel talk-composer">
            <button
              className={`talk-mic${recording ? ' recording' : ''}`}
              onClick={() =>
                recording ? stopRecording() : void startRecording()
              }
              disabled={uploading}
              title={recording ? '结束录音' : '开始说话'}
            >
              {recording ? <Square size={22} /> : <Mic size={24} />}
            </button>
            <div className="talk-composer-info">
              <strong>
                {recording
                  ? `正在录音 ${recordSeconds} 秒`
                  : uploading
                    ? '正在识别并思考…'
                    : '点击麦克风，开始说英语'}
              </strong>
              <p>
                {recording
                  ? '停顿约 1.5 秒会自动结束；也可以再点一次立即结束。'
                  : 'AI 会等你开口；长时间没说话时，它会问要不要给提示。'}
              </p>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="panel talk-report">
            <div className="review-markdown">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {conversation.report_markdown || '复盘内容为空。'}
              </Markdown>
            </div>
          </section>

          {practice.length > 0 ? (
            <section className="panel talk-drill-panel">
              <header className="section-head">
                <div>
                  <h2>跟读纠音练习</h2>
                  <p>
                    先听 AI 示范，再跟读；使用腾讯云智聆或 Azure 评分，AI 会针对发音给出纠正建议。
                  </p>
                </div>
              </header>
              <div className="talk-drill-list">
                {practice.map((item, index) => {
                  const sentence = (item.sentence ?? '').trim()
                  const focus = (item.focus ?? '').trim()
                  if (!sentence) return null
                  const result = drillResults[index]
                  return (
                    <div className="talk-drill-row" key={`${sentence}-${index}`}>
                      <div className="talk-drill-main">
                        <p className="talk-drill-sentence">{sentence}</p>
                        {focus ? <p className="hint">{focus}</p> : null}
                      </div>
                      <div className="talk-drill-actions">
                        <button
                          className="btn btn-small"
                          onClick={() => playDemo(index, sentence)}
                        >
                          {playingId === `demo-${index}` ? (
                            <Pause size={14} />
                          ) : (
                            <Volume2 size={14} />
                          )}
                          {playingId === `demo-${index}` ? '暂停' : '听示范'}
                        </button>
                        <button
                          className="btn btn-small btn-primary"
                          onClick={() => {
                            if (expandedDrill === index) {
                              if (drillRecording === index) closeDrillRecorder(true)
                              setExpandedDrill(null)
                            } else {
                              setExpandedDrill(index)
                            }
                          }}
                        >
                          {expandedDrill === index
                            ? '收起'
                            : result
                              ? '再练一次'
                              : '跟读练习'}
                        </button>
                      </div>

                      {expandedDrill === index ? (
                        <div className="talk-drill-record">
                          <button
                            className={`talk-mic drill${drillRecording === index ? ' recording' : ''}`}
                            onClick={() =>
                              drillRecording === index
                                ? stopDrillRecording()
                                : void startDrillRecording(index, sentence)
                            }
                            disabled={drillBusy === index}
                            title={drillRecording === index ? '结束录音' : '开始录音'}
                          >
                            {drillRecording === index ? (
                              <Square size={18} />
                            ) : (
                              <Mic size={18} />
                            )}
                          </button>
                          <span>
                            {drillBusy === index
                              ? '正在评分…'
                              : drillRecording === index
                                ? `正在录音 ${drillSeconds}s，读完点一下结束`
                                : result
                                  ? '再读一次，覆盖上次评分'
                                  : '点麦克风开始跟读'}
                          </span>
                        </div>
                      ) : null}

                      {expandedDrill === index && result ? (
                        <div className="talk-drill-result">
                          <div className="talk-score-row">
                            {[
                              ['综合', result.summary.overall],
                              ['准确度', result.summary.accuracy],
                              ['流利度', result.summary.fluency],
                              ['完整度', result.summary.integrity]
                            ].map(([label, value]) => (
                              <div className="talk-score" key={String(label)}>
                                <strong>
                                  {typeof value === 'number' ? Math.round(value) : '—'}
                                </strong>
                                <span>{label}</span>
                              </div>
                            ))}
                          </div>
                          {result.summary.weak_words.length > 0 ? (
                            <p className="talk-weak">
                              需要加强：
                              {result.summary.weak_words.map((word, wordIndex) => (
                                <span className="talk-weak-chip" key={wordIndex}>
                                  {word.word}
                                  {typeof word.accuracy === 'number'
                                    ? ` ${Math.round(word.accuracy)}`
                                    : ''}
                                </span>
                              ))}
                            </p>
                          ) : null}
                          {result.summary.weak_phonemes.length > 0 ? (
                            <p className="talk-weak">
                              音素：
                              {result.summary.weak_phonemes.map(
                                (phoneme, phonemeIndex) => (
                                  <span
                                    className="talk-weak-chip"
                                    key={phonemeIndex}
                                  >
                                    /{phoneme.phoneme}/ {Math.round(phoneme.score ?? 0)}
                                  </span>
                                )
                              )}
                            </p>
                          ) : null}
                          {result.ai_tip ? (
                            <p className="talk-drill-tip">
                              <Wand2 size={14} /> {result.ai_tip}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {drillErrors[index] ? (
                        <p className="status-error talk-drill-error">
                          {drillErrors[index]}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          <details className="panel talk-transcript">
            <summary>查看对话原文</summary>
            <div className="talk-transcript-list">
              {conversation.turns.map((turn) => (
                <div className={`talk-transcript-row ${turn.role}`} key={turn.id}>
                  <span className="talk-transcript-role">
                    {turn.role === 'user'
                      ? '你'
                      : turn.role === 'assistant'
                        ? 'Echo'
                        : '提示'}
                  </span>
                  <p>
                    {turn.text}
                    {turn.role === 'hint' && turn.meta.chinese ? (
                      <span className="talk-transcript-note">
                        {' '}
                        （{turn.meta.chinese}）
                      </span>
                    ) : null}
                  </p>
                </div>
              ))}
            </div>
          </details>
        </>
      )}

      <audio
        ref={audioRef}
        className="audio-element"
        onEnded={() => setPlayingId(null)}
        onError={() => {
          setPlayingId(null)
          if (lastSpokenTextRef.current) {
            fallbackSpeak(lastSpokenTextRef.current)
          }
        }}
      />
    </div>
  )
}
