import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FilePlus2,
  Headphones,
  Link2,
  Loader2,
  Plus,
  Search
} from 'lucide-react'
import { api } from '../api'
import EmptyState from '../components/EmptyState'
import MaterialCard from '../components/MaterialCard'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'
import type { Material } from '../types'
import { errorMessage, formatDuration } from '../utils'

export default function LibraryPage(): ReactElement {
  const navigate = useNavigate()
  const { push } = useToast()
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  const [query, setQuery] = useState('')

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await api.materials()
      setMaterials(data)
    } catch {
      /* the engine may still be starting; keep the previous list */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      void load()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [load])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return materials
    return materials.filter((material) => material.title.toLowerCase().includes(keyword))
  }, [materials, query])

  const stats = useMemo(() => {
    return {
      count: materials.length,
      duration: materials.reduce((sum, material) => sum + (material.duration ?? 0), 0),
      sentences: materials.reduce((sum, material) => sum + (material.sentence_count ?? 0), 0)
    }
  }, [materials])

  const handleImportLocal = async (): Promise<void> => {
    setImporting(true)
    try {
      const path = await window.api.selectMediaFile()
      if (!path) return
      const material = await api.importLocal(path)
      setMaterials((previous) => [material, ...previous.filter((item) => item.id !== material.id)])
      push('已加入素材库，正在转写…', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    } finally {
      setImporting(false)
    }
  }

  const handleImportUrl = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    setUrlBusy(true)
    try {
      const material = await api.importUrl(trimmed)
      setMaterials((previous) => [material, ...previous.filter((item) => item.id !== material.id)])
      setUrl('')
      setUrlOpen(false)
      push('已开始下载链接素材', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    } finally {
      setUrlBusy(false)
    }
  }

  const handleRetry = async (material: Material): Promise<void> => {
    try {
      const updated = await api.retryMaterial(material.id)
      setMaterials((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item))
      )
      push('已重新开始处理', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    }
  }

  const handleDelete = async (material: Material): Promise<void> => {
    if (!window.confirm(`删除「${material.title}」？生词本里的单词会保留。`)) return
    try {
      await api.deleteMaterial(material.id)
      setMaterials((previous) => previous.filter((item) => item.id !== material.id))
      push('已删除素材', 'success')
    } catch (error) {
      push(errorMessage(error), 'error')
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">LIBRARY</div>
          <h1>素材库</h1>
          <p className="page-subtitle">导入音频、视频或网页链接，自动转写成可逐句精听的字幕。</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setUrlOpen(true)}>
            <Link2 size={16} /> 添加链接
          </button>
          <button className="btn btn-primary" onClick={() => void handleImportLocal()} disabled={importing}>
            {importing ? <Loader2 size={16} className="spin" /> : <FilePlus2 size={16} />}
            导入本地文件
          </button>
        </div>
      </header>

      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-value">{stats.count}</span>
          <span className="stat-label">素材</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{formatDuration(stats.duration)}</span>
          <span className="stat-label">总时长</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.sentences}</span>
          <span className="stat-label">可精听句子</span>
        </div>
      </div>

      <div className="toolbar">
        <label className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索素材…"
          />
        </label>
        <span className="toolbar-hint">
          {filtered.length === materials.length ? `${materials.length} 个素材` : `${filtered.length} 个结果`}
        </span>
      </div>

      {loading ? (
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在读取素材库…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Headphones size={30} />}
          title={materials.length === 0 ? '还没有听力素材' : '没有匹配的素材'}
          description={
            materials.length === 0
              ? '导入本地音频/视频，或粘贴 YouTube、B 站等链接。Echo 会本地转写，切成句子并保存到你的电脑。'
              : '换一个关键词试试。'
          }
        >
          {materials.length === 0 ? (
            <div className="empty-actions">
              <button className="btn btn-primary" onClick={() => void handleImportLocal()}>
                <Plus size={16} /> 导入第一个素材
              </button>
              <button className="btn" onClick={() => setUrlOpen(true)}>
                <Link2 size={16} /> 粘贴链接
              </button>
            </div>
          ) : null}
        </EmptyState>
      ) : (
        <div className="material-grid">
          {filtered.map((material) => (
            <MaterialCard
              key={material.id}
              material={material}
              onOpen={(item) => navigate(`/player/${item.id}`)}
              onRetry={(item) => void handleRetry(item)}
              onDelete={(item) => void handleDelete(item)}
              onDictate={(item) => navigate(`/dictation/${item.id}`)}
              onShadow={(item) => navigate(`/shadow/${item.id}`)}
            />
          ))}
        </div>
      )}

      <Modal open={urlOpen} title="添加在线素材" onClose={() => setUrlOpen(false)}>
        <form onSubmit={(event) => void handleImportUrl(event)} className="url-form">
          <label className="field">
            <span>视频 / 播客链接</span>
            <input
              autoFocus
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
            />
          </label>
          <p className="hint">
            Echo 会用 yt-dlp 下载音频/视频，再在本地转写。部分视频需要登录或属于 DRM 平台，无法下载。
          </p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setUrlOpen(false)}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={urlBusy || !url.trim()}>
              {urlBusy ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
              开始下载
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
