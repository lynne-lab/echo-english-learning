import type { ReactElement, ReactNode } from 'react'
import type { DictationErrors, DictationToken } from '../types'

export const ERROR_LABELS: Record<keyof DictationErrors, string> = {
  missing: '漏词',
  typo: '拼写',
  extra: '多写',
  wrong: '听错',
  punctuation: '标点'
}

const WORD_PATTERN = /[A-Za-z]+(?:['’\-][A-Za-z]+)*|\d+(?:[.,]\d+)*/g

export function DiffedSentence({
  text,
  tokens,
  onWordClick
}: {
  text: string
  tokens: DictationToken[]
  onWordClick?: (word: string) => void
}): ReactElement {
  const expectedTokens = tokens.filter((token) => token.expected !== null)
  const parts: ReactNode[] = []
  let tokenIndex = 0
  let lastIndex = 0
  let match: RegExpExecArray | null
  const pattern = new RegExp(WORD_PATTERN.source, 'g')

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`gap-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>
      )
    }
    const token = expectedTokens[tokenIndex]
    tokenIndex += 1
    const kind = token?.kind ?? 'correct'
    const titleParts: string[] = []
    if (token && (token.kind === 'typo' || token.kind === 'wrong')) {
      titleParts.push(`你写的是：${token.actual}`)
    }
    if (onWordClick) titleParts.push('点击查看释义、加入生词本')
    const title = titleParts.length ? titleParts.join(' · ') : undefined
    const className = `diff-token diff-${kind}${onWordClick ? ' diff-clickable' : ''}`
    const word = match[0]
    parts.push(
      onWordClick ? (
        <button
          type="button"
          key={`word-${match.index}`}
          className={className}
          title={title}
          onClick={() => onWordClick(word)}
        >
          {word}
        </button>
      ) : (
        <span key={`word-${match.index}`} className={className} title={title}>
          {word}
        </span>
      )
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`tail-${lastIndex}`}>{text.slice(lastIndex)}</span>)
  }

  return <p className="diff-sentence">{parts}</p>
}

export function ErrorChips({ errors }: { errors: DictationErrors }): ReactElement {
  const entries = (Object.keys(ERROR_LABELS) as Array<keyof DictationErrors>).filter(
    (key) => errors[key] > 0
  )
  if (entries.length === 0) {
    return <span className="error-chip perfect">无错误</span>
  }
  return (
    <div className="error-chips">
      {entries.map((key) => (
        <span className={`error-chip ${key}`} key={key}>
          {ERROR_LABELS[key]} {errors[key]}
        </span>
      ))}
    </div>
  )
}
