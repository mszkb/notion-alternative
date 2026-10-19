// Landing page and documentation (ADR 0025). The docs come from docs/ via scripts/sync-docs.mjs.
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

const REPO = 'https://github.com/mszkb/notion-alternative'
const group = (label, directory, collapsed = true) => ({
  label,
  collapsed,
  items: [{ autogenerate: { directory: `docs/${directory}` } }],
})

export default defineConfig({
  // GitHub Pages serves the site below /<repo>/ (.github/workflows/site.yml).
  site: process.env.SITE_URL ?? 'https://mszkb.github.io',
  base: process.env.SITE_BASE ?? '/',
  integrations: [
    starlight({
      title: 'Notion-Alternative',
      logo: { src: './src/assets/logo.svg' },
      customCss: ['./src/styles/docs.css'],
      description: 'Self-hosted, local-first Wissens- und Dokumentenplattform',
      locales: { root: { label: 'Deutsch', lang: 'de' } },
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      lastUpdated: false,
      sidebar: [
        { label: 'Übersicht', link: '/docs/' },
        group('Anleitungen', 'user', false),
        group('Betrieb', 'operations', false),
        group('Produkt', 'product'),
        group('Architektur', 'architecture'),
        group('Entscheidungen (ADRs)', 'adr'),
        group('Tests', 'testing'),
        group('Prozess', 'process'),
        group('Sicherheit', 'security'),
        group('Datenschutz', 'privacy'),
      ],
    }),
  ],
})
