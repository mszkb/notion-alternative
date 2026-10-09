import { describe, expect, it } from 'vitest'
import { addMemberInputSchema, roleAtLeast, workspaceSchema } from './workspace'

describe('workspace roles (ADR 0014)', () => {
  it('ranks reader < commenter < editor < owner', () => {
    expect(roleAtLeast('owner', 'editor')).toBe(true)
    expect(roleAtLeast('editor', 'editor')).toBe(true)
    expect(roleAtLeast('commenter', 'editor')).toBe(false)
    expect(roleAtLeast('reader', 'commenter')).toBe(false)
  })

  it('accepts workspaces of servers that know no roles', () => {
    const workspace = {
      id: '0b9f2f7e-6a43-4c55-8f4a-1c2d3e4f5a6b',
      name: 'Privat',
      ownerId: '1c9f2f7e-6a43-4c55-8f4a-1c2d3e4f5a6b',
      createdAt: '2026-10-09T00:00:00.000Z',
    }
    expect(workspaceSchema.parse(workspace).role).toBeUndefined()
  })

  it('normalizes the e-mail address of an invitation', () => {
    expect(addMemberInputSchema.parse({ email: ' Anna@Example.com ', role: 'editor' })).toEqual({
      email: 'anna@example.com',
      role: 'editor',
    })
    expect(
      addMemberInputSchema.safeParse({ email: 'anna@example.com', role: 'admin' }).success,
    ).toBe(false)
  })
})
