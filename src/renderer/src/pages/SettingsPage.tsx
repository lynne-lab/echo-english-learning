import { useEffect, useState, type ReactElement } from 'react'
import {
  BookOpen,
  CheckCircle2,
  Cloud,
  Cpu,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCw,
  Repeat2,
  Server,
  SlidersHorizontal
} from 'lucide-react'
import { api } from '../api'
import { useToast } from '../components/Toast'
import type { AppInfo, AppSettings, Health } from '../types'
import { errorMessage, formatNumber } from '../utils'

function deviceLabel(device: string): string {
  if (device === 'cuda') return 'GPU (CUDA)'
  if (device === 'cpu') return 'CPU'
  return '自动检测（首次转写时）'
}

export default function SettingsPage(): ReactElement {
  const { push } = useToast()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dictBusy, setDictBusy] = useState(false)
  const [azureKey, setAzureKey] = useState('')
  const [azureRegion, setAzureRegion] = useState('')
  const [azureSaving, setAzureSaving] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [nextSettings, nextHealth, info] = await Promise.all([
        api.settings(),
        api.health(),
        window.api.getAppInfo()
      ])
      setSettings(nextSettings)
      setHealth(nextHealth)
      setAppInfo(info)
      setAzureRegion(nextSettings.azure_speech_region)
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleModelChange = async (model: string): Promise<void> => {
    try {
      const updated = await api.patchSettings({ whisper_model: model })
      setSettings(updated)
      setHealth((previous) => (previous ? { ...previous, whisper_model: model } : previous))
      push('模型已切换，将在下一次转写时生效', 'success')
    } catch (changeError) {
      push(errorMessage(changeError), 'error')
    }
  }

  const handleNewLimitChange = async (limit: number): Promise<void> => {
    try {
      const updated = await api.patchSettings({ daily_new_limit: limit })
      setSettings(updated)
      push(`每日新词上限已设为 ${limit} 个`, 'success')
      window.dispatchEvent(new Event('echo:review-changed'))
    } catch (changeError) {
      push(errorMessage(changeError), 'error')
    }
  }

  const handleAzureSave = async (): Promise<void> => {
    if (!settings) return
    const region = azureRegion.trim().toLowerCase()
    const key = azureKey.trim()
    if (!region) {
      push('请填写 Azure 区域，例如 eastus', 'error')
      return
    }
    if (!key && !settings.azure_configured) {
      push('请填写 Azure Speech 密钥', 'error')
      return
    }
    setAzureSaving(true)
    try {
      const updated = await api.patchSettings({
        azure_speech_region: region,
        ...(key ? { azure_speech_key: key } : {})
      })
      setSettings(updated)
      setAzureRegion(updated.azure_speech_region)
      setAzureKey('')
      push('Azure 配置已保存', 'success')
    } catch (azureError) {
      push(errorMessage(azureError), 'error')
    } finally {
      setAzureSaving(false)
    }
  }

  const handleAzureClear = async (): Promise<void> => {
    if (!window.confirm('清除 Azure 配置？之后无法使用 Azure 音素评分。')) return
    setAzureSaving(true)
    try {
      const updated = await api.patchSettings({
        azure_speech_key: '',
        azure_speech_region: ''
      })
      setSettings(updated)
      setAzureRegion('')
      setAzureKey('')
      push('已清除 Azure 配置', 'success')
    } catch (azureError) {
      push(errorMessage(azureError), 'error')
    } finally {
      setAzureSaving(false)
    }
  }

  const handleAttachDictionary = async (): Promise<void> => {
    const path = await window.api.selectDictionaryFile()
    if (!path) return
    setDictBusy(true)
    try {
      const result = await api.attachDictionary(path)
      push(`词典已就绪：${formatNumber(result.entries)} 条`, 'success')
      await load()
    } catch (attachError) {
      push(errorMessage(attachError), 'error')
    } finally {
      setDictBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-loading">
          <Loader2 className="spin" size={20} /> 正在读取设置…
        </div>
      </div>
    )
  }

  if (error || !settings || !health) {
    return (
      <div className="page">
        <div className="status-panel">
          <div className="status-icon error">
            <Server size={30} />
          </div>
          <h2>无法读取设置</h2>
          <p className="status-error">{error || '本地引擎没有响应'}</p>
          <button className="btn btn-primary" onClick={() => void load()}>
            <RefreshCw size={16} /> 重试
          </button>
        </div>
      </div>
    )
  }

  const currentModel = settings.models.find((model) => model.id === settings.whisper_model)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">SETTINGS</div>
          <h1>设置</h1>
          <p className="page-subtitle">转写模型、离线词典和本地数据都在这里管理。</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => void load()}>
            <RefreshCw size={15} /> 刷新状态
          </button>
        </div>
      </header>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-icon">
              <SlidersHorizontal size={18} />
            </div>
            <div>
              <h2>转写模型</h2>
              <p>更大的模型更准确，但第一次需要下载，速度也更慢。</p>
            </div>
          </div>

          <label className="field">
            <span>Whisper 模型</span>
            <select
              value={settings.whisper_model}
              onChange={(event) => void handleModelChange(event.target.value)}
            >
              {settings.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} · {model.size}
                </option>
              ))}
            </select>
          </label>

          {currentModel ? (
            <p className="hint">
              {currentModel.note}。已下载的模型会缓存在本地，切换后下一次转写生效。
            </p>
          ) : null}

          <div className="settings-row">
            <span className="settings-label">识别设备</span>
            <span className="settings-value">{deviceLabel(health.device)}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">已加载模型</span>
            <span className="settings-value">{health.model_loaded ?? '尚未加载'}</span>
          </div>
          {health.device === 'cpu' ? (
            <p className="hint warn">
              当前在用 CPU 转写。安装 CUDA 运行时后可以启用 RTX 3060 加速，后续版本会提供一键配置。
            </p>
          ) : null}
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-icon">
              <Repeat2 size={18} />
            </div>
            <div>
              <h2>复习计划</h2>
              <p>每天最多引入多少张新的生词卡片，到期的旧卡始终全部出现。</p>
            </div>
          </div>

          <label className="field">
            <span>每日新词上限</span>
            <select
              value={settings.daily_new_limit}
              onChange={(event) => void handleNewLimitChange(Number(event.target.value))}
            >
              {[10, 20, 30, 50, 100].map((limit) => (
                <option key={limit} value={limit}>
                  {limit} 个
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            新词首次评分后会进入 FSRS 间隔重复队列，按记忆稳定性自动安排下次复习时间。
          </p>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-icon">
              <Cpu size={18} />
            </div>
            <div>
              <h2>本地引擎</h2>
              <p>所有转写和数据处理都在这台电脑上完成。</p>
            </div>
          </div>

          <div className="engine-status">
            <span className="status-dot online" />
            <span>运行中</span>
            <span className="engine-version">v{health.version}</span>
          </div>

          <div className="settings-row">
            <span className="settings-label">FFmpeg</span>
            <span className="settings-value">
              {health.ffmpeg ? (
                <span className="inline-ok">
                  <CheckCircle2 size={14} /> 已就绪
                </span>
              ) : (
                '未找到'
              )}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-label">当前模型</span>
            <span className="settings-value">{health.whisper_model}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">离线词典</span>
            <span className="settings-value">{formatNumber(health.dictionary_entries)} 条</span>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-icon">
              <BookOpen size={18} />
            </div>
            <div>
              <h2>离线词典</h2>
              <p>ECDICT 英汉词典，点击原文单词时本地查询，不联网。</p>
            </div>
          </div>

          {health.dictionary_entries > 0 ? (
            <p className="dict-status">
              <CheckCircle2 size={16} /> ECDICT · {formatNumber(health.dictionary_entries)} 条
            </p>
          ) : (
            <p className="dict-status missing">
              还没有安装词典。选择从 ECDICT 解压出的 ecdict.db 文件即可。
            </p>
          )}

          <button className="btn" onClick={() => void handleAttachDictionary()} disabled={dictBusy}>
            {dictBusy ? <Loader2 size={15} className="spin" /> : <BookOpen size={15} />}
            {health.dictionary_entries > 0 ? '更换词典文件' : '选择 ecdict.db'}
          </button>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-icon">
              <Cloud size={18} />
            </div>
            <div>
              <h2>Azure 发音评分（可选）</h2>
              <p>Microsoft Azure 的音素级发音评估；核心功能仍然离线。</p>
            </div>
          </div>

          {settings.azure_configured ? (
            <p className="dict-status">
              <CheckCircle2 size={16} /> 已配置 · 区域 {settings.azure_speech_region} · 密钥{' '}
              {settings.azure_key_masked}
            </p>
          ) : (
            <p className="dict-status missing">
              尚未配置。不配置也可以正常使用本地跟读评测。
            </p>
          )}

          <label className="field">
            <span>Speech 密钥</span>
            <input
              type="password"
              autoComplete="off"
              value={azureKey}
              onChange={(event) => setAzureKey(event.target.value)}
              placeholder={
                settings.azure_configured
                  ? '已保存，留空则不修改'
                  : '粘贴 Azure Speech 密钥'
              }
            />
          </label>
          <label className="field">
            <span>区域</span>
            <input
              value={azureRegion}
              onChange={(event) => setAzureRegion(event.target.value)}
              placeholder="eastus"
            />
          </label>

          <div className="settings-actions">
            <button
              className="btn btn-primary"
              onClick={() => void handleAzureSave()}
              disabled={azureSaving}
            >
              {azureSaving ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Cloud size={15} />
              )}
              保存 Azure 配置
            </button>
            {settings.azure_configured ? (
              <button
                className="btn"
                onClick={() => void handleAzureClear()}
                disabled={azureSaving}
              >
                清除
              </button>
            ) : null}
          </div>

          <p className="hint">
            在 Azure Portal 创建 Speech 资源后可获得密钥和区域。点击跟读页的
            「Azure 评分」时，选中的录音会上传到 Microsoft Azure；密钥只保存在本机数据库。
            Azure 发音评估最长支持 30 秒。
          </p>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-icon">
              <FolderOpen size={18} />
            </div>
            <div>
              <h2>数据与日志</h2>
              <p>素材、字幕、生词和备份都保存在本地目录。</p>
            </div>
          </div>

          <div className="path-box">{appInfo?.dataDir ?? '—'}</div>

          <div className="settings-actions">
            <button className="btn" onClick={() => void window.api.openDataDir()}>
              <FolderOpen size={15} /> 打开数据文件夹
            </button>
            <button className="btn" onClick={() => void window.api.openSidecarLog()}>
              <FileText size={15} /> 查看引擎日志
            </button>
          </div>

          <p className="hint">
            备份方法：关闭应用后，完整复制 data 文件夹即可。素材文件如果是本地引用，原文件移动后需要重新导入。
          </p>
        </section>

        <section className="settings-card about-card">
          <div className="settings-card-header">
            <div className="settings-icon">
              <Server size={18} />
            </div>
            <div>
              <h2>关于 Echo</h2>
              <p>英语精听 · 跟读工作台</p>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-label">版本</span>
            <span className="settings-value">v{appInfo?.version ?? '0.5.0'} · 学习计划</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">技术栈</span>
            <span className="settings-value">Electron + React + faster-whisper</span>
          </div>
          <p className="hint">
            核心转写、查词、复习、默写和跟读都在本地运行；在线素材下载和 Azure
            发音评分需要联网，Azure 评分是可选项。
          </p>
        </section>
      </div>
    </div>
  )
}
