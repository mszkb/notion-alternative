// Copies docs/ into Starlight's content collection (ADR 0025). The Markdown in docs/ stays
// free of front matter so it reads well on GitHub; this script derives what Starlight needs:
//   - title from the first `# ` heading (removed from the body, Starlight renders it)
//   - README.md becomes the folder's index page
//   - relative links become site links; links leaving docs/ or to non-Markdown files go to GitHub
//   - a link to a missing Markdown file fails the run
// Usage: node scripts/sync-docs.mjs [--watch]
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'https://github.com/mszkb/notion-alternative'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const SOURCE = join(ROOT, 'docs')
const TARGET = join(ROOT, 'apps/site/src/content/docs/docs')

/** Sidebar order inside a folder; files not listed follow sorted by name. */
const ORDER = {
  user: [
    'webhosting.md',
    'ftp-upload.md',
    'hoster.md',
    'installation.md',
    'without-account.md',
    'editor.md',
    'sharing.md',
    'export.md',
  ],
  operations: ['deployment.md', 'backup.md'],
  product: ['vision.md'],
  architecture: ['overview.md'],
}

function markdownFiles(dir) {
  return readdirSync(join(SOURCE, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : markdownFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  })
}

/** Site path of a docs file below the site root, e.g. `docs/user/webhosting/`. */
function pagePath(file) {
  const slug = file.replace(/(^|\/)README\.md$/, '$1').replace(/\.md$/, '/')
  return `docs/${slug}`
}

function rewriteLink(href, file, dead) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/|…)/i.test(href)) return href
  const [path, hash] = href.split('#')
  const target = posix.normalize(posix.join('docs', posix.dirname(file), path))
  const anchor = hash ? `#${hash}` : ''
  if (target.startsWith('docs/') && target.endsWith('.md')) {
    const docsFile = target.slice('docs/'.length)
    if (!existsSync(join(SOURCE, docsFile))) {
      dead.push(`${file}: ${href}`)
      return href
    }
    const from = pagePath(file)
    let link = posix.relative(from, pagePath(docsFile))
    link = link === '' ? './' : `${link}/`
    return link + anchor
  }
  const kind = target.endsWith('/') || !posix.extname(target) ? 'tree' : 'blob'
  return `${REPO}/${kind}/main/${target}${anchor}`
}

/** Rewrites inline links `[text](href)` outside code fences and inline code. */
function rewriteLinks(body, file, dead) {
  let fenced = false
  return body
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
      if (fenced) return line
      return line
        .split(/(`[^`]*`)/)
        .map((part) =>
          part.startsWith('`')
            ? part
            : part.replace(/\]\(([^)\s]+)\)/g, (_, href) => `](${rewriteLink(href, file, dead)})`),
        )
        .join('')
    })
    .join('\n')
}

function convert(file, dead) {
  const source = readFileSync(join(SOURCE, file), 'utf8')
  const heading = source.match(/^# (.+)$/m)
  const title = heading ? heading[1].trim() : file
  const body = heading ? source.replace(heading[0], '').replace(/^\s*\n/, '') : source
  const folder = posix.dirname(file)
  const name = posix.basename(file)
  const listed = (ORDER[folder] ?? []).indexOf(name)
  const order = name === 'README.md' ? 0 : listed >= 0 ? listed + 1 : undefined
  const frontMatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `editUrl: ${JSON.stringify(`${REPO}/edit/main/docs/${file}`)}`,
    ...(order === undefined ? [] : ['sidebar:', `  order: ${order}`]),
    '---',
    '',
    '',
  ].join('\n')
  return frontMatter + rewriteLinks(body, file, dead)
}

function sync() {
  const dead = []
  const pages = markdownFiles('').map((file) => [file, convert(file, dead)])
  if (dead.length > 0) {
    console.error(`sync-docs: links to missing files:\n  ${dead.join('\n  ')}`)
    return false
  }
  rmSync(TARGET, { recursive: true, force: true })
  for (const [file, content] of pages) {
    const out = join(TARGET, file.replace(/(^|\/)README\.md$/, '$1index.md'))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, content)
  }
  console.log(`sync-docs: ${pages.length} pages → ${relative(ROOT, TARGET).split(sep).join('/')}`)
  return true
}

if (!sync() && !process.argv.includes('--watch')) process.exit(1)
if (process.argv.includes('--watch')) {
  let timer
  watch(SOURCE, { recursive: true }, (_, name) => {
    if (!name?.endsWith('.md')) return
    clearTimeout(timer)
    timer = setTimeout(sync, 100)
  })
}
