import type { BlockAttrs, BlockType } from '@notion-alt/shared'

/** Entries of the "/" menu (#133). */
export type SlashOption =
  | {
      key: string
      label: string
      hint: string
      terms: string[]
      kind: 'type'
      type: BlockType
      attrs: BlockAttrs
    }
  | { key: string; label: string; hint: string; terms: string[]; kind: 'file' | 'page-link' }

export const SLASH_OPTIONS: SlashOption[] = [
  {
    key: 'text',
    label: 'Text',
    hint: 'Absatz',
    terms: ['text', 'absatz', 'paragraph'],
    kind: 'type',
    type: 'paragraph',
    attrs: {},
  },
  {
    key: 'h1',
    label: 'Überschrift 1',
    hint: '#',
    terms: ['überschrift', 'heading', 'h1', 'titel'],
    kind: 'type',
    type: 'heading',
    attrs: { level: 1 },
  },
  {
    key: 'h2',
    label: 'Überschrift 2',
    hint: '##',
    terms: ['überschrift', 'heading', 'h2'],
    kind: 'type',
    type: 'heading',
    attrs: { level: 2 },
  },
  {
    key: 'h3',
    label: 'Überschrift 3',
    hint: '###',
    terms: ['überschrift', 'heading', 'h3'],
    kind: 'type',
    type: 'heading',
    attrs: { level: 3 },
  },
  {
    key: 'bullet',
    label: 'Aufzählung',
    hint: '-',
    terms: ['aufzählung', 'liste', 'bullet', 'list'],
    kind: 'type',
    type: 'list_item',
    attrs: { list: 'bullet', indent: 0 },
  },
  {
    key: 'ordered',
    label: 'Nummerierte Liste',
    hint: '1.',
    terms: ['nummeriert', 'liste', 'numbered', 'ordered', 'list'],
    kind: 'type',
    type: 'list_item',
    attrs: { list: 'ordered', indent: 0 },
  },
  {
    key: 'todo',
    label: 'To-do',
    hint: '[]',
    terms: ['todo', 'to-do', 'aufgabe', 'checkbox', 'kontrollkästchen'],
    kind: 'type',
    type: 'todo',
    attrs: {},
  },
  {
    key: 'toggle',
    label: 'Toggle',
    hint: 'Einklappbar',
    terms: ['toggle', 'einklappen', 'aufklappen', 'details'],
    kind: 'type',
    type: 'toggle',
    attrs: {},
  },
  {
    key: 'callout',
    label: 'Hinweis (Callout)',
    hint: 'Kasten',
    terms: ['callout', 'hinweis', 'kasten', 'info'],
    kind: 'type',
    type: 'callout',
    attrs: { icon: '💡' },
  },
  {
    key: 'quote',
    label: 'Zitat',
    hint: '>',
    terms: ['zitat', 'quote'],
    kind: 'type',
    type: 'quote',
    attrs: {},
  },
  {
    key: 'code',
    label: 'Code',
    hint: '```',
    terms: ['code'],
    kind: 'type',
    type: 'code',
    attrs: {},
  },
  {
    key: 'divider',
    label: 'Trenner',
    hint: '---',
    terms: ['trenner', 'linie', 'divider', 'trennlinie'],
    kind: 'type',
    type: 'divider',
    attrs: {},
  },
  {
    key: 'file',
    label: 'Bild/Datei',
    hint: 'Anhang',
    terms: ['bild', 'datei', 'anhang', 'image', 'file'],
    kind: 'file',
  },
  {
    key: 'page',
    label: 'Seitenlink',
    hint: '[[',
    terms: ['seite', 'link', 'seitenlink', 'page'],
    kind: 'page-link',
  },
]

/** Options matching the typed filter: label or search term starts with or contains it. */
export function filterSlashOptions(query: string): SlashOption[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return SLASH_OPTIONS
  return SLASH_OPTIONS.filter(
    (option) =>
      option.label.toLocaleLowerCase().includes(needle) ||
      option.terms.some((term) => term.startsWith(needle)),
  )
}

/** Whether a "/" just typed opens the menu: at the start of the block or after a space. */
export function opensSlashMenu(textBeforeCaret: string): boolean {
  return textBeforeCaret === '/' || /\s\/$/.test(textBeforeCaret)
}
