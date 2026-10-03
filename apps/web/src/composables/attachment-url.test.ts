import { describe, expect, it } from 'vitest'
import { blobType } from './attachment-url'

describe('blobType', () => {
  it('keeps raster image types', () => {
    expect(blobType('image/png')).toBe('image/png')
    expect(blobType('image/webp')).toBe('image/webp')
  })

  it.each(['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', undefined])(
    'never lets %s be rendered from a blob URL',
    (type) => {
      expect(blobType(type)).toBe('application/octet-stream')
    },
  )
})
