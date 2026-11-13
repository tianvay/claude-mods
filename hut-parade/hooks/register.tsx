import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Accessory, AgentRow, HatKind } from '../types'

const PANE = 'hut-parade'
const TITLE = 'Hut-Parade'

// Change the tag when AgentRow's fields change: values an earlier version
// stored outlive a reload and are then read as the initial value.
const agents = atom({ plugin: 'hut-parade', key: 'agents' } as const, [] as AgentRow[], {
  shape: 'agents-2',
})
const tick = atom({ plugin: 'hut-parade', key: 'tick' } as const, 0)

// ---------------------------------------------------------------- hats

type Hat = { label: string; emoji: string; color: string; dark: string; tool: Accessory }

const HATS: Record<HatKind, Hat> = {
  research: { label: 'Recherche', emoji: '🔵', color: '#3B82F6', dark: '#1D4ED8', tool: 'magnifier' },
  design: { label: 'Design', emoji: '🟣', color: '#8B5CF6', dark: '#6D28D9', tool: 'pencil' },
  coding: { label: 'Coding', emoji: '🟢', color: '#22C55E', dark: '#15803D', tool: 'wrench' },
  translate: { label: 'Übersetzung', emoji: '🟠', color: '#F97316', dark: '#9A3412', tool: 'bubbles' },
  writing: { label: 'Texte', emoji: '🟤', color: '#B45309', dark: '#78350F', tool: 'quill' },
  plan: { label: 'Planung', emoji: '🟡', color: '#EAB308', dark: '#A16207', tool: 'map' },
  review: { label: 'Review & Tests', emoji: '🔴', color: '#EF4444', dark: '#B91C1C', tool: 'clipboard' },
  ops: { label: 'Git & Betrieb', emoji: '⚫', color: '#64748B', dark: '#1E293B', tool: 'wheel' },
  other: { label: 'Sonstiges', emoji: '⚪', color: '#9CA3AF', dark: '#4B5563', tool: 'coffee' },
}
const ORDER: HatKind[] = ['research', 'design', 'coding', 'translate', 'writing', 'plan', 'review', 'ops', 'other']

// JavaScript's \b only knows ASCII letters, so words starting with an umlaut
// go without it. Order matters: the first kind whose words match wins.
const TRANSLATE = /\btranslat|übersetz|uebersetz|\bi18n|\bl10n|\blokalisier|\blocali[sz]|\bsprachversion/i

const KEYWORDS: [HatKind, RegExp][] = [
  ['translate', TRANSLATE],
  ['review', /\b(review|prüf|check|test|verif|audit|qa\b|validier|kontroll)/i],
  ['design', /\b(design|layout|ui\b|ux\b|mockup|gestalt|farb|styl|icon|logo|grafik|svg|visual|css)/i],
  ['plan', /\b(plan|architekt|konzept|strategie|roadmap|entwurf)/i],
  ['ops', /\b(git\b|commit|push|merge|rebase|deploy|release|publish|ci\b|pipeline|docker|server|install|setup|einricht|konfigur|config)|veröffentlich/i],
  ['writing', /\b(text|artikel|blog|brief|e-?mail|anschreiben|formulier|zusammenfass|summar|write-?up|notiz|protokoll|lebenslauf|beschreibung|changelog)/i],
  ['research', /\b(recherch|research|such|search|find|explor|untersuch|analys|lies|read|doku|docs|fetch|web)/i],
  ['coding', /\b(code|coding|implement|fix|bug|refactor|build|bau|schreib|program|feature|migrat|script)/i],
]

export function classify(type: string, description: string, prompt: string): HatKind {
  const t = type.toLowerCase()
  if (t === 'explore' || t === 'web-fetch' || t === 'claude-code-guide') return 'research'
  if (t === 'plan') return 'plan'
  if (/review|test/.test(t)) return 'review'
  if (/design/.test(t)) return 'design'
  if (/translat|i18n/.test(t)) return 'translate'
  // The short description says most; the prompt's opening breaks a tie.
  for (const text of [description, prompt.slice(0, 400)]) {
    for (const [kind, re] of KEYWORDS) if (re.test(text)) return kind
  }
  return 'other'
}

// ---------------------------------------------------------------- accessories

