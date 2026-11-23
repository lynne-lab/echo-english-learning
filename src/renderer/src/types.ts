export interface Material {
  id: string
  title: string
  source_type: 'local' | 'url'
  source_url: string | null
  file_path: string | null
  media_type: 'video' | 'audio'
  duration: number | null
  status: 'processing' | 'ready' | 'error'
  stage: string | null
  progress: number
  error: string | null
  language: string
  created_at: string
  updated_at: string
  sentence_count: number
}

export interface Sentence {
  id: string
  material_id: string
  idx: number
  start: number
  end: number
  text: string
  original_text: string | null
  words_json: string | null
}

export interface DictionaryEntry {
  found: boolean
  word: string
  lemma: string
  phonetic: string | null
  translation: string | null
  definition: string | null
  source: string | null
  in_wordbook: boolean
  word_id: string | null
}

export interface Occurrence {
  id: string
  sentence_id: string
  material_id: string
  material_title: string
  start: number
  end: number
  context: string
  surface?: string | null
}

export interface WordReviewInfo {
  state_name: string
  due: string | null
  due_label: string | null
  reps: number
  lapses: number
}

export interface WordEntry {
  id: string
  lemma: string
  phonetic: string | null
  translation: string | null
  definition: string | null
  created_at: string
  review?: WordReviewInfo
  occurrences: Occurrence[]
}

export interface ReviewSummary {
  due_reviews: number
  new_total: number
  new_today: number
  new_available: number
  daily_new_limit: number
  reviews_today: number
  total_words: number
  next_due: string | null
  next_due_label: string | null
}

export interface ReviewOccurrence {
  word_id: string
  context: string
  surface: string | null
  material_id: string
  material_title: string | null
  start: number
  end: number
}

export type ReviewStateName = 'new' | 'learning' | 'review' | 'relearning'

export interface ReviewCard {
  card_id: number
  word_id: string
  lemma: string
  phonetic: string | null
  translation: string | null
  definition: string | null
  state: number
  state_name: ReviewStateName
  due: string
  last_review: string | null
  introduced_at: string | null
  reps: number
  lapses: number
  due_label: string | null
  occurrence: ReviewOccurrence | null
}

export interface ReviewQueue {
  cards: ReviewCard[]
  summary: ReviewSummary
}

export interface ReviewPreview {
  word_id: string
  state_name: string
  due: string
  previews: Array<{
    rating: number
    label: string
    interval: string
    due: string
  }>
}

export interface ReviewRateResult {
  word_id: string
  rating: number
  due: string
  interval: string
  state_name: string
  summary: ReviewSummary
}

export type DictationMode = 'full' | 'cloze'

export interface ClozeSegment {
  text: string
  blank: boolean
}

export interface DictationItem {
  sentence_id: string
  idx: number
  start: number
  end: number
  text: string
  cloze_segments?: ClozeSegment[]
}

export interface DictationProgress {
  total: number
  completed: number
  next_idx: number
  restart: boolean
}

export interface LearningProgress {
  module: string
  material_id: string
  sentence_id: string | null
  sentence_idx: number | null
  position: number | null
  updated_at: string
}

export interface ModuleState<T = Record<string, unknown>> {
  module: string
  state: T
  updated_at: string
}

export interface DictationSessionSummary {
  id: string
  material_id: string
  material_title: string
  mode: DictationMode
  item_count: number
  completed_count: number
  correct_count: number
  word_total: number
  scored_total: number
  word_correct: number
  accuracy: number
  created_at: string
  completed_at: string | null
  last_index: number
  last_active_at: string | null
  completed: boolean
}

export interface DictationSession extends DictationSessionSummary {
  items: DictationItem[]
}

export interface DictationAttemptDetail {
  id: string
  session_id: string
  material_id: string
  sentence_id: string
  sentence_text: string
  user_text: string
  accuracy: number
  word_total: number
  word_correct: number
  scored_total: number
  diff: { tokens: DictationToken[] }
  errors: DictationErrors
  grade: DictationGrade
  created_at: string
  updated_at: string
}

export interface DictationSessionDetail extends DictationSession {
  attempts: DictationAttemptDetail[]
}

export type DictationTokenKind = 'correct' | 'typo' | 'missing' | 'extra' | 'wrong'

export interface DictationToken {
  kind: DictationTokenKind
  expected: string | null
  actual: string | null
  similarity?: number
}

export interface DictationErrors {
  missing: number
  extra: number
  typo: number
  wrong: number
  punctuation: number
}

export interface DictationGrade {
  accuracy: number
  word_total: number
  word_correct: number
  scored_total: number
  errors: DictationErrors
  tokens: DictationToken[]
  punctuation_ok: boolean
  expected_punctuation: string
  actual_punctuation: string
  expected_text: string
  session: DictationSessionSummary
}

