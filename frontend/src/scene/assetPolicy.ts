/** The retired source directory is never a legal runtime asset location. */
export function assertAssetUrl(url: string): string {
  let decoded = url.split(/[?#]/, 1)[0]
  for (let i = 0; i < 8; i++) {
    let next: string
    try { next = decodeURIComponent(decoded) } catch { break }
    if (next === decoded) break
    decoded = next
  }
  if (/(^|[/\\])objects([/\\]|$)/i.test(decoded)) {
    throw new Error('禁止引用 objects/ 中的资产；请使用 Prefabmodel/ 对应的正式运行时模型')
  }
  return url
}
