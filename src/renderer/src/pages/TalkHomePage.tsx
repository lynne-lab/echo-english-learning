import { useEffect, useState, type ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AudioLines,
  ChevronRight,
  Loader2,
  MessageCircle,
  Mic,
  Sparkles,
  Trash2
} from 'lucide-react'
import { api } from '../api'
import { useToast } from '../components/Toast'
import type {
  ConversationSummary,
  TalkLevel,
  TalkMeta,
  TalkScenario,
  TalkVoice
} from '../types'
import { errorMessage, formatDate } from '../utils'

export default function TalkHomePage(): ReactElement {
  const navigate = useNavigate()
  const { push } = useToast()
  const [meta, setMeta] = useState<TalkMeta | null>(null)
  const [history, setHistory] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scenario, setScenario] = useState('daily')
  const [level, setLevel] = useState('intermediate')
  const [voice, setVoice] = useState('en-US-AriaNeural')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([api.talkMeta(), api.conversations()])
      .then(([nextMeta, nextHistory]) => {
        if (cancelled) return
        setMeta(nextMeta)
        setHistory(nextHistory)
        if (nextMeta.voices[0]) setVoice(nextMeta.voices[0].id)
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
  }, [])

  const start = async (): Promise<void> => {
    if (starting) return
    setStarting(true)
    try {
      const conversation = await api.createConversation(scenario, level, voice)
      navigate(`/talk/${conversation.id}`)
    } catch (startError) {
      push(errorMessage(startError), 'error')
    } finally {
      setStarting(false)
    }
  }

  const remove = async (item: ConversationSummary): Promise<void> => {
    if (!window.confirm(`删除与「${item.scenario_title}」的这次对话？录音和复盘都会删除。`)) {
      return
    }
    try {
      await api.deleteConversation(item.id)
      setHistory((previous) => previous.filter((entry) => entry.id !== item.id))
      push('已删除对话记录', 'success')
    } catch (removeError) {
      push(errorMessage(removeError), 'error')
    }
  }

  const levelLabel = (id: string): string =>
    meta?.levels.find((item) => item.id === id)?.label ?? id

  return (
    <div className="page talk-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">SPEAKING</div>
          <h1>口语对话</h1>
          <p className="page-subtitle">
            和 AI 用英语聊一个真实场景。它会等你开口、在你卡住时提示，结束后给出语法、表达和发音建议。
          </p>
        </div>
      </header>

      {loading ? (
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在准备对话…
        </div>
      ) : error ? (
        <div className="status-panel">
          <h2>加载失败</h2>
          <p className="status-error">{error}</p>
        </div>
      ) : meta && !meta.llm_configured ? (
        <div className="review-notice">
          <Sparkles size={16} />
          <div>
            <strong>还没有配置 AI 对话服务</strong>
            <p>
              在设置页填写 Base URL、API Key 和模型后，就能开始口语对话和复盘。
            </p>
          </div>
          <Link className="btn btn-small" to="/settings">
            去设置
          </Link>
        </div>
      ) : meta ? (
        <>
          <section className="panel talk-setup">
            <header className="section-head">
              <div>
                <h2>选择场景</h2>
                <p>场景决定 AI 会和你聊什么；难度决定它用词和追问的复杂程度。</p>
              </div>
            </header>

            <div className="talk-scenarios">
              {meta.scenarios.map((item: TalkScenario) => (
                <button
                  key={item.id}
                  type="button"
                  className={`talk-scenario${scenario === item.id ? ' active' : ''}`}
                  onClick={() => setScenario(item.id)}
                >
                  <span className="talk-scenario-title">{item.title}</span>
                  <span className="talk-scenario-desc">{item.description}</span>
                </button>
              ))}
            </div>

            <div className="talk-options">
              <div className="talk-option-group">
                <span className="settings-label">难度</span>
                <div className="speed-chips">
                  {meta.levels.map((item: TalkLevel) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`speed-chip${level === item.id ? ' active' : ''}`}
                      onClick={() => setLevel(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="talk-option-group">
              <span className="settings-label">AI 声音</span>
              <div className="talk-voices">
                {meta.voices.map((item: TalkVoice) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`talk-voice${voice === item.id ? ' active' : ''}`}
                    onClick={() => setVoice(item.id)}
                  >
                    <AudioLines size={16} />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.note}</small>
                    </span>
                  </button>
                ))}
              </div>
              <p className="hint">
                AI 声音由微软神经网络语音合成，生成时需要联网；网络不可用时会自动改用系统语音。
              </p>
            </div>

            <button
              type="button"
              className="btn btn-primary talk-start"
              onClick={() => void start()}
              disabled={starting}
            >
              {starting ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Mic size={16} />
              )}
              {starting ? '正在开启对话…' : '开始对话'}
              <ChevronRight size={15} />
            </button>
          </section>

          <section className="panel talk-history">
            <header className="section-head">
              <div>
                <h2>历史对话</h2>
                <p>每次对话的原文和复盘都会保存在本地。</p>
              </div>
              <span className="section-count">{history.length} 次</span>
            </header>
            {history.length === 0 ? (
              <div className="talk-history-empty">
                <MessageCircle size={22} />
                <p>还没有对话记录，选一个场景开始第一次练习。</p>
              </div>
            ) : (
              <div className="talk-history-list">
                {history.map((item) => (
                  <div className="talk-history-row" key={item.id}>
                    <div className="talk-history-main">
                      <h3>
                        {item.scenario_title}
                        <span className={`state-pill ${item.status === 'finished' ? 'review' : 'learning'}`}>
                          {item.status === 'finished' ? '已复盘' : '进行中'}
                        </span>
                      </h3>
                      <p>
                        {formatDate(item.created_at)} · {levelLabel(item.level)} ·{' '}
                        {item.user_turn_count} 轮发言
                      </p>
                      {item.preview ? (
                        <p className="talk-history-preview">{item.preview}</p>
                      ) : null}
                    </div>
                    <div className="talk-history-actions">
                      <Link className="btn btn-small" to={`/talk/${item.id}`}>
                        {item.status === 'finished' ? '查看复盘' : '继续对话'}
                      </Link>
                      <button
                        className="btn-icon danger-hover"
                        title="删除这次对话"
                        onClick={() => void remove(item)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="status-panel">
          <h2>还没有可用的对话配置</h2>
          <p className="status-stage">
            请先在设置页配置 AI 服务，再回到这里开始对话。
          </p>
          <Link className="btn btn-primary" to="/settings">
            去设置
          </Link>
        </div>
      )}
    </div>
  )
}
