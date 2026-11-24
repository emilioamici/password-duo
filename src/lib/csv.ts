/** Lettura di CSV e JSON (KeePass, Bitwarden, Chrome…) per l'importazione, con mappatura dei campi. */
import { GENERAL_CATEGORY_ID } from '../types'

/** CSV con campi tra virgolette, virgolette doppie ("") e a-capo dentro i campi. Il separatore viene riconosciuto (, ; tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const counts = { ',': 0, ';': 0, '\t': 0 }
  let q = false
  for (const ch of firstLine) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch as keyof typeof counts]++ }
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as string
  const rows: string[][] = []
  let row: string[] = []; let cell = ''; let inQ = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else inQ = false } else cell += ch
    } else if (ch === '"') inQ = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = [] }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function flatten(v: unknown, prefix: string, out: Record<string, string>) {
  if (v == null) return
  if (Array.isArray(v)) v.forEach((x, i) => flatten(x, prefix ? `${prefix}.${i}` : String(i), out))
  else if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out)
  else out[prefix] = String(v)
}

/** JSON: array di oggetti, oppure un oggetto con un array (`items`, `entries`, `passwords`, `logins`). Restituisce una tabella (prima riga = intestazioni). */
export function parseJsonTable(text: string): string[][] {
  const j = JSON.parse(text) as unknown
  let list: unknown[] | null = Array.isArray(j) ? j : null
  if (!list && j && typeof j === 'object') {
    const o = j as Record<string, unknown>
    list = (['items', 'entries', 'passwords', 'logins'] as const).map((k) => o[k]).find(Array.isArray) as unknown[] | undefined ?? null
  }
  if (!list) throw new Error('JSON non riconosciuto: mi aspetto un elenco di voci.')
  const flat = list.map((x) => { const o: Record<string, string> = {}; flatten(x, '', o); return o })
  const headers = [...new Set(flat.flatMap((o) => Object.keys(o)))]
  return [headers, ...flat.map((o) => headers.map((h) => o[h] ?? ''))]
}

export type Field = 'title' | 'username' | 'password' | 'url' | 'notes' | 'group'
export const FIELDS: { id: Field; label: string }[] = [
  { id: 'title', label: 'Titolo' }, { id: 'username', label: 'Username / Email' }, { id: 'password', label: 'Password' },
  { id: 'url', label: 'Sito web' }, { id: 'notes', label: 'Note' }, { id: 'group', label: 'Gruppo → Categoria' },
]
const HINTS: Record<Field, RegExp[]> = {
  title: [/^(title|name|account|account name|service|site|entry|titolo|nome)$/i, /^name$/i],
  username: [/^(login name|username|user name|user|login|login\.username|email|e-mail|utente)$/i],
  password: [/^(password|pass|login\.password|pwd)$/i],
  url: [/^(web site|website|url|uri|site|login\.uri|login\.uris\.0\.uri|sito|sito web)$/i],
  notes: [/^(comments?|notes?|note|extra|commenti|login\.notes)$/i],
  group: [/^(group|grouping|folder|category|cartella|gruppo|categoria|group tree)$/i],
}

/** Associa le colonne ai campi per nome (in modo largo). Restituisce l'indice di colonna per campo, o -1. */
export function autoMap(headers: string[]): Record<Field, number> {
  const out = {} as Record<Field, number>
  const used = new Set<number>()
  for (const f of Object.keys(HINTS) as Field[]) {
    let idx = -1
    for (const re of HINTS[f]) { idx = headers.findIndex((h, i) => !used.has(i) && re.test(h.trim())); if (idx >= 0) break }
    out[f] = idx
    if (idx >= 0) used.add(idx)
  }
  return out
}

export interface ImportRow { title: string; username: string; password: string; url: string; notes: string; group: string }

export function applyMapping(rows: string[][], map: Record<Field, number>): ImportRow[] {
  const get = (r: string[], f: Field) => (map[f] >= 0 ? (r[map[f]] ?? '').trim() : '')
  return rows.map((r) => ({
    title: get(r, 'title') || get(r, 'url').replace(/^https?:\/\//, '').split('/')[0] || get(r, 'username') || 'Senza titolo',
    username: get(r, 'username'), password: map.password >= 0 ? (r[map.password] ?? '') : '', url: get(r, 'url'),
    notes: map.notes >= 0 ? (r[map.notes] ?? '') : '', group: get(r, 'group'),
  })).filter((r) => r.password || r.username || r.url || r.title !== 'Senza titolo')
}

/** Il nome del gruppo coincide con una categoria esistente? Altrimenti «Generale» (l'import non crea categorie). */
export function categoryFor(group: string, cats: { id: string; name: string }[]): string {
  const g = group.trim().toLowerCase()
  if (!g) return GENERAL_CATEGORY_ID
  const last = g.split(/[/\\>]/).pop()!.trim()
  return cats.find((c) => c.name.toLowerCase() === g || c.name.toLowerCase() === last)?.id ?? GENERAL_CATEGORY_ID
}
