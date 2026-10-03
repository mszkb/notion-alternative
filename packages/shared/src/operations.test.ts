import { describe, expect, it } from 'vitest'
import { validateOperationPayload } from './operations'

const ID = '33333333-3333-4333-8333-333333333333'

describe('validateOperationPayload', () => {
  it('accepts the payloads the client writes', () => {
    expect(
      validateOperationPayload('document', 'create', {
        parentId: null,
        title: '',
        sortKey: 'a0',
        favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBeNull()
    expect(validateOperationPayload('document', 'update', { favorite: true })).toBeNull()
    expect(validateOperationPayload('block', 'update', { content: 'x', attrs: {} })).toBeNull()
    expect(validateOperationPayload('block', 'move', { sortKey: 'a1' })).toBeNull()
    expect(
      validateOperationPayload('document_tag', 'create', { documentId: ID, tagId: ID }),
    ).toBeNull()
    expect(validateOperationPayload('tag', 'delete', {})).toBeNull()
  })

  it('rejects unknown fields, empty updates and unsupported kinds', () => {
    expect(validateOperationPayload('block', 'update', { content: 'x', revision: 3 })).toMatch(
      /revision|Unrecognized/,
    )
    expect(validateOperationPayload('document', 'update', {})).toMatch(/empty update/)
    expect(validateOperationPayload('tag', 'move', {})).toMatch(/not supported/)
    expect(validateOperationPayload('document_tag', 'update', {})).toMatch(/not supported/)
    expect(validateOperationPayload('block', 'delete', { x: 1 })).not.toBeNull()
    expect(
      validateOperationPayload('block', 'create', {
        documentId: ID,
        type: 'video',
        content: '',
        attrs: {},
        sortKey: 'a0',
      }),
    ).not.toBeNull()
  })
})
