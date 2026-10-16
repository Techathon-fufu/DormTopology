import { cn } from '@/lib/utils'

/** 品牌标记：宿舍床梯抽象图形 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-6 w-6', className)} aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="#0F9D8A" />
      <rect x="5.5" y="5.6" width="13" height="2.2" rx="1.1" fill="#fff" />
      <rect x="5.5" y="10.6" width="8.5" height="2.2" rx="1.1" fill="#fff" opacity="0.85" />
      <rect x="5.5" y="15.4" width="13" height="2.4" rx="1.2" fill="#fff" opacity="0.7" />
    </svg>
  )
}
