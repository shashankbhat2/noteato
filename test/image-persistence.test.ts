import { describe, expect, it } from 'vitest'
import { imagesForMarkdown, restoreImageWidths } from '../src/shared/imagePersistence'

describe('image width persistence', () => {
  it('round-trips preview width without changing the live source URL', () => {
    const live = [
      {
        id: 'image-1',
        type: 'image',
        props: { url: 'file:///Pictures/launch.png', previewWidth: 524 },
        children: []
      }
    ]

    const saved = imagesForMarkdown(live)
    expect(saved[0].props.url).toBe('file:///Pictures/launch.png#noteato-width=524')
    expect(live[0].props.url).toBe('file:///Pictures/launch.png')

    const restored = restoreImageWidths(saved)
    expect(restored[0].props).toMatchObject({
      url: 'file:///Pictures/launch.png',
      previewWidth: 524
    })
  })

  it('preserves an existing URL fragment and nested image blocks', () => {
    const blocks = [
      {
        type: 'paragraph',
        props: {},
        children: [
          {
            type: 'image',
            props: { url: 'https://example.com/image.png#section', previewWidth: 320 },
            children: []
          }
        ]
      }
    ]

    const saved = imagesForMarkdown(blocks)
    expect(saved[0].children[0].props.url).toBe(
      'https://example.com/image.png#section&noteato-width=320'
    )
    expect(restoreImageWidths(saved)[0].children[0].props).toMatchObject({
      url: 'https://example.com/image.png#section',
      previewWidth: 320
    })
  })
})
