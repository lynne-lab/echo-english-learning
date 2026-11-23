export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--'
  }
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`
}

export function formatDate(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN')
}

/**
 * Whisper's sentence end can land slightly before the last phoneme decays.
 * Add a short tail when stopping playback, but never run into the next
 * sentence (or past the end of the media).
 */
export function sentencePlaybackEnd(
  sentence: { start: number; end: number },
  nextSentence: { start: number } | null | undefined,
  mediaDuration?: number | null,
  tail = 0.35
): number {
  const limit = nextSentence
    ? nextSentence.start - 0.05
    : mediaDuration && Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration - 0.02
      : Number.POSITIVE_INFINITY
  return Math.min(sentence.end + tail, Math.max(sentence.end, limit))
}

let englishVoice: SpeechSynthesisVoice | null | undefined

export function speakWord(word: string): void {
  if (!('speechSynthesis' in window)) return
  if (englishVoice === undefined) {
    const voices = window.speechSynthesis.getVoices()
    englishVoice =
      voices.find((voice) => /en-US/i.test(voice.lang) && /natural|google|zira|aria/i.test(voice.name)) ??
      voices.find((voice) => /^en/i.test(voice.lang)) ??
      null
  }
  const utterance = new SpeechSynthesisUtterance(word)
  utterance.lang = 'en-US'
  utterance.rate = 0.9
  if (englishVoice) utterance.voice = englishVoice
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

export function stripWord(raw: string): string {
  return raw.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '出了点问题，请重试'
}
