import type {
  AppSettings,
  DictationGrade,
  DictationMode,
  DictationProgress,
  DictationSession,
  DictationSessionDetail,
  DictationSessionSummary,
  DictionaryEntry,
  Health,
  LearningProgress,
  Material,
  MaterialRelated,
  ModuleState,
  PronunciationFeedback,
  Recording,
  RecordingFeedback,
  ReviewPreview,
  ReviewQueue,
  ReviewRateResult,
  ReviewSummary,
  Sentence,
  ShadowArchive,
  ShadowCoverage,
  ShadowReview,
  ShadowReviewSummary,
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
  deleteMaterial: (id: string, keepReviews = false) =>
    request<{ ok: boolean }>(
      `/api/materials/${id}${keepReviews ? '?keep_reviews=1' : ''}`,
      { method: 'DELETE' }
    ),
  materialRelated: (id: string) =>
    request<MaterialRelated>(`/api/materials/${id}/related`),
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
    tencent_speech_app_id?: string
    tencent_speech_secret_id?: string
    tencent_speech_secret_key?: string
    llm_base_url?: string
    llm_api_key?: string
    llm_model?: string
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
  reviewQueue: (limit = 20, ahead = false) =>
    request<ReviewQueue>(
      `/api/reviews/queue?limit=${limit}${ahead ? '&ahead=1' : ''}`
    ),
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
    request<DictationSessionDetail>(`/api/dictation/sessions/${sessionId}`),
  dictationActive: () =>
    request<DictationSession | null>('/api/dictation/active'),
  saveDictationPosition: (
    sessionId: string,
    index: number,
    draftText?: string
  ) =>
    request<{ ok: boolean; last_index: number }>(
      `/api/dictation/sessions/${sessionId}/position`,
      {
        method: 'PATCH',
        body: JSON.stringify({ index, draft_text: draftText })
      }
    ),
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
  pronunciationScoreRecording: (recordingId: string) =>
    request<PronunciationFeedback>(
      `/api/recordings/${recordingId}/pronunciation-score`,
      { method: 'POST' }
    ),
  azureScoreRecording: (recordingId: string) =>
    request<PronunciationFeedback>(`/api/recordings/${recordingId}/azure-score`, {
      method: 'POST'
    }),

  shadowCoverage: (materialId: string) =>
    request<ShadowCoverage>(
      `/api/shadowing/${encodeURIComponent(materialId)}/coverage`
    ),
  generateShadowReview: (materialId: string) =>
    request<ShadowReview>(
      `/api/shadowing/${encodeURIComponent(materialId)}/review`,
      { method: 'POST' }
    ),
  shadowReviews: (materialId: string) =>
    request<ShadowReviewSummary[]>(
      `/api/shadowing/${encodeURIComponent(materialId)}/reviews`
    ),
  shadowArchives: () =>
    request<ShadowArchive[]>('/api/shadowing/archives'),
  shadowReview: (reviewId: string) =>
    request<ShadowReview>(
      `/api/shadowing/reviews/${encodeURIComponent(reviewId)}`
    ),
  deleteShadowReview: (reviewId: string) =>
    request<{ ok: boolean }>(
      `/api/shadowing/reviews/${encodeURIComponent(reviewId)}`,
      { method: 'DELETE' }
    ),

  progress: (module: 'player' | 'shadowing', materialId: string) =>
    request<LearningProgress | null>(`/api/progress/${module}/${materialId}`),
  progressList: (module: 'player' | 'shadowing') =>
    request<LearningProgress[]>(`/api/progress/${module}`),
  saveProgress: (
    module: 'player' | 'shadowing',
    materialId: string,
    sentenceId: string,
    sentenceIdx: number,
    position?: number | null
  ) =>
    request<LearningProgress>(`/api/progress/${module}/${materialId}`, {
      method: 'PUT',
      body: JSON.stringify({
        sentence_id: sentenceId,
        sentence_idx: sentenceIdx,
        position
      })
    }),
  moduleState: <T = Record<string, unknown>>(module: string) =>
    request<ModuleState<T> | null>(`/api/module-state/${module}`),
  saveModuleState: <T = Record<string, unknown>>(
    module: string,
    state: T
  ) =>
    request<ModuleState<T>>(`/api/module-state/${module}`, {
      method: 'PUT',
      body: JSON.stringify({ state })
    }),
  dictationProgress: (materialId: string, mode: DictationMode) =>
    request<DictationProgress>(
      `/api/dictation/progress?material_id=${encodeURIComponent(materialId)}&mode=${mode}`
    ),

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