// Only the short description picks the accessory: a prompt's opening is often
// boilerplate ("first read common.md …") that would hand everyone a book.
const TOOL_WORDS: [Accessory, RegExp][] = [
  ['bubbles', TRANSLATE],
  ['testtube', /\btest/i],
  ['bugnet', /\b(bug|fehler|debug|crash)|\bfix/i],
  ['branch', /\b(git\b|commit|branch|merge|rebase|pull request|pr\b)/i],
  ['rocket', /\b(deploy|release|publish|ship|launch|ausroll)|veröffentlich/i],
  ['box', /\b(build|bundle|package|paket|install|depend|abhängig)/i],
  ['database', /\b(datenbank|database|sql|db\b|daten|data|csv|json|excel|tabelle|query|migrat)/i],
  ['globe', /\b(web|internet|online|url|fetch|website|webseite)/i],
  ['book', /\b(doku|docs?\b|documentation|readme|anleitung|handbuch|manual|lies|read)/i],
  ['palette', /\b(farb|colou?r|palette|styl|css|theme|font)/i],
  ['laptop', /\b(implement|feature|baue|programm|app\b|komponente|component|refactor)/i],
  ['clipboard', /\b(review|prüf|audit|checklist|kontroll)/i],
  ['map', /\b(plan|roadmap|route|strategie|konzept|architekt)/i],
  ['quill', /\b(text|artikel|blog|brief|e-?mail|formulier|zusammenfass|summar|notiz|protokoll)/i],
  ['magnifier', /\b(such|search|find|untersuch|recherch|research|explor|analys)/i],
  ['coffee', /\b(kaffee|coffee|pause|warte|wait)/i],
]

export function pickAccessory(hat: HatKind, description: string): Accessory {
  for (const [tool, re] of TOOL_WORDS) if (re.test(description)) return tool
  return HATS[hat].tool
}

const accessoryOf = (a: AgentRow): Accessory => a.accessory ?? HATS[a.hat]?.tool ?? 'coffee'

type Tool = { label: string; svg: string }

