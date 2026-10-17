/**
 * 「估算值」徽标：标注按近似口径计算的指标（如桌面可用面积 / 折线走线长度）。
 * 精确计算或直接统计的指标不应使用该徽标。
 */
export function EstimateBadge({ title, className }: { title?: string; className?: string }) {
  return (
    <span
      title={title ?? '估算口径：按方案数据近似计算，非精确测量结果'}
      className={
        'inline-flex shrink-0 items-center rounded border border-dashed border-faint/70 px-1 py-px text-[10px] leading-none text-faint ' +
        (className ?? '')
      }
    >
      估算值
    </span>
  )
}
