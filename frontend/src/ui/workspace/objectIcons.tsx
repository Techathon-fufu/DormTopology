import {
  BookOpen,
  Box,
  Coffee,
  Keyboard,
  Lamp,
  Laptop,
  Monitor,
  Mouse,
  Package,
  Plug,
  Printer,
  PcCase,
  Smartphone,
} from 'lucide-react'
import type { ObjectCategory, PrimitiveShape } from '@/types/project'
import { cn } from '@/lib/utils'

const SHAPE_ICONS: Partial<Record<PrimitiveShape, typeof Laptop>> = {
  laptop: Laptop,
  monitor: Monitor,
  keyboard: Keyboard,
  mouse: Mouse,
  lamp: Lamp,
  books: BookOpen,
  book: BookOpen,
  printer: Printer,
  computerTower: PcCase,
  powerAdapter: Plug,
  thermos: Coffee,
  cup: Coffee,
  storageBox: Box,
  powerStrip: Plug,
}

const CATEGORY_ICONS: Record<ObjectCategory, typeof Laptop> = {
  electrical: Plug,
  nonElectrical: BookOpen,
  storage: Box,
}

export function ObjectIcon({
  shape,
  category,
  className,
}: {
  shape?: PrimitiveShape
  category: ObjectCategory
  className?: string
}) {
  const Icon = (shape ? SHAPE_ICONS[shape] : undefined) ?? CATEGORY_ICONS[category] ?? Package
  return <Icon className={cn('h-4 w-4', className)} />
}

export { Package, Smartphone }
