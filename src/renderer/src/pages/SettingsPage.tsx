import { useEffect, useState, type ReactElement } from 'react'
import {
  BookOpen,
  CheckCircle2,
  Cloud,
  Cpu,
  FileText,
  FolderOpen,
  KeyRound,
  Loader2,
  RefreshCw,
  Repeat2,
  Server,
  SlidersHorizontal,
  Sparkles
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
  const [tencentAppId, setTencentAppId] = useState('')
  const [tencentSecretId, setTencentSecretId] = useState('')
  const [tencentSecretKey, setTencentSecretKey] = useState('')
  const [tencentSaving, setTencentSaving] = useState(false)
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [llmKey, setLlmKey] = useState('')
  const [llmSaving, setLlmSaving] = useState(false)

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
      setTencentAppId(nextSettings.tencent_app_id)
      setLlmBaseUrl(nextSettings.llm_base_url)
      setLlmModel(nextSettings.llm_model)
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

  const handleTencentSave = async (): Promise<void> => {
    if (!settings) return
    const appId = tencentAppId.trim()
    const secretId = tencentSecretId.trim()
    const secretKey = tencentSecretKey.trim()
    if (!appId) {
      push('请填写腾讯云 AppID（纯数字）', 'error')
      return
    }
    if (!secretId && !settings.tencent_configured) {
      push('请填写腾讯云 SecretId', 'error')
      return
    }
    if (!secretKey && !settings.tencent_configured) {
      push('请填写腾讯云 SecretKey', 'error')
      return
    }
    setTencentSaving(true)
    try {
      const updated = await api.patchSettings({
        tencent_speech_app_id: appId,
        ...(secretId ? { tencent_speech_secret_id: secretId } : {}),
        ...(secretKey ? { tencent_speech_secret_key: secretKey } : {})
      })
      setSettings(updated)
      setTencentAppId(updated.tencent_app_id)
      setTencentSecretId('')
      setTencentSecretKey('')
      push('腾讯云智聆配置已保存', 'success')
    } catch (tencentError) {
      push(errorMessage(tencentError), 'error')
    } finally {
      setTencentSaving(false)
    }
  }

  const handleTencentClear = async (): Promise<void> => {
    if (
      !window.confirm(
        '清除腾讯云智聆配置？之后跟读页会改用其他已配置的评测服务，或无法使用在线评分。'
      )
    ) {
      return
    }
    setTencentSaving(true)
    try {
      const updated = await api.patchSettings({
        tencent_speech_app_id: '',
        tencent_speech_secret_id: '',
        tencent_speech_secret_key: ''
      })
      setSettings(updated)
      setTencentAppId('')
      setTencentSecretId('')
      setTencentSecretKey('')
      push('已清除腾讯云智聆配置', 'success')
    } catch (tencentError) {
      push(errorMessage(tencentError), 'error')
    } finally {
      setTencentSaving(false)
    }
  }

  const handleLlmSave = async (): Promise<void> => {
    if (!settings) return
    const baseUrl = llmBaseUrl.trim()
    const model = llmModel.trim()
    const key = llmKey.trim()
    if (!/^https?:\/\/\S+$/i.test(baseUrl)) {
      push('Base URL 必须以 http:// 或 https:// 开头', 'error')
      return
    }
    if (!model) {
      push('请填写模型名称，例如 deepseek-chat', 'error')
      return
    }
    if (!key && !settings.llm_configured) {
      push('请填写 API Key', 'error')
      return
    }
    setLlmSaving(true)
    try {
      const updated = await api.patchSettings({
        llm_base_url: baseUrl,
        llm_model: model,
        ...(key ? { llm_api_key: key } : {})
      })
      setSettings(updated)
      setLlmBaseUrl(updated.llm_base_url)
      setLlmModel(updated.llm_model)
      setLlmKey('')
      push('AI 复盘配置已保存', 'success')
    } catch (llmError) {
      push(errorMessage(llmError), 'error')
    } finally {
      setLlmSaving(false)
    }
  }

  const handleLlmClear = async (): Promise<void> => {
    if (!window.confirm('清除 AI 复盘配置？之后无法生成跟读复盘。')) return
    setLlmSaving(true)
    try {
      const updated = await api.patchSettings({
        llm_api_key: '',
        llm_base_url: '',
        llm_model: ''
      })
      setSettings(updated)
      setLlmBaseUrl(updated.llm_base_url)
      setLlmModel(updated.llm_model)
      setLlmKey('')
      push('已清除 AI 复盘配置', 'success')
    } catch (llmError) {
      push(errorMessage(llmError), 'error')
    } finally {
      setLlmSaving(false)
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
              <KeyRound size={18} />
            </div>
            <div>
              <h2>腾讯云智聆发音评测（推荐）</h2>
              <p>音素级发音评估；核心功能仍然离线。</p>
            </div>
          </div>

          {settings.tencent_configured ? (
            <p className="dict-status">
              <CheckCircle2 size={16} /> 已配置 · AppID {settings.tencent_app_id} ·
              SecretId {settings.tencent_secret_id_masked}
              {settings.pronunciation_provider === 'tencent' ? ' · 当前使用' : ''}
            </p>
          ) : (
            <p className="dict-status missing">
              尚未配置。不配置也可以正常使用本地跟读评测。
            </p>
          )}

          <label className="field">
            <span>AppID</span>
            <input
              value={tencentAppId}
              onChange={(event) => setTencentAppId(event.target.value)}
              placeholder="腾讯云账号 AppID，纯数字"
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span>SecretId</span>
            <input
              type="password"
              autoComplete="off"
              value={tencentSecretId}
              onChange={(event) => setTencentSecretId(event.target.value)}
              placeholder={
                settings.tencent_configured
                  ? '已保存，留空则不修改'
                  : 'AKID 开头的 SecretId'
              }
            />
          </label>
          <label className="field">
            <span>SecretKey</span>
            <input
              type="password"
              autoComplete="off"
              value={tencentSecretKey}
              onChange={(event) => setTencentSecretKey(event.target.value)}
              placeholder={
                settings.tencent_configured
                  ? '已保存，留空则不修改'
                  : '与 SecretId 配对的 SecretKey'
              }
            />
          </label>

          <div className="settings-actions">
            <button
              className="btn btn-primary"
              onClick={() => void handleTencentSave()}
              disabled={tencentSaving}
            >
              {tencentSaving ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <KeyRound size={15} />
              )}
              保存腾讯云配置
            </button>
            {settings.tencent_configured ? (
              <button
                className="btn"
                onClick={() => void handleTencentClear()}
                disabled={tencentSaving}
              >
                清除
              </button>
            ) : null}
          </div>

          <p className="hint">
            在腾讯云控制台开通「智聆口语评测」后，到「访问管理 → API
            密钥管理」创建密钥。点击跟读页的「腾讯云
            评分」时，选中的录音会上传到腾讯云；凭据只保存在本机数据库。录音会自动转成
            16kHz 单声道 WAV，最长支持 60 秒。
          </p>
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

          {settings.tencent_configured && settings.azure_configured ? (
            <p className="hint warn">
              腾讯云和 Azure 都配置时，跟读页优先使用腾讯云。需要改用
              Azure 时，请先清除腾讯云配置。
            </p>
          ) : null}

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
          <p className="hint">
            如果 Azure 登录或创建资源一直报错，可以先不配置它；腾讯云智聆或本地评测都仍然可用。
          </p>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <h2>AI 跟读复盘（可选）</h2>
              <p>用大模型汇总本地与在线评测，生成发音问题和训练方案。</p>
            </div>
          </div>

          {settings.llm_configured ? (
            <p className="dict-status">
              <CheckCircle2 size={16} /> 已配置 · {settings.llm_model} · 密钥{' '}
              {settings.llm_key_masked}
            </p>
          ) : (
            <p className="dict-status missing">
              尚未配置。跟读页可以正常录音和评测，但生成 AI 复盘前需要配置一个模型接口。
            </p>
          )}

          <label className="field">
            <span>Base URL</span>
            <input
              value={llmBaseUrl}
              onChange={(event) => setLlmBaseUrl(event.target.value)}
              placeholder="https://api.deepseek.com/v1"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              autoComplete="off"
              value={llmKey}
              onChange={(event) => setLlmKey(event.target.value)}
              placeholder={
                settings.llm_configured
                  ? '已保存，留空则不修改'
                  : '粘贴你的 API Key'
              }
            />
          </label>
          <label className="field">
            <span>模型</span>
            <input
              value={llmModel}
              onChange={(event) => setLlmModel(event.target.value)}
              placeholder="deepseek-chat"
              spellCheck={false}
            />
          </label>

          <div className="settings-actions">
            <button
              className="btn btn-primary"
              onClick={() => void handleLlmSave()}
              disabled={llmSaving}
            >
              {llmSaving ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Sparkles size={15} />
              )}
              保存 AI 配置
            </button>
            {settings.llm_configured ? (
              <button
                className="btn"
                onClick={() => void handleLlmClear()}
                disabled={llmSaving}
              >
                清除
              </button>
            ) : null}
          </div>

          <p className="hint">
            兼容 OpenAI Chat Completions 接口，可填 DeepSeek、OpenAI
            或其他兼容服务。生成复盘时会把这个素材的句子文本和评分发送给该服务，不上传录音文件；费用由你的
            API 账户承担。
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
            <span className="settings-value">v{appInfo?.version ?? '0.10.1'} · AI 复盘</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">技术栈</span>
            <span className="settings-value">Electron + React + faster-whisper</span>
          </div>
          <p className="hint">
            核心转写、查词、复习、默写和跟读都在本地运行；在线素材下载、腾讯云
            智聆和 Azure 发音评分需要联网，发音评分是可选项。
          </p>
        </section>
      </div>
    </div>
  )
}
