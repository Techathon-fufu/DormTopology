import * as React from 'react'
import { Image as ImageIcon, Upload, X, RotateCcw, Crop, Sparkles } from 'lucide-react'
import { Button } from '@/ui/kit/button'
import { Input, Label, Separator } from '@/ui/kit/primitives'

export interface PhotoModelDraftProps {
  disabled?: boolean
  onClose: () => void
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

export function PhotoModelDraft({ disabled = false, onClose }: PhotoModelDraftProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [name, setName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const clearFile = React.useCallback(() => {
    setFile(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  const pick = React.useCallback((next: File | null) => {
    if (!next) return
    if (!ACCEPTED.includes(next.type)) {
      setError('仅支持 JPEG / PNG / WebP 格式')
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    if (next.size > MAX_BYTES) {
      setError('图片大小不能超过 10MB')
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setError(null)
    setFile(next)
    setName((prev) => prev || next.name.replace(/\.[^.]+$/, ''))
  }, [])

  return (
    <section aria-label="照片生成模型" className="flex min-h-0 w-full flex-1 flex-col bg-surface text-foreground">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="返回物体" disabled={disabled}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="text-sm font-medium">返回物体</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-2.5 py-2 text-[12px] text-primary">
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>界面预览 · 生成服务待接入</span>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-white">
          {previewUrl ? (
            <img src={previewUrl} alt="照片预览" className="h-40 w-full object-contain" />
          ) : (
            <div className="flex h-40 w-full flex-col items-center justify-center gap-2 text-faint">
              <ImageIcon className="h-8 w-8" aria-hidden="true" />
              <span className="text-[12px]">尚未选择图片</span>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          id="photo-model-draft-file"
          type="file"
          aria-label="选择照片"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = '' }}
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {file ? '重新选择' : '选择照片'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || !file}
            onClick={clearFile}
            aria-label="清除图片"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            清除
          </Button>
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}

        <Separator />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="photo-model-draft-name">模型名称</Label>
          <Input
            id="photo-model-draft-name"
            value={name}
            disabled={disabled}
            placeholder="请输入名称"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-dashed border-border px-2.5 py-2 text-[12px] text-muted-foreground">
          <Crop className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>后续将支持框选物体、确认尺寸，再生成外观；目前仅支持本地照片预览。</span>
        </div>
      </div>

      <div className="border-t border-border p-3">
        <Button variant="primary" size="md" className="w-full" disabled>
          生成模型（待接入）
        </Button>
      </div>
    </section>
  )
}