// Each one is held in the right hand (the arm ends near 58,44) and stays
// inside x 54..78, y 20..64 of the 80×68 drawing.
export const ACCESSORIES: Record<Accessory, Tool> = {
  magnifier: {
    label: 'Lupe',
    svg: `<line x1="62" y1="41" x2="57" y2="47" stroke="#78350F" stroke-width="3.2" stroke-linecap="round"/>
      <circle cx="67" cy="35" r="6.5" fill="#DBEAFE" fill-opacity="0.75" stroke="#374151" stroke-width="2.4"/>
      <path d="M64 32 Q66 30 68.5 31" fill="none" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round"/>`,
  },
  globe: {
    label: 'Globus',
    svg: `<circle cx="67" cy="37" r="9" fill="#60A5FA" stroke="#1E3A8A" stroke-width="1.5"/>
      <path d="M62 33 Q65 30 67 33 Q66 36 63 37 Z M68 39 Q72 37 74 40 Q72 44 69 43 Z" fill="#22C55E"/>
      <ellipse cx="67" cy="37" rx="3.6" ry="9" fill="none" stroke="#1E3A8A" stroke-width="1"/>
      <line x1="58" y1="37" x2="76" y2="37" stroke="#1E3A8A" stroke-width="1"/>`,
  },
  book: {
    label: 'Buch',
    svg: `<rect x="58" y="31" width="17" height="21" rx="1.5" fill="#B91C1C"/>
      <rect x="60.5" y="32" width="13.5" height="19" fill="#FEF3C7"/>
      <rect x="58" y="31" width="3" height="21" fill="#7F1D1D"/>
      <line x1="63" y1="37" x2="72" y2="37" stroke="#9CA3AF" stroke-width="1"/>
      <line x1="63" y1="40" x2="72" y2="40" stroke="#9CA3AF" stroke-width="1"/>
      <line x1="63" y1="43" x2="70" y2="43" stroke="#9CA3AF" stroke-width="1"/>`,
  },
  pencil: {
    label: 'Bleistift',
    svg: `<g transform="rotate(25 64 40)">
        <rect x="62" y="24" width="4.5" height="20" fill="#F59E0B"/>
        <rect x="62" y="22" width="4.5" height="3" fill="#F9A8D4"/>
        <path d="M62 44 L64.25 50 L66.5 44 Z" fill="#FDE68A"/>
        <path d="M63.4 47.6 L64.25 50 L65.1 47.6 Z" fill="#374151"/>
      </g>`,
  },
  palette: {
    label: 'Farbpalette',
    svg: `<path d="M67 30 C76 30 79 37 75 42 C73 44 70 42 69 45 C68 49 64 49 61 47 C57 44 57 30 67 30 Z" fill="#FDE68A" stroke="#A16207" stroke-width="1.2"/>
      <circle cx="63" cy="36" r="2" fill="#EF4444"/>
      <circle cx="67.5" cy="34" r="2" fill="#3B82F6"/>
      <circle cx="72" cy="36" r="2" fill="#22C55E"/>
      <circle cx="62.5" cy="41.5" r="2" fill="#8B5CF6"/>`,
  },
  wrench: {
    label: 'Schraubenschlüssel',
    svg: `<g transform="rotate(30 66 40)">
        <rect x="64.2" y="33" width="4" height="20" rx="1.8" fill="#9CA3AF"/>
        <path d="M60 25 L60 30 Q60 36 66.2 36 Q72.4 36 72.4 30 L72.4 25 L69.2 25 L69.2 30 L63.2 30 L63.2 25 Z" fill="#9CA3AF" stroke="#4B5563" stroke-width="0.8"/>
      </g>`,
  },
  laptop: {
    label: 'Laptop',
    svg: `<rect x="57" y="30" width="20" height="14" rx="1.5" fill="#374151"/>
      <rect x="59" y="32" width="16" height="10" fill="#0F172A"/>
      <line x1="60.5" y1="34.5" x2="66" y2="34.5" stroke="#22C55E" stroke-width="1.2"/>
      <line x1="62" y1="37" x2="71" y2="37" stroke="#60A5FA" stroke-width="1.2"/>
      <line x1="62" y1="39.5" x2="68" y2="39.5" stroke="#F59E0B" stroke-width="1.2"/>
      <path d="M55 44 L79 44 L77 48 L57 48 Z" fill="#9CA3AF"/>`,
  },
  bugnet: {
    label: 'Käfernetz',
    svg: `<line x1="58" y1="46" x2="66" y2="31" stroke="#92400E" stroke-width="2.4" stroke-linecap="round"/>
      <ellipse cx="70" cy="27" rx="6.5" ry="5.5" fill="#E5E7EB" fill-opacity="0.6" stroke="#6B7280" stroke-width="1.6"/>
      <ellipse cx="70" cy="27.5" rx="2.4" ry="3" fill="#15803D"/>
      <path d="M67 26 L65.5 25 M67 28.5 L65.5 29.5 M73 26 L74.5 25 M73 28.5 L74.5 29.5" stroke="#1F2937" stroke-width="0.9" stroke-linecap="round"/>`,
  },
  clipboard: {
    label: 'Klemmbrett',
    svg: `<rect x="58" y="29" width="16" height="22" rx="1.8" fill="#A16207"/>
      <rect x="60" y="32" width="12" height="17" fill="#F9FAFB"/>
      <rect x="62.5" y="27" width="7" height="4" rx="1" fill="#6B7280"/>
      <path d="M61.5 36 L63 37.5 L65.5 34.5 M61.5 41 L63 42.5 L65.5 39.5" fill="none" stroke="#16A34A" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="67" y1="36" x2="70.5" y2="36" stroke="#9CA3AF" stroke-width="1"/>
      <line x1="67" y1="41" x2="70.5" y2="41" stroke="#9CA3AF" stroke-width="1"/>
      <line x1="61.5" y1="46" x2="70.5" y2="46" stroke="#9CA3AF" stroke-width="1"/>`,
  },
  testtube: {
    label: 'Reagenzglas',
    svg: `<g transform="rotate(20 66 40)">
        <rect x="62.5" y="26" width="7" height="23" rx="3.5" fill="#E0F2FE" stroke="#64748B" stroke-width="1.2"/>
        <rect x="63.1" y="37" width="5.8" height="11.4" rx="2.9" fill="#A855F7"/>
        <rect x="61.5" y="24.5" width="9" height="2.6" rx="1" fill="#64748B"/>
        <circle cx="65" cy="40" r="0.9" fill="#F5F3FF"/>
        <circle cx="67.2" cy="43" r="0.7" fill="#F5F3FF"/>
      </g>`,
  },
  map: {
    label: 'Landkarte',
    svg: `<path d="M56 32 L62 30 L68 32 L75 30 L75 49 L68 51 L62 49 L56 51 Z" fill="#FDE68A" stroke="#A16207" stroke-width="1"/>
      <line x1="62" y1="30" x2="62" y2="49" stroke="#D97706" stroke-width="0.8"/>
      <line x1="68" y1="32" x2="68" y2="51" stroke="#D97706" stroke-width="0.8"/>
      <path d="M58 46 Q62 40 65 43 T72 36" fill="none" stroke="#DC2626" stroke-width="1.2" stroke-dasharray="2 1.5"/>
      <path d="M70.5 34 L73.5 37 M73.5 34 L70.5 37" stroke="#DC2626" stroke-width="1.4" stroke-linecap="round"/>`,
  },
  bubbles: {
    label: 'Sprechblasen',
    svg: `<rect x="55" y="20" width="16" height="11" rx="3" fill="#FFFFFF" stroke="#9A3412" stroke-width="1.2"/>
      <path d="M59 31 L58 35 L62.5 31 Z" fill="#FFFFFF" stroke="#9A3412" stroke-width="1.2" stroke-linejoin="round"/>
      <text x="63" y="28" text-anchor="middle" font-family="sans-serif" font-size="7" font-weight="bold" fill="#9A3412">EN</text>
      <rect x="62" y="34" width="16" height="11" rx="3" fill="#FED7AA" stroke="#9A3412" stroke-width="1.2"/>
      <path d="M74 45 L75 49 L70.5 45 Z" fill="#FED7AA" stroke="#9A3412" stroke-width="1.2" stroke-linejoin="round"/>
      <text x="70" y="42" text-anchor="middle" font-family="sans-serif" font-size="7" font-weight="bold" fill="#9A3412">DE</text>`,
  },
  quill: {
    label: 'Schreibfeder',
    svg: `<path d="M76 22 Q63 27 60 46 Q68 38 76 22 Z" fill="#F9FAFB" stroke="#9CA3AF" stroke-width="1"/>
      <path d="M76 22 Q67 33 60 46" fill="none" stroke="#6B7280" stroke-width="1"/>
      <line x1="60" y1="46" x2="58" y2="50" stroke="#1F2937" stroke-width="1.6" stroke-linecap="round"/>
      <rect x="64" y="52" width="9" height="7" rx="1.5" fill="#1E3A8A"/>
      <rect x="66" y="50" width="5" height="2.5" fill="#334155"/>`,
  },
  rocket: {
    label: 'Rakete',
    svg: `<g transform="rotate(35 66 38)">
        <path d="M66 22 Q72 28 72 40 L60 40 Q60 28 66 22 Z" fill="#E5E7EB" stroke="#6B7280" stroke-width="0.8"/>
        <circle cx="66" cy="31" r="2.4" fill="#3B82F6" stroke="#1E3A8A" stroke-width="0.8"/>
        <path d="M60 35 L56.5 42 L60 41 Z M72 35 L75.5 42 L72 41 Z" fill="#EF4444"/>
        <path d="M62.5 40 L66 48 L69.5 40 Z" fill="#F97316"/>
        <path d="M64.3 40 L66 44.5 L67.7 40 Z" fill="#FACC15"/>
      </g>`,
  },
  branch: {
    label: 'Verzweigung',
    svg: `<line x1="61" y1="28" x2="61" y2="50" stroke="#EA580C" stroke-width="2.6"/>
      <path d="M61 45 Q61 38 72 36 L72 32" fill="none" stroke="#EA580C" stroke-width="2.6"/>
      <circle cx="61" cy="27" r="3.2" fill="#FFFFFF" stroke="#EA580C" stroke-width="2"/>
      <circle cx="61" cy="51" r="3.2" fill="#FFFFFF" stroke="#EA580C" stroke-width="2"/>
      <circle cx="72" cy="30" r="3.2" fill="#FFFFFF" stroke="#EA580C" stroke-width="2"/>`,
  },
  box: {
    label: 'Paket',
    svg: `<path d="M57 36 L67 31 L77 36 L67 41 Z" fill="#E7B877"/>
      <path d="M57 36 L67 41 L67 53 L57 48 Z" fill="#C8924A"/>
      <path d="M77 36 L67 41 L67 53 L77 48 Z" fill="#B07A36"/>
      <path d="M62 33.5 L72 38.5 L72 42" fill="none" stroke="#F5F5F4" stroke-width="1.6"/>`,
  },
  database: {
    label: 'Datenbank',
    svg: `<path d="M58 29 L58 49 Q67 53 76 49 L76 29 Z" fill="#64748B"/>
      <ellipse cx="67" cy="29" rx="9" ry="3.2" fill="#94A3B8"/>
      <path d="M58 36 Q67 40 76 36 M58 43 Q67 47 76 43" fill="none" stroke="#CBD5E1" stroke-width="1.2"/>
      <circle cx="72" cy="40" r="0.9" fill="#22C55E"/>
      <circle cx="72" cy="47" r="0.9" fill="#22C55E"/>`,
  },
  wheel: {
    label: 'Steuerrad',
    svg: `<g stroke="#92400E" stroke-linecap="round">
        <line x1="67" y1="27" x2="67" y2="49" stroke-width="2.2"/>
        <line x1="56" y1="38" x2="78" y2="38" stroke-width="2.2"/>
        <line x1="59.2" y1="30.2" x2="74.8" y2="45.8" stroke-width="2.2"/>
        <line x1="74.8" y1="30.2" x2="59.2" y2="45.8" stroke-width="2.2"/>
        <circle cx="67" cy="38" r="7.5" fill="none" stroke-width="2.6"/>
      </g>
      <circle cx="67" cy="38" r="2.4" fill="#FACC15"/>`,
  },
  coffee: {
    label: 'Kaffeetasse',
    svg: `<path d="M64 30 Q62 27 64 24 M68 30 Q66 27 68 24" fill="none" stroke="#9CA3AF" stroke-width="1.2" stroke-linecap="round"/>
      <rect x="59" y="33" width="13" height="14" rx="2.5" fill="#F9FAFB" stroke="#6B7280" stroke-width="1.2"/>
      <path d="M72 36 Q77 36 77 40 Q77 44 72 44" fill="none" stroke="#6B7280" stroke-width="1.8"/>
      <rect x="60.2" y="34.5" width="10.6" height="3" fill="#78350F"/>`,
  },
}

