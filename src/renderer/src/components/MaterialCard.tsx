import type { ReactElement } from 'react'
import {
  AlertCircle,
  Clock3,
  Film,
  Link2,
  Loader2,
  Mic,
  Music2,
  PenLine,
  Play,
  RotateCcw,
  Trash2
} from 'lucide-react'
import type { Material } from '../types'
import { formatDate, formatDuration } from '../utils'

interface MaterialCardProps {
  material: Material
  onOpen: (material: Material) => void
  onRetry: (material: Material) => void
  onDelete: (material: Material) => void
  onDictate: (material: Material) => void
  onShadow: (material: Material) => void
}

export default function MaterialCard({
  material,
  onOpen,
  onRetry,
  onDelete,
  onDictate,
  onShadow
}: MaterialCardProps): ReactElement {
  const isProcessing = material.status === 'processing'
  const isError = material.status === 'error'
  const progress = Math.round(Math.min(Math.max(material.progress, 0), 1) * 100)

  return (
    <article
      className={`material-card${isProcessing ? ' is-processing' : ''}${isError ? ' is-error' : ''}`}
      onClick={() => onOpen(material)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(material)
        }
      }}
      tabIndex={0}
      role="button"
    >
      <div className="material-top">
        <div className={`material-icon ${material.media_type}`}>
          {material.media_type === 'video' ? <Film size={22} /> : <Music2 size={22} />}
        </div>
        <div className="material-badges">
          <span className="badge">
            {material.source_type === 'url' ? <Link2 size={11} /> : null}
            {material.source_type === 'url' ? '链接' : '本地'}
          </span>
          {material.status === 'ready' ? <span className="badge ready">就绪</span> : null}
        </div>
      </div>

      <h3 className="material-title" title={material.title}>
        {material.title}
      </h3>

      <div className="material-meta">
        <span>
          <Clock3 size={13} /> {formatDuration(material.duration)}
        </span>
        <span>{material.sentence_count} 句</span>
        <span>{formatDate(material.created_at)}</span>
      </div>

      {isProcessing ? (
        <div className="material-progress">
          <div className="progress-row">
            <span className="progress-stage">
              <Loader2 size={13} className="spin" /> {material.stage || '处理中'}
            </span>
            <span className="progress-value">{progress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.max(progress, 3)}%` }} />
          </div>
        </div>
      ) : null}

      {isError ? (
        <div className="material-error">
          <AlertCircle size={14} />
          <span title={material.error ?? ''}>{material.error || '处理失败'}</span>
        </div>
      ) : null}

      <footer className="material-footer">
        {isError ? (
          <button
            className="btn btn-small"
            onClick={(event) => {
              event.stopPropagation()
              onRetry(material)
            }}
          >
            <RotateCcw size={14} /> 重试
          </button>
        ) : (
          <span className="material-open">
            <Play size={14} /> {isProcessing ? '查看进度' : '继续学习'}
          </span>
        )}
        <div className="material-footer-actions">
          {material.status === 'ready' && material.sentence_count > 0 ? (
            <>
              <button
                className="btn-icon"
                title="开始默写"
                onClick={(event) => {
                  event.stopPropagation()
                  onDictate(material)
                }}
              >
                <PenLine size={15} />
              </button>
              <button
                className="btn-icon"
                title="开始跟读"
                onClick={(event) => {
                  event.stopPropagation()
                  onShadow(material)
                }}
              >
                <Mic size={15} />
              </button>
            </>
          ) : null}
          <button
            className="btn-icon danger-hover"
            title="删除素材"
            onClick={(event) => {
              event.stopPropagation()
              onDelete(material)
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </footer>
    </article>
  )
}
