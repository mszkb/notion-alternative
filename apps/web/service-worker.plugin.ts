import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { type Plugin, transformWithOxc } from 'vite'

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const relative = `${prefix}${entry.name}`
    if (entry.isDirectory())
      files.push(...(await listFiles(path.join(dir, entry.name), `${relative}/`)))
    else files.push(relative)
  }
  return files
}

/**
 * Builds `sw.js` from src/sw/service-worker.ts with the list of files to precache (the app
 * shell: index.html, hashed assets, public files) and a version derived from them, so every
 * release with changed files installs a new service worker. Build only; no service worker in dev.
 */
export function serviceWorker(): Plugin {
  let root = ''
  let publicDir = ''
  return {
    name: 'notion-alt-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root
      publicDir = config.publicDir
    },
    async generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((file) => !file.endsWith('.map'))
      const publicFiles = (await listFiles(publicDir)).filter(
        (file) => !file.endsWith('.svg') || file.startsWith('app-icons/'),
      )
      // index.html is emitted by Vite after this hook; it is always part of the shell.
      const precache = [...new Set(['index.html', ...built, ...publicFiles])]
        .filter((file) => file !== 'sw.js')
        .map((file) => `/${file}`)
        .sort()

      const hash = createHash('sha256')
      for (const file of built.sort()) {
        const output = bundle[file]!
        hash.update(file)
        hash.update(output.type === 'chunk' ? output.code : output.source)
      }
      for (const file of publicFiles.sort()) {
        hash.update(file)
        hash.update(await readFile(path.join(publicDir, file)))
      }
      const version = hash.digest('hex').slice(0, 12)

      const sourcePath = path.join(root, 'src/sw/service-worker.ts')
      const { code } = await transformWithOxc(await readFile(sourcePath, 'utf8'), sourcePath, {
        lang: 'ts',
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source:
          `const VERSION = ${JSON.stringify(version)};\n` +
          `const PRECACHE = ${JSON.stringify(precache)};\n${code}`,
      })
    },
  }
}
