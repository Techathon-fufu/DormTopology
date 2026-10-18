import { cn } from '@/lib/utils'

export function LogoMark({ className }: { className?: string }) {
  return <img src="/brand/dormtopology-mark.svg" className={cn('h-6 w-6', className)} alt="" aria-hidden="true" />
}