// ---------------------------------------------------------------- details

const base = (p: unknown) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
const cut = (s: unknown, n: number) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}
const host = (u: unknown) => {
  const m = /^[a-z]+:\/\/([^/]+)/i.exec(String(u ?? ''))
  return m ? m[1] : cut(u, 40)
}

export function describeStep(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
      return `liest ${base(input.file_path)}`
    case 'Write':
      return `schreibt ${base(input.file_path)}`
    case 'Edit':
    case 'NotebookEdit':
      return `bearbeitet ${base(input.file_path ?? input.notebook_path)}`
    case 'Grep':
      return `sucht „${cut(input.pattern, 40)}“`
    case 'Glob':
      return `sucht Dateien ${cut(input.pattern, 40)}`
    case 'Bash':
    case 'PowerShell':
      return `führt aus: ${cut(input.description ?? input.command, 60)}`
    case 'WebFetch':
      return `liest Webseite ${host(input.url)}`
    case 'WebSearch':
      return `sucht im Web „${cut(input.query, 50)}“`
    case 'Agent':
      return `schickt Helfer los: ${cut(input.description, 50)}`
    default:
      return `nutzt ${tool.replace(/^mcp__[^_]+__/, '')}`
  }
}

export const clock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// ---------------------------------------------------------------- mascot

