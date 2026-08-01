const WIDTH_MARKER = 'noteato-width='

function splitWidthMarker(url: string): { cleanUrl: string; width?: number } {
  const hashAt = url.indexOf('#')
  if (hashAt === -1) return { cleanUrl: url }

  const base = url.slice(0, hashAt)
  const fragments = url.slice(hashAt + 1).split('&')
  let width: number | undefined
  const kept = fragments.filter((fragment) => {
    if (!fragment.startsWith(WIDTH_MARKER)) return true
    const parsed = Number(fragment.slice(WIDTH_MARKER.length))
    if (Number.isFinite(parsed) && parsed > 0) width = Math.round(parsed)
    return false
  })
  return { cleanUrl: kept.length > 0 ? `${base}#${kept.join('&')}` : base, width }
}

function urlWithWidth(url: string, width: number): string {
  const { cleanUrl } = splitWidthMarker(url)
  const separator = cleanUrl.includes('#') ? '&' : '#'
  return `${cleanUrl}${separator}${WIDTH_MARKER}${Math.round(width)}`
}

/** Clone editor blocks and encode image preview widths into their saved URLs. */
export function imagesForMarkdown<B>(blocks: B[]): B[] {
  return blocks.map((value) => {
    const block = value as Record<string, unknown>
    const children = Array.isArray(block.children) ? imagesForMarkdown(block.children) : block.children
    if (block.type !== 'image') {
      return { ...block, ...(Array.isArray(children) ? { children } : {}) } as B
    }

    const props = (block.props ?? {}) as Record<string, unknown>
    const url = String(props.url ?? '')
    const width = Number(props.previewWidth)
    return {
      ...block,
      ...(Array.isArray(children) ? { children } : {}),
      props: {
        ...props,
        url: url && Number.isFinite(width) && width > 0 ? urlWithWidth(url, width) : url
      }
    } as B
  })
}

/** Restore image width metadata after Markdown has been parsed into blocks. */
export function restoreImageWidths<B>(blocks: B[]): B[] {
  for (const value of blocks) {
    const block = value as Record<string, unknown>
    if (block.type === 'image') {
      const props = (block.props ?? {}) as Record<string, unknown>
      const { cleanUrl, width } = splitWidthMarker(String(props.url ?? ''))
      block.props = { ...props, url: cleanUrl, ...(width ? { previewWidth: width } : {}) }
    }
    if (Array.isArray(block.children)) restoreImageWidths(block.children)
  }
  return blocks
}
