import type { ReactElement } from 'react'
import {
  BookmarkPlus,
  Check,
  Loader2,
  MousePointerClick,
  Volume2,
  X
} from 'lucide-react'
import type { DictionaryEntry } from '../types'

interface WordPanelProps {
  word: string | null
  entry: DictionaryEntry | null
  loading: boolean
  added: boolean
  adding: boolean
  onAdd: () => void
  onSpeak: () => void
  onClose: () => void
}

export default function WordPanel({
  word,
  entry,
  loading,
  added,
  adding,
  onAdd,
  onSpeak,
  onClose
}: WordPanelProps): ReactElement {
  return (
    <div className="word-panel">
      <header className="word-panel-header">
        <div>
          <div className="eyebrow">DICTIONARY</div>
          <h2>查词</h2>
        </div>
        {word ? (
          <button className="btn-icon" onClick={onClose} title="关闭" aria-label="关闭查词面板">
            <X size={17} />
          </button>
        ) : null}
      </header>

      {!word ? (
        <div className="word-hint">
          <div className="word-hint-icon">
            <MousePointerClick size={24} />
          </div>
          <p className="word-hint-title">点击原文里的单词</p>
          <p className="word-hint-text">
            查看音标、中文释义和英文解释，听发音，一键把它加入生词本。
          </p>
          <div className="shortcut-list">
            <span><kbd>Space</kbd> 播放 / 暂停</span>
            <span><kbd>↑</kbd><kbd>↓</kbd> 上一句 / 下一句</span>
            <span><kbd>L</kbd> 循环当前句</span>
            <span><kbd>S</kbd> 字幕开关</span>
          </div>
        </div>
      ) : (
        <div className="word-detail">
          <div className="word-title-row">
            <h3>{entry?.lemma ?? word}</h3>
            {entry?.phonetic ? <span className="phonetic">/{entry.phonetic}/</span> : null}
            <button className="btn-icon" onClick={onSpeak} title="朗读">
              <Volume2 size={17} />
            </button>
          </div>

          {entry && entry.lemma.toLowerCase() !== word.toLowerCase() ? (
            <p className="hint">原形：{entry.lemma}</p>
          ) : null}

          {loading ? (
            <div className="word-loading">
              <Loader2 size={18} className="spin" /> 查询中…
            </div>
          ) : entry && (entry.translation || entry.definition) ? (
            <>
              {entry.translation ? (
                <section className="def-block">
                  <span className="def-label">中文释义</span>
                  <p className="def-translation">{entry.translation}</p>
                </section>
              ) : null}
              {entry.definition ? (
                <section className="def-block">
                  <span className="def-label">英文释义</span>
                  <p className="def-definition">{entry.definition}</p>
                </section>
              ) : null}
              <span className="dict-source">来源：{entry.source ?? 'ECDICT'}</span>
            </>
          ) : (
            <div className="word-missing">
              ECDICT 没有收录这个词。你可以先加入生词本，之后补充释义。
            </div>
          )}

          <button
            className="btn btn-primary add-word-button"
            onClick={onAdd}
            disabled={added || adding}
          >
            {adding ? (
              <Loader2 size={16} className="spin" />
            ) : added ? (
              <Check size={16} />
            ) : (
              <BookmarkPlus size={16} />
            )}
            {added ? '已在生词本' : '加入生词本'}
          </button>
        </div>
      )}
    </div>
  )
}
