import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export interface LinkedImage {
  name: string
  url: string
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp'
}

export function linkLocalImage(filePath: string): LinkedImage {
  const extension = extname(filePath).toLowerCase()
  if (!IMAGE_MIME_TYPES[extension]) throw new Error('Unsupported local image type')
  return { name: basename(filePath), url: pathToFileURL(filePath).href }
}

/** The markdown keeps fileUrl; only the renderer preview becomes a data URL. */
export async function resolveLocalImage(fileUrl: string): Promise<string> {
  const source = new URL(fileUrl)
  if (source.protocol !== 'file:') throw new Error('Only local file URLs can be previewed')

  const filePath = fileURLToPath(source)
  const mime = IMAGE_MIME_TYPES[extname(filePath).toLowerCase()]
  if (!mime) throw new Error('Unsupported local image type')
  const contents = await readFile(filePath)
  return `data:${mime};base64,${contents.toString('base64')}`
}