function hatSvg(kind: HatKind): string {
  const { color, dark } = HATS[kind] ?? HATS.other
  switch (kind) {
    case 'research': // deerstalker
      return `<path d="M16 30 Q32 8 48 30 Z" fill="${color}"/>
        <rect x="9" y="27" width="46" height="4" rx="2" fill="${dark}"/>
        <path d="M30 12 L32 6 L34 12 Z" fill="${dark}"/>`
    case 'design': // beret
      return `<ellipse cx="30" cy="25" rx="20" ry="7" fill="${color}" transform="rotate(-8 30 25)"/>
        <rect x="31" y="14" width="3" height="5" rx="1" fill="${dark}"/>`
    case 'translate': // fez with tassel
      return `<path d="M20 30 L23 12 L41 12 L44 30 Z" fill="${color}"/>
        <ellipse cx="32" cy="12" rx="9" ry="1.8" fill="${dark}"/>
        <path d="M32 12 Q40 12 43 20" fill="none" stroke="${dark}" stroke-width="1.6"/>
        <rect x="41.5" y="20" width="3" height="6" rx="1" fill="${dark}"/>`
    case 'writing': // fedora with a press card
      return `<path d="M18 28 Q19 12 32 12 Q45 12 46 28 Z" fill="${color}"/>
        <path d="M27 13 Q32 17 37 13" fill="none" stroke="${dark}" stroke-width="1.4"/>
        <rect x="18" y="23" width="28" height="4" fill="${dark}"/>
        <ellipse cx="32" cy="29" rx="23" ry="3" fill="${dark}"/>
        <rect x="37" y="17" width="7" height="5" fill="#F9FAFB" transform="rotate(10 40 19)"/>
        <line x1="38" y1="19.5" x2="42.5" y2="20.3" stroke="#374151" stroke-width="0.8"/>`
    case 'ops': // captain's cap
      return `<path d="M15 25 Q16 13 32 12 Q48 13 49 25 Z" fill="#F9FAFB" stroke="#CBD5E1" stroke-width="0.8"/>
        <rect x="16" y="22" width="32" height="5" fill="${color}"/>
        <path d="M18 27 Q32 33 46 27 L46 29.5 Q32 35 18 29.5 Z" fill="${dark}"/>
        <circle cx="32" cy="22.5" r="3" fill="#FACC15" stroke="#A16207" stroke-width="0.8"/>`
    case 'coding': // hard hat
      return `<path d="M14 30 Q14 11 32 11 Q50 11 50 30 Z" fill="${color}"/>
        <rect x="30" y="11" width="4" height="19" fill="${dark}"/>
        <rect x="9" y="27" width="46" height="4" rx="2" fill="${dark}"/>`
    case 'plan': // top hat
      return `<rect x="20" y="5" width="24" height="23" rx="1" fill="${color}"/>
        <rect x="20" y="21" width="24" height="4" fill="${dark}"/>
        <rect x="11" y="27" width="42" height="4" rx="2" fill="${dark}"/>`
    case 'review': // firefighter helmet
      return `<path d="M15 30 Q15 12 32 12 Q49 12 49 30 Z" fill="${color}"/>
        <path d="M44 27 L58 32 L58 34 L44 31 Z" fill="${dark}"/>
        <rect x="10" y="27" width="38" height="4" rx="2" fill="${dark}"/>
        <circle cx="32" cy="21" r="4" fill="#FACC15"/>`
    default: // beanie
      return `<path d="M16 30 Q16 13 32 13 Q48 13 48 30 Z" fill="${color}"/>
        <rect x="14" y="25" width="36" height="6" rx="2" fill="${dark}"/>
        <circle cx="32" cy="11" r="4" fill="${dark}"/>`
  }
}

