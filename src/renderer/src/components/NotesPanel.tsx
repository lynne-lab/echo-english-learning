import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Eye,
  FileDown,
  FileText,
  Loader2,
  Pencil,
  StickyNote,
  X
} from 'lucide-react'
import { useToast } from './Toast'
import { errorMessage } from '../utils'

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

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type ExportKind = 'md' | 'pdf' | null

const NOTES_WIDTH_KEY = 'echo.notes.width'
const DEFAULT_WIDTH = 372
const MIN_WIDTH = 280
const MAX_WIDTH = 680

function clampWidth(width: number): number {
  const room = Math.max(MIN_WIDTH, window.innerWidth - 620)
  return Math.min(Math.max(width, MIN_WIDTH), Math.min(MAX_WIDTH, room))
}

function initialWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(NOTES_WIDTH_KEY))
    if (Number.isFinite(stored) && stored > 0) return clampWidth(stored)
  } catch {
    /* storage unavailable */
  }
  return clampWidth(DEFAULT_WIDTH)
}

export default function NotesPanel({
  onClose
}: {
  onClose: () => void
}): ReactElement {
  const { push } = useToast()
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [exporting, setExporting] = useState<ExportKind>(null)
  const [width, setWidth] = useState(initialWidth)

  const latestRef = useRef('')
  const loadedRef = useRef(false)
  const dirtyRef = useRef(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const value = window.api ? await window.api.loadNotes() : ''
        if (cancelled) return
        latestRef.current = value
        setText(value)
      } catch (error) {
        if (!cancelled) push(`读取笔记失败：${errorMessage(error)}`, 'error')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [push])

  useEffect(() => {
    latestRef.current = text
  }, [text])

  useEffect(() => {
    if (!loaded) return
    if (!loadedRef.current) {
      loadedRef.current = true
      return
    }
    dirtyRef.current = true
    setSaveState('saving')
    const timer = window.setTimeout(async () => {
      if (!window.api) return
      try {
        await window.api.saveNotes(latestRef.current)
        dirtyRef.current = false
        setSaveState('saved')
        setSavedAt(
          new Date().toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
          })
        )
      } catch {
        setSaveState('error')
      }
    }, 600)
    return () => window.clearTimeout(timer)
  }, [text, loaded])

  useEffect(() => {
    // Closing the panel within the debounce window must not lose the edit.
    return () => {
      if (loadedRef.current && dirtyRef.current && window.api) {
        void window.api.saveNotes(latestRef.current).catch(() => undefined)
      }
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(NOTES_WIDTH_KEY, String(width))
      } catch {
        /* storage unavailable */
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [width])

  useEffect(() => {
    const onResize = (): void => {
      setWidth((current) => clampWidth(current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('notes-resizing')
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    setWidth(clampWidth(drag.startWidth + (drag.startX - event.clientX)))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    document.body.classList.remove('notes-resizing')
  }

  const resetWidth = (): void => {
    setWidth(clampWidth(DEFAULT_WIDTH))
  }

  const exportMarkdown = async (): Promise<void> => {
    if (exporting || !window.api) return
    setExporting('md')
    try {
      const filePath = await window.api.exportNotesMarkdown(text)
      if (filePath) push(`已导出 Markdown：${filePath}`, 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    } finally {
      setExporting(null)
    }
  }

  const exportPdf = async (): Promise<void> => {
    if (exporting || !window.api) return
    setExporting('pdf')
    try {
      const html = renderToStaticMarkup(
        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {text}
        </Markdown>
      )
      const filePath = await window.api.exportNotesPdf({ text, html })
      if (filePath) push(`已导出 PDF：${filePath}`, 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    } finally {
      setExporting(null)
    }
  }

  const statusText =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'error'
        ? '保存失败'
        : saveState === 'saved' && savedAt
          ? `已保存 ${savedAt}`
          : '自动保存'

  return (
    <section className="notes-panel" aria-label="学习笔记" style={{ width }}>
      <div
        className="notes-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整笔记栏宽度"
        aria-valuenow={Math.round(width)}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        title="拖动调整宽度，双击恢复默认"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={resetWidth}
      />
      <header className="notes-head">
        <div className="notes-head-title">
          <div className="notes-icon">
            <StickyNote size={17} />
          </div>
          <div>
            <h2>学习笔记</h2>
            <p>Markdown · 自动保存</p>
          </div>
        </div>
        <button className="btn-icon" title="关闭笔记" onClick={onClose}>
          <X size={17} />
        </button>
      </header>

      <div className="notes-toolbar">
        <div className="notes-tabs">
          <button
            className={`notes-tab${view === 'edit' ? ' active' : ''}`}
            onClick={() => setView('edit')}
          >
            <Pencil size={13} /> 编辑
          </button>
          <button
            className={`notes-tab${view === 'preview' ? ' active' : ''}`}
            onClick={() => setView('preview')}
          >
            <Eye size={13} /> 预览
          </button>
        </div>
        <div className="notes-actions">
          <button
            className="notes-export"
            title="导出为 Markdown（.md）"
            onClick={() => void exportMarkdown()}
            disabled={exporting !== null}
          >
            {exporting === 'md' ? (
              <Loader2 size={13} className="spin" />
            ) : (
              <FileText size={13} />
            )}
            <span>MD</span>
          </button>
          <button
            className="notes-export"
            title="导出为 PDF"
            onClick={() => void exportPdf()}
            disabled={exporting !== null}
          >
            {exporting === 'pdf' ? (
              <Loader2 size={13} className="spin" />
            ) : (
              <FileDown size={13} />
            )}
            <span>PDF</span>
          </button>
        </div>
      </div>

      <div className="notes-body">
        {!loaded ? (
          <div className="notes-loading">
            <Loader2 className="spin" size={18} /> 正在读取笔记…
          </div>
        ) : view === 'edit' ? (
          <textarea
            className="notes-editor"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={'在这里记单词、句型、听力笔记…\n\n支持 Markdown：\n# 标题\n- 列表\n**加粗**\n> 引用\n```代码```'}
            spellCheck={false}
          />
        ) : (
          <div className="notes-preview">
            {text.trim() ? (
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {text}
              </Markdown>
            ) : (
              <p className="notes-empty">还没有内容，切换到「编辑」开始写吧。</p>
            )}
          </div>
        )}
      </div>

      <footer className="notes-foot">
        <span>{text.length} 字符</span>
        <span className={`notes-save-state ${saveState}`}>{statusText}</span>
      </footer>
    </section>
  )
}
