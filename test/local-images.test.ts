import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import {
  linkLocalImage,
  resolveLocalImage
} from '../src/main/localImages'

describe('local image resolution', () => {
  let fixtureDir = ''

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'noteato-local-image-'))
  })

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true })
  })

  it('keeps the file link out of markdown while returning a renderable preview', async () => {
    const filePath = join(fixtureDir, 'preview.png')
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const linked = linkLocalImage(filePath)

    expect(linked.name).toBe('preview.png')
    expect(linked.url).toBe(pathToFileURL(filePath).href)

    await expect(resolveLocalImage(linked.url)).resolves.toBe(
      'data:image/png;base64,iVBORw=='
    )
  })

  it('rejects non-local and non-image URLs', async () => {
    await expect(resolveLocalImage('https://example.com/image.png')).rejects.toThrow(
      'Only local file URLs'
    )

    const filePath = join(fixtureDir, 'not-an-image.txt')
    await writeFile(filePath, 'plain text')
    await expect(resolveLocalImage(pathToFileURL(filePath).href)).rejects.toThrow(
      'Unsupported local image type'
    )
  })
})
