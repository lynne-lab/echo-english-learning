import { useEffect, useState, type ReactElement } from 'react'
import {
  NavLink,
  useLocation,
  useNavigate
} from 'react-router-dom'
import {
  Activity,
  AudioLines,
  BookMarked,
  CalendarRange,
  Headphones,
  LibraryBig,
  Mic,
  PenLine,
  Repeat2,
  Settings2,
  ShieldCheck
} from 'lucide-react'
import { api } from '../api'

const items = [
  { to: '/library', label: '素材库', icon: LibraryBig },
  { to: '/plan', label: '学习计划', icon: CalendarRange },
  { to: '/listening', label: '精听', icon: Headphones, match: ['/player/'] },
  { to: '/shadowing', label: '跟读', icon: Mic, match: ['/shadow/'] },
  { to: '/review', label: '今日复习', icon: Repeat2, badge: true },
  { to: '/dictation', label: '默写', icon: PenLine },
  { to: '/words', label: '生词本', icon: BookMarked },
  { to: '/stats', label: '学习统计', icon: Activity },
  { to: '/settings', label: '设置', icon: Settings2 }
]

export default function Sidebar(): ReactElement {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [dueCount, setDueCount] = useState(0)
  const [dictationPath, setDictationPath] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .dictationActive()
      .then((active) => {
        if (!cancelled) {
          setDictationPath(
            active
              ? `/dictation/${active.material_id}?session=${active.id}`
              : null
          )
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [pathname])

  useEffect(() => {
    let cancelled = false
    let timer = 0

    const load = async (): Promise<void> => {
      try {
        const summary = await api.reviewsSummary()
        if (!cancelled) {
          setDueCount(summary.due_reviews + summary.new_available)
        }
      } catch {
        /* engine may still be starting */
      }
    }

    const refresh = (): void => {
      void load()
    }

    void load()
    timer = window.setInterval(refresh, 60000)
    window.addEventListener('echo:review-changed', refresh)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('echo:review-changed', refresh)
    }
  }, [])

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <AudioLines size={22} />
        </div>
        <div>
          <div className="brand-name">Echo</div>
          <div className="brand-tag">英语精听 · 跟读</div>
        </div>
      </div>

      <nav className="nav">
        {items.map(({ to, label, icon: Icon, badge, match }) => (
          <NavLink
            key={to}
            to={to}
            onClick={(event) => {
              if (to !== '/dictation' || !dictationPath) return
              if (pathname.startsWith('/dictation')) {
                event.preventDefault()
                return
              }
              event.preventDefault()
              navigate(dictationPath)
            }}
            className={({ isActive }) =>
              `nav-item${
                isActive || match?.some((prefix) => pathname.startsWith(prefix))
                  ? ' active'
                  : ''
              }`
            }
          >
            <Icon size={18} strokeWidth={1.9} />
            <span>{label}</span>
            {badge && dueCount > 0 ? (
              <span className="nav-badge">{dueCount > 99 ? '99+' : dueCount}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="offline-badge">
          <ShieldCheck size={15} />
          <span>本地运行 · 离线优先</span>
        </div>
        <div className="version">v0.8.3 · 断点续学</div>
      </div>
    </aside>
  )
}