export interface RecordingFeedback {
  accuracy: number
  word_total: number
  word_correct: number
  scored_total: number
  errors: DictationErrors
  tokens: DictationToken[]
  punctuation_ok: boolean
  expected_punctuation: string
  actual_punctuation: string
  recognized_text: string
  target_duration: number
  recording_duration: number
  rate_ratio: number
}

export type PronunciationProvider = 'tencent' | 'azure'

export interface PronunciationPhoneme {
  phoneme: string
  score: number | null
}

export interface PronunciationWord {
  word: string
  accuracy: number | null
  error_type: string | null
  phonemes: PronunciationPhoneme[]
}

export interface PronunciationFeedback {
  provider?: PronunciationProvider | null
  recognized_text: string
  pron_score: number | null
  accuracy_score: number | null
  fluency_score: number | null
  completeness_score: number | null
  prosody_score: number | null
  words: PronunciationWord[]
  region: string
  scored_at: string
}

// Kept for older imports; both names describe the same payload.
export type AzurePhoneme = PronunciationPhoneme
export type AzureWord = PronunciationWord
export type AzureFeedback = PronunciationFeedback

export interface Recording {
  id: string
  material_id: string
  sentence_id: string
  duration: number
  mime_type: string | null
  created_at: string
  recognized_text: string | null
  accuracy: number | null
  feedback: RecordingFeedback | null
  pronunciation: PronunciationFeedback | null
  azure: PronunciationFeedback | null
}

export interface StatsReviewStates {
  new: number
  learning: number
  review: number
  relearning: number
}

export interface StatsDay {
  date: string
  label: string
  reviews: number
  dictations: number
}

export interface StatsHeatCell {
  date: string
  weekday: number
  count: number
}

export interface StatsForecastDay {
  date: string
  label: string
  count: number
}

export interface StatsRecentSession {
  id: string
  material_title: string
  mode: DictationMode
  item_count: number
  completed_count: number
  accuracy: number
  created_at: string
  completed: boolean
}

export interface Stats {
  streak: number
  studied_today: boolean
  today: { reviews: number; dictations: number }
  totals: {
    words: number
    materials: number
    sentences: number
    occurrences: number
    dictation_sessions: number
  }
  retention: number | null
  dictation_accuracy: number | null
  dictation_attempts: number
  review_states: StatsReviewStates
  heatmap: StatsHeatCell[]
  daily: StatsDay[]
  forecast: StatsForecastDay[]
  errors: DictationErrors
  recent_sessions: StatsRecentSession[]
}

export interface Health {
  ok: boolean
  version: string
  whisper_model: string
  device: string
  model_loaded: string | null
  dictionary_entries: number
  ffmpeg: boolean
}

export interface WhisperModel {
  id: string
  label: string
  size: string
  note: string
}

export interface AppSettings {
  whisper_model: string
  daily_new_limit: number
  azure_configured: boolean
  azure_speech_region: string
  azure_key_masked: string | null
  tencent_configured: boolean
  tencent_app_id: string
  tencent_secret_id_masked: string | null
  tencent_secret_key_masked: string | null
  pronunciation_provider: PronunciationProvider | null
  pronunciation_configured: boolean
  models: WhisperModel[]
}

export interface AppInfo {
  version: string
  dataDir: string
  sidecarUrl: string
  platform: string
}

export type PlanTaskKind = 'review' | 'listening' | 'dictation' | 'shadowing'

export interface PlanCatalogItem {
  title: string
  accent: string
  length: string
  level: string
  note: string
  homepage: string | null
}

export interface PlanPhase {
  key: string
  title: string
  subtitle: string
  start_week: number
  end_week: number
  accent: string
  focus: string
  goal: string
  materials: PlanCatalogItem[]
}

export interface PlanTask {
  kind: PlanTaskKind
  title: string
  minutes: number
  description: string
  completed: boolean
  route: string
  action_label: string
}

export interface PlanMaterialOption {
  id: string
  title: string
  status: Material['status']
  media_type: Material['media_type']
  duration: number | null
  sentence_count: number
}

export interface PlanMaterial extends PlanMaterialOption {}

export interface PlanWeekDay {
  date: string
  label: string
  completed: number
  total: number
  is_today: boolean
}

export interface PlanProgress {
  completed_today: number
  completed_total: number
  active_days: number
  full_days: number
  streak: number
  completion_rate: number
  week_days: PlanWeekDay[]
}

export interface StudyPlan {
  id: string
  start_date: string
  end_date: string
  week_number: number
  day_index: number
  total_days: number
  finished: boolean
  phase: PlanPhase
  material: PlanMaterial | null
  tasks: PlanTask[]
  progress: PlanProgress
}

export interface StudyPlanResponse {
  plan: StudyPlan | null
  phases: PlanPhase[]
  materials: PlanMaterialOption[]
}
