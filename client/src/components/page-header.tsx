import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  actions,
  badge,
}: {
  title: string
  description?: string
  actions?: ReactNode
  badge?: ReactNode
}) {
  return (
    <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6 pb-6 mb-6 border-b border-border/60">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {badge && <div className="inline-flex items-center">{badge}</div>}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground/90 max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  )
}
