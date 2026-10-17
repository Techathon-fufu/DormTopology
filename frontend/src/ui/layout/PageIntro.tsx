import type { ReactNode } from 'react'

export function PageIntro({ step, title, description, children }: { step: string; title: ReactNode; description: string; children?: ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6 print:hidden"><div className="min-w-0"><p className="text-xs font-medium tracking-wide text-primary">{step}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">{description}</p></div>{children ? <div className="max-w-full self-center">{children}</div> : null}</div>
}