function eyesSvg(status: AgentRow['status']): string {
  if (status === 'done')
    return `<path d="M21 43 L24 39 L27 43 M37 43 L40 39 L43 43" fill="none" stroke="#1F2937" stroke-width="2.4" stroke-linecap="round"/>`
  if (status === 'failed')
    return `<path d="M21 38 L27 44 M27 38 L21 44 M37 38 L43 44 M43 38 L37 44" stroke="#1F2937" stroke-width="2.4" stroke-linecap="round"/>`
  return `<rect x="22" y="37" width="4" height="7" fill="#1F2937"/><rect x="38" y="37" width="4" height="7" fill="#1F2937"/>`
}

export function mascotSvg(kind: HatKind, status: AgentRow['status'], accessory?: Accessory): string {
  const body = '#D97757'
  const hat =
    status === 'failed'
      ? `<g transform="rotate(-20 32 28) translate(-3 2)">${hatSvg(kind)}</g>`
      : hatSvg(kind)
  const tool = ACCESSORIES[accessory ?? HATS[kind]?.tool ?? 'coffee']
  // A failed agent has dropped what it held: it lies tilted at its feet.
  const held =
    status === 'failed'
      ? `<g transform="translate(68 58) rotate(80) scale(0.55) translate(-67 -38)" opacity="0.8">${tool.svg}</g>`
      : tool.svg
  const bob =
    status === 'running'
      ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="1.1s" repeatCount="indefinite"/>`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 68" width="80" height="68">
  <g>${bob}
    <rect x="16" y="56" width="4" height="8" fill="${body}"/>
    <rect x="24" y="56" width="4" height="8" fill="${body}"/>
    <rect x="36" y="56" width="4" height="8" fill="${body}"/>
    <rect x="44" y="56" width="4" height="8" fill="${body}"/>
    <rect x="6" y="40" width="7" height="8" fill="${body}"/>
    <rect x="51" y="40" width="7" height="8" fill="${body}"/>
    <rect x="12" y="29" width="40" height="28" rx="2" fill="${body}"/>
    ${eyesSvg(status)}
    ${hat}
    ${held}
  </g>
</svg>`
}

