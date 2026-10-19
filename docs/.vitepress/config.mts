// Documentation site (ADR 0025): renders docs/ as it is, without front matter, so the files
// stay readable on GitHub. Sidebar titles come from each file's first heading.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type DefaultTheme } from 'vitepress'

const REPO = 'https://github.com/mszkb/notion-alternative'
const DOCS_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

function title(file: string): string {
  const heading = readFileSync(join(DOCS_DIR, file), 'utf8').match(/^# (.+)$/m)
  return heading ? heading[1].trim() : file
}

/** Sidebar items of a folder: `first` in this order, the remaining files sorted by name. */
function items(folder: string, first: string[] = []): DefaultTheme.SidebarItem[] {
  const files = readdirSync(join(DOCS_DIR, folder))
    .filter((name) => name.endsWith('.md') && name !== 'README.md' && !first.includes(name))
    .sort()
  return [...first, ...files].map((name) => ({
    text: title(`${folder}/${name}`),
    link: `/${folder}/${name.replace(/\.md$/, '')}`,
  }))
}

export default defineConfig({
  lang: 'de-DE',
  title: 'Notion-Alternative',
  description: 'Self-hosted, local-first Wissens- und Dokumentenplattform',
  // GitHub Pages serves the site below /<repo>/ (.github/workflows/docs.yml).
  base: process.env.DOCS_BASE ?? '/',
  cleanUrls: true,
  rewrites: {
    'README.md': 'index.md',
    'adr/README.md': 'adr/index.md',
  },
  srcExclude: ['**/node_modules/**'],
  // Placeholder links in quoted UI texts, e.g. `(…/docs/privacy/telemetry.md)`.
  ignoreDeadLinks: [(url) => decodeURI(url).includes('…')],
  markdown: {
    config(md) {
      // Links that leave docs/ (source files, ROADMAP.md) or point to non-Markdown files
      // open on GitHub instead of ending as dead links.
      md.core.ruler.push('repo-links', (state) => {
        const page = state.env.relativePath as string | undefined
        if (!page) return
        for (const block of state.tokens) {
          for (const token of block.children ?? []) {
            if (token.type !== 'link_open') continue
            const href = token.attrGet('href')
            if (!href || /^([a-z]+:|#|\/)/i.test(href)) continue
            const [path, hash] = href.split('#')
            const target = posix.normalize(posix.join('docs', posix.dirname(page), path))
            if (target.startsWith('docs/') && target.endsWith('.md')) {
              // README.md is the folder's index page (rewrites above).
              if (posix.basename(target) === 'README.md') {
                token.attrSet('href', href.replace(/README\.md(?=#|$)/, 'index.md'))
              }
              continue
            }
            const kind = target.endsWith('/') || !posix.extname(target) ? 'tree' : 'blob'
            token.attrSet('href', `${REPO}/${kind}/main/${target}${hash ? `#${hash}` : ''}`)
          }
        }
      })
    },
  },
  themeConfig: {
    nav: [
      { text: 'Anleitungen', link: '/user/webhosting' },
      { text: 'Betrieb', link: '/operations/deployment' },
      { text: 'Architektur', link: '/architecture/overview' },
      { text: 'ADRs', link: '/adr/' },
    ],
    sidebar: [
      {
        text: 'Anleitungen',
        items: items('user', [
          'webhosting.md',
          'ftp-upload.md',
          'hoster.md',
          'installation.md',
          'without-account.md',
          'editor.md',
          'sharing.md',
          'export.md',
        ]),
      },
      { text: 'Betrieb', items: items('operations', ['deployment.md', 'backup.md']) },
      { text: 'Produkt', items: items('product', ['vision.md']), collapsed: true },
      { text: 'Architektur', items: items('architecture', ['overview.md']), collapsed: true },
      {
        text: 'Entscheidungen (ADRs)',
        items: [{ text: 'Übersicht', link: '/adr/' }, ...items('adr')],
        collapsed: true,
      },
      { text: 'Tests', items: items('testing'), collapsed: true },
      { text: 'Prozess', items: items('process'), collapsed: true },
      {
        text: 'Sicherheit und Datenschutz',
        items: [...items('security'), ...items('privacy')],
        collapsed: true,
      },
    ],
    socialLinks: [{ icon: 'github', link: REPO }],
    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: 'Diese Seite auf GitHub bearbeiten',
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Suchen', buttonAriaLabel: 'Suchen' },
          modal: {
            displayDetails: 'Details anzeigen',
            resetButtonTitle: 'Suche zurücksetzen',
            backButtonTitle: 'Suche schließen',
            noResultsText: 'Keine Ergebnisse für',
            footer: { selectText: 'auswählen', navigateText: 'navigieren', closeText: 'schließen' },
          },
        },
      },
    },
    outline: { level: [2, 3], label: 'Auf dieser Seite' },
    docFooter: { prev: 'Zurück', next: 'Weiter' },
    darkModeSwitchLabel: 'Erscheinungsbild',
    lightModeSwitchTitle: 'Helles Design',
    darkModeSwitchTitle: 'Dunkles Design',
    sidebarMenuLabel: 'Menü',
    returnToTopLabel: 'Nach oben',
    langMenuLabel: 'Sprache',
    notFound: {
      title: 'Seite nicht gefunden',
      quote: 'Diese Seite gibt es nicht (mehr).',
      linkText: 'Zur Startseite',
    },
  },
})
