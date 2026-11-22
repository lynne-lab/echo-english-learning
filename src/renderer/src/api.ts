import type {
  AppSettings,
  AzureFeedback,
  DictationGrade,
  DictationMode,
  DictationSession,
  DictationSessionSummary,
  DictionaryEntry,
  Health,
  Material,
  Recording,
  RecordingFeedback,
  ReviewPreview,
  ReviewQueue,
  ReviewRateResult,
  ReviewSummary,
  Sentence,
  Stats,
  StudyPlanResponse,
  WordEntry
} from './types'

export const API_BASE = 'http://127.0.0.1:8765'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {})
      }
    })
  } catch {
    throw new Error('无法连接本地引擎，请稍候重试')
  }

  if (!response.ok) {
    let message = `请求失败 (${response.status})`
    try {
      const data = (await response.json()) as { detail?: unknown }
      if (typeof data.detail === 'string') message = data.detail
      else if (data.detail) message = JSON.stringify(data.detail)
    } catch {
      /* keep the default message */
    }
    throw new Error(message)
  }

  return (await response.json()) as T
}

async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { method: 'POST', body: formData })
  } catch {
    throw new Error('无法连接本地引擎，请稍候重试')
  }
  if (!response.ok) {
    let message = `请求失败 (${response.status})`
    try {
      const data = (await response.json()) as { detail?: unknown }
      if (typeof data.detail === 'string') message = data.detail
      else if (data.detail) message = JSON.stringify(data.detail)
    } catch {
      /* keep the default message */
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

export const api = {
  health: () => request<Health>('/api/health'),

  materials: () => request<Material[]>('/api/materials'),
  material: (id: string) => request<Material>(`/api/materials/${id}`),
  sentences: (id: string) => request<Sentence[]>(`/api/materials/${id}/sentences`),
  importLocal: (path: string) =>
    request<Material>('/api/materials/local', {
      method: 'POST',
      body: JSON.stringify({ path })
    }),
  importUrl: (url: string) =>
    request<Material>('/api/materials/url', {
      method: 'POST',
      body: JSON.stringify({ url })
    }),
  patchMaterial: (id: string, title: string) =>
    request<Material>(`/api/materials/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title })
    }),
  deleteMaterial: (id: string) =>
    request<{ ok: boolean }>(`/api/materials/${id}`, { method: 'DELETE' }),
  retryMaterial: (id: string) =>
    request<Material>(`/api/materials/${id}/retry`, { method: 'POST' }),

  patchSentence: (id: string, text: string) =>
    request<Sentence>(`/api/sentences/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ text })
    }),

  words: () => request<WordEntry[]>('/api/words'),
  addWord: (word: string, sentenceId: string | null) =>
    request<{
      id: string
      lemma: string
      created: boolean
      occurrences: number
      phonetic: string | null
      translation: string | null
    }>('/api/words', {
      method: 'POST',
      body: JSON.stringify({ word, sentence_id: sentenceId })
    }),
  deleteWord: (id: string) =>
    request<{ ok: boolean }>(`/api/words/${id}`, { method: 'DELETE' }),
  lookup: (word: string) =>
    request<DictionaryEntry>(`/api/dictionary/${encodeURIComponent(word)}`),

  settings: () => request<AppSettings>('/api/settings'),
  patchSettings: (updates: {
    whisper_model?: string
    daily_new_limit?: number
    azure_speech_key?: string
    azure_speech_region?: string
  }) =>
    request<AppSettings>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates)
    }),
  attachDictionary: (path: string) =>
    request<{ entries: number }>('/api/dictionary/attach', {
      method: 'POST',
      body: JSON.stringify({ path })
    }),

  reviewsSummary: () => request<ReviewSummary>('/api/reviews/summary'),
  reviewQueue: (limit = 20) => request<ReviewQueue>(`/api/reviews/queue?limit=${limit}`),
  reviewPreview: (wordId: string) =>
    request<ReviewPreview>(`/api/reviews/${wordId}/preview`),
  rateReview: (wordId: string, rating: number, durationMs?: number) =>
    request<ReviewRateResult>(`/api/reviews/${wordId}/rate`, {
      method: 'POST',
      body: JSON.stringify({ rating, duration_ms: durationMs })
    }),

  createDictation: (materialId: string, mode: DictationMode, count: number) =>
    request<DictationSession>('/api/dictation/sessions', {
      method: 'POST',
      body: JSON.stringify({ material_id: materialId, mode, count })
    }),
  submitDictationAttempt: (sessionId: string, sentenceId: string, userText: string) =>
    request<DictationGrade>(`/api/dictation/sessions/${sessionId}/attempts`, {
      method: 'POST',
      body: JSON.stringify({ sentence_id: sentenceId, user_text: userText })
    }),
  dictationSessions: () =>
    request<DictationSessionSummary[]>('/api/dictation/sessions'),
  dictationSession: (sessionId: string) =>
    request<DictationSession & { attempts: unknown[] }>(`/api/dictation/sessions/${sessionId}`),
  deleteDictationSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/dictation/sessions/${sessionId}`, { method: 'DELETE' }),

  stats: () => request<Stats>('/api/stats'),

  recordings: (sentenceId: string) =>
    request<Recording[]>(
      `/api/recordings?sentence_id=${encodeURIComponent(sentenceId)}`
    ),
  uploadRecording: (formData: FormData) =>
    uploadRequest<Recording>('/api/recordings', formData),
  deleteRecording: (recordingId: string) =>
    request<{ ok: boolean }>(`/api/recordings/${recordingId}`, { method: 'DELETE' }),
  analyzeRecording: (recordingId: string) =>
    request<RecordingFeedback>(`/api/recordings/${recordingId}/analyze`, {
      method: 'POST'
    }),
  azureScoreRecording: (recordingId: string) =>
    request<AzureFeedback>(`/api/recordings/${recordingId}/azure-score`, {
      method: 'POST'
    }),

  studyPlan: () => request<StudyPlanResponse>('/api/plan'),
  startStudyPlan: (materialId: string | null) =>
    request<StudyPlanResponse>('/api/plan', {
      method: 'POST',
      body: JSON.stringify({ material_id: materialId })
    }),
  updateStudyPlan: (materialId: string | null) =>
    request<StudyPlanResponse>('/api/plan', {
      method: 'PATCH',
      body: JSON.stringify({ material_id: materialId })
    }),
  togglePlanTask: (kind: string, completed: boolean) =>
    request<StudyPlanResponse>(`/api/plan/tasks/${kind}`, {
      method: 'POST',
      body: JSON.stringify({ completed })
    }),
  resetStudyPlan: () => request<{ ok: boolean }>('/api/plan', { method: 'DELETE' })
}

export function mediaUrl(materialId: string): string {
  return `${API_BASE}/api/media/${materialId}`
}

export function recordingAudioUrl(recordingId: string): string {
  return `${API_BASE}/api/recordings/${recordingId}/audio`
}

export function sentenceClipUrl(sentenceId: string): string {
  return `${API_BASE}/api/sentences/${sentenceId}/clip`
}