// ---------------------------------------------------------------- state helpers

let counter = 0

const patch = ($: EngineInterface, match: (a: AgentRow) => boolean, fn: (a: AgentRow) => AgentRow) =>
  update($, agents, list => list.map(a => (match(a) ? fn(a) : a)))

// ---------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hats',
      description: 'Hut-Parade öffnen: alle Agents mit ihren Hüten',
    })
    // Rows a reload or a lost worker left "running" can no longer finish.
    await update($, agents, list =>
      list.map(a => (a.status === 'running' && !a.agentId ? { ...a, status: 'failed' as const } : a)),
    )
    void $.ui.open({ id: PANE, title: TITLE })
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        if (list.some(a => a.status === 'running')) await update($, tick, n => (n ?? 0) + 1)
      })()
    })
    return next(e)
  })

  on('command.run', { command: 'hats' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Hut-Parade geöffnet.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const key = `${e.tool_use_id}#${++counter}`
    const hat = classify(e.subagentType, e.description, e.prompt)
    const row: AgentRow = {
      key,
      toolUseId: e.tool_use_id,
      hat,
      accessory: pickAccessory(hat, e.description || cut(e.prompt, 60)),
      type: e.subagentType,
      description: e.description || cut(e.prompt, 60),
      prompt: cut(e.prompt, 240),
      background: e.background,
      startedAt: await $.clock.now(),
      status: 'running',
      steps: 0,
      recent: [],
    }
    await update($, agents, list => [...list.filter(a => !(e.resume && a.agentId === e.resume.agentId)), row].slice(-40))
    void $.ui.open({ id: PANE, title: TITLE })

    const res = await next(e)
    if (res.deny !== undefined) {
      await update($, agents, list => list.filter(a => a.key !== key))
    } else if (res.agentId) {
      const id = res.agentId
      await patch($, a => a.key === key, a => ({ ...a, agentId: id }))
    }
    return res
  }).catch(($, e, next) => next(e))

  // What a subagent is doing right now: every tool call in its own loop.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const step = describeStep(e.tool, e as unknown as Record<string, unknown>)
      await patch(
        $,
        a => a.agentId === id && a.status === 'running',
        a => ({ ...a, steps: a.steps + 1, current: step, recent: [step, ...a.recent].slice(0, 4) }),
      )
    }
    const ran = await next(e)

    // A foreground Agent call that returns has finished its agent, whatever
    // turn.complete said (or did not, where the loop was cut short).
    if (e.tool === 'Agent') {
      const now = await $.clock.now()
      const failed = 'isError' in ran && Boolean((ran as { isError?: boolean }).isError)
      await patch(
        $,
        a => a.toolUseId === e.tool_use_id && a.status === 'running' && !a.background,
        a => ({ ...a, status: failed ? 'failed' : 'done', endedAt: now, current: undefined }),
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const list = await read($, agents)
      const row = list.find(a => a.agentId === id && a.status === 'running')
      if (row) {
        const failed = e.reason === 'error' || e.reason === 'aborted' || e.reason === 'refusal'
        const now = await $.clock.now()
        await patch($, a => a.key === row.key, a => ({
          ...a,
          status: failed ? 'failed' : 'done',
          endedAt: now,
          current: undefined,
        }))
        const hat = HATS[row.hat] ?? HATS.other
        void $.ui.toast(
          failed
            ? `${hat.emoji} ${hat.label}-Hut kam zerknittert zurück: ${row.description}`
            : `${hat.emoji} ${hat.label}-Hut ist zurück: ${row.description}`,
        )
      }
    }
    return next(e)
  })

  // ---------------------------------------------------------------- drawing

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const list = await read($, agents)
    await read($, tick)
    const now = await $.clock.now()

    const running = list.filter(a => a.status === 'running')
    const finished = list.filter(a => a.status !== 'running').reverse()

    const hatOf = (a: AgentRow) => HATS[a.hat] ?? HATS.other
    const toolOf = (a: AgentRow) => ACCESSORIES[accessoryOf(a)]

    // `size` is the mascot's own width; the drawing is wider by the hand's tool.
    const mascot = (a: AgentRow, size: number) =>
      Svg ? (
        <Svg
          source={mascotSvg(a.hat, a.status, accessoryOf(a))}
          alt={`Maskottchen mit ${hatOf(a).label}-Hut und ${toolOf(a).label}`}
          width={Math.round(size * 1.25)}
          height={Math.round(size * 1.06)}
          isInteractive={a.status === 'running' ? true : undefined}
        />
      ) : (
        <Text>{hatOf(a).emoji}</Text>
      )

    const statusText = (a: AgentRow) =>
      a.status === 'running' ? '⏳ läuft' : a.status === 'done' ? '✅ fertig' : '❌ abgebrochen'

    const legend = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={0} marginBottom={1}>
        {ORDER.map(k => (
          <Text size="caption" color={HATS[k].color}>
            {HATS[k].emoji} {HATS[k].label}
          </Text>
        ))}
      </Box>
    )

    const bigRow = (a: AgentRow) => {
      const hat = hatOf(a)
      return (
        <Box key={a.key} flexDirection="row" gap={2} paddingY={1} borderStyle="single" borderColor={hat.color} paddingX={1} marginBottom={1}>
          <Box flexShrink={0} alignItems="center">
            {mascot(a, 64)}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text size="caption" weight="bold" color={hat.color}>
              {hat.emoji} {hat.label.toUpperCase()}-HUT · mit {toolOf(a).label}
            </Text>
            <Text weight="semibold" wrap="wrap">
              {a.description}
            </Text>
            <Text size="caption" dimColor>
              {statusText(a)} · {clock(now - a.startedAt)} · {a.steps} {a.steps === 1 ? 'Schritt' : 'Schritte'} · {a.type}
              {a.background ? ' · Hintergrund' : ''}
            </Text>
            <Text wrap="wrap">▶ {a.current ?? 'denkt nach …'}</Text>
            {a.recent.slice(1).map(s => (
              <Text size="caption" dimColor wrap="truncate-end">
                · {s}
              </Text>
            ))}
            <Text size="caption" dimColor italic wrap="wrap">
              Auftrag: {a.prompt}
            </Text>
          </Box>
        </Box>
      )
    }

    const smallRow = (a: AgentRow) => {
      const hat = hatOf(a)
      return (
        <Box key={a.key} flexDirection="row" gap={2} alignItems="center" marginBottom={1}>
          <Box flexShrink={0}>{mascot(a, 32)}</Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={hat.color}>{hat.label}</Text> · {a.description}
            </Text>
            <Text size="caption" dimColor>
              {statusText(a)} nach {clock((a.endedAt ?? now) - a.startedAt)} · {a.steps}{' '}
              {a.steps === 1 ? 'Schritt' : 'Schritte'}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {legend}
        {running.length === 0 && (
          <Box flexDirection="row" gap={2} alignItems="center" marginBottom={1}>
            {Svg && (
              <Svg source={sleepingSvg()} alt="Schlafendes Maskottchen ohne Hut" width={48} height={51} />
            )}
            <Text dimColor>Gerade keine Helfer unterwegs.</Text>
          </Box>
        )}
        {running.map(bigRow)}
        {finished.length > 0 && (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1} marginBottom={1}>
            <Text size="caption" weight="bold" dimColor>
              ERLEDIGT ({finished.length})
            </Text>
            <Button
              label="Leeren"
              onPress={() => update($, agents, l => l.filter(a => a.status === 'running'))}
            />
          </Box>
        )}
        {finished.slice(0, 15).map(smallRow)}
      </Box>
    )
  })
}

function sleepingSvg(): string {
  const body = '#D97757'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 68" width="64" height="68">
  <rect x="16" y="56" width="4" height="8" fill="${body}"/><rect x="24" y="56" width="4" height="8" fill="${body}"/>
  <rect x="36" y="56" width="4" height="8" fill="${body}"/><rect x="44" y="56" width="4" height="8" fill="${body}"/>
  <rect x="6" y="40" width="7" height="8" fill="${body}"/><rect x="51" y="40" width="7" height="8" fill="${body}"/>
  <rect x="12" y="29" width="40" height="28" rx="2" fill="${body}"/>
  <path d="M20 41 h7 M37 41 h7" stroke="#1F2937" stroke-width="2.4" stroke-linecap="round"/>
  <text x="46" y="20" font-family="sans-serif" font-size="11" font-weight="bold" fill="#9CA3AF">z</text>
  <text x="53" y="12" font-family="sans-serif" font-size="8" font-weight="bold" fill="#9CA3AF">z</text>
</svg>`
}
