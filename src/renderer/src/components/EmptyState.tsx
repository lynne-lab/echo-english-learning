import type { ReactElement, ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  children?: ReactNode
}

export default function EmptyState({
  icon,
  title,
  description,
  children
}: EmptyStateProps): ReactElement {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  )
}
