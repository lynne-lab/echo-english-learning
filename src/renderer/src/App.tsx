import { useEffect, useState, type ReactElement } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AudioLines, RefreshCw } from 'lucide-react'
import { api } from './api'
import NotesPanel from './components/NotesPanel'
import Sidebar from './components/Sidebar'
import { ToastProvider } from './components/Toast'
import DictationHomePage from './pages/DictationHomePage'
import DictationPage from './pages/DictationPage'
import LibraryPage from './pages/LibraryPage'
import PlanPage from './pages/PlanPage'
import PlayerPage from './pages/PlayerPage'
import PracticeHomePage from './pages/PracticeHomePage'
import ReviewPage from './pages/ReviewPage'
import SettingsPage from './pages/SettingsPage'
import ShadowingPage from './pages/ShadowingPage'
import ShadowingReviewPage from './pages/ShadowingReviewPage'
import StatsPage from './pages/StatsPage'
import WordsPage from './pages/WordsPage'

type EngineState = 'starting' | 'ready' | 'error'

function Splash({ state }: { state: EngineState }): ReactElement {
  return (
    <div className="splash">
      <div className="splash-glow" />
      <div className="splash-mark">
        <AudioLines size={34} />
      </div>
      <h1>Echo</h1>
      <p className="splash-subtitle">英语精听 · 跟读工作台</p>
      {state === 'starting' ? (
        <div className="splash-status">
          <span className="pulse-dot" />
          正在启动本地引擎…
        </div>
      ) : (
        <div className="splash-error">
          <p>本地引擎没有启动成功。</p>
          <p className="muted">请查看日志后重试。首次启动或安装依赖可能需要一点时间。</p>
          <div className="splash-actions">
            <button className="btn btn-ghost" onClick={() => window.api?.openSidecarLog()}>
              打开日志
            </button>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              <RefreshCw size={15} /> 重试
            </button>
          </div>
        </div>
      )}
      <span className="splash-hint">数据保存在本地 · 核心功能离线可用</span>
    </div>
  )
}

function Shell(): ReactElement {
  const [notesOpen, setNotesOpen] = useState(true)
  return (
    <div className="app-shell">
      <Sidebar
        notesOpen={notesOpen}
        onToggleNotes={() => setNotesOpen((value) => !value)}
      />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route
            path="/listening"
            element={<PracticeHomePage mode="player" />}
          />
          <Route
            path="/shadowing"
            element={<PracticeHomePage mode="shadowing" />}
          />
          <Route path="/player/:id" element={<PlayerPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/dictation" element={<DictationHomePage />} />
          <Route path="/dictation/:id" element={<DictationPage />} />
          <Route path="/shadow/:id/review" element={<ShadowingReviewPage />} />
          <Route path="/shadow/:id" element={<ShadowingPage />} />
          <Route path="/words" element={<WordsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/library" replace />} />
        </Routes>
      </main>
      {notesOpen ? <NotesPanel onClose={() => setNotesOpen(false)} /> : null}
    </div>
  )
}

export default function App(): ReactElement {
  const [engineState, setEngineState] = useState<EngineState>('starting')

  useEffect(() => {
    let stopped = false
    let attempts = 0
    let timer = 0

    const check = async (): Promise<void> => {
      try {
        await api.health()
        if (!stopped) setEngineState('ready')
        return
      } catch {
        attempts += 1
        if (attempts > 90) {
          if (!stopped) setEngineState('error')
          return
        }
        if (!stopped) timer = window.setTimeout(check, 1000)
      }
    }

    void check()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [])

  if (engineState !== 'ready') return <Splash state={engineState} />

  return (
    <ToastProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </ToastProvider>
  )
}
