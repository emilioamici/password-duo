import { FileUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Scope } from '../types'
import { FIELDS, applyMapping, autoMap, categoryFor, parseCsv, parseJsonTable, type Field } from '../lib/csv'
import { liveCategories } from '../lib/entries'
import { useVault } from '../store/VaultContext'
import { useUi } from '../store/UiContext'
import { Segmented, Sheet } from './ui'

/** Importazione da CSV o JSON (KeePass, Bitwarden, Chrome…): file → mappatura dei campi con anteprima → conferma. */
export function ImportSheet() {
  const { importOpen, openImport, showToast } = useUi()
  const { session, importEntries } = useVault()
  const [table, setTable] = useState<string[][] | null>(null)
  const [name, setName] = useState('')
  const [map, setMap] = useState<Record<Field, number>>({ title: -1, username: -1, password: -1, url: -1, notes: -1, group: -1 })
  const [scope, setScope] = useState<Scope>('personal') // le voci importate partono come personali
  const [err, setErr] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const close = () => { openImport(false); setTable(null); setErr(''); setName('') }

  const headers = table?.[0] ?? []
  const cats = session ? liveCategories(session) : []
  const rows = useMemo(() => (table ? applyMapping(table.slice(1), map) : []), [table, map])

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setErr('')
    try {
      if (f.size > 8_000_000) throw new Error('File troppo grande (massimo 8 MB).')
      const text = await f.text()
      const t = f.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{') || text.trimStart().startsWith('[') ? parseJsonTable(text) : parseCsv(text)
      if (t.length < 2) throw new Error('Il file non contiene righe da importare.')
      setTable(t); setMap(autoMap(t[0])); setName(f.name)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setTable(null) }
  }

  const confirm = () => {
    const n = importEntries(rows.map((r) => ({ title: r.title, categoryId: categoryFor(r.group, cats), username: r.username, password: r.password, url: r.url, notes: r.notes })), scope)
    showToast(`${n} voci importate (${scope === 'common' ? 'comuni' : 'personali'})`)
    close()
  }

  return (
    <Sheet open={importOpen} onClose={close} title="Importa password">
      {!table ? (
        <div className="space-y-3 pt-1">
          <p className="text-sm text-muted">Esporta le password dal vecchio programma (KeePass: <i>File → Esporta → CSV</i>; vanno bene anche Bitwarden, Chrome e simili) e scegli qui il file. Il file viene letto solo su questo dispositivo.</p>
          <button className="glass-btn btn-primary w-full !py-3" onClick={() => input.current?.click()}><FileUp size={18} />Scegli file CSV o JSON</button>
          <input ref={input} type="file" accept=".csv,.json,text/csv,application/json,text/plain" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
          {err && <p role="alert" className="rounded-xl bg-exp/10 p-3 text-sm text-exp">{err}</p>}
          <p className="rounded-xl bg-brand/10 p-3 text-xs text-muted">Poi cancella il file esportato: contiene le password in chiaro.</p>
        </div>
      ) : (
        <div className="pt-1">
          <p className="text-sm text-muted">{name} · {table.length - 1} righe</p>
          <p className="label">Mappatura dei campi</p>
          <div className="space-y-2">
            {FIELDS.map((f) => (
              <label key={f.id} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 font-semibold">{f.label}</span>
                <select className="field !py-1.5" value={map[f.id]} onChange={(e) => setMap((m) => ({ ...m, [f.id]: Number(e.target.value) }))} aria-label={f.label}>
                  <option value={-1}>— nessuna —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Colonna ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <p className="label">Anteprima ({Math.min(5, rows.length)} di {rows.length})</p>
          <ul className="space-y-2">
            {rows.slice(0, 5).map((r, i) => (
              <li key={i} className="rounded-2xl border border-line bg-bg/60 p-3 text-sm">
                <p className="font-semibold">{r.title}</p>
                <p className="truncate text-xs text-muted">{r.username || '—'} · {'•'.repeat(Math.min(r.password.length, 10)) || 'nessuna password'}</p>
                <p className="truncate text-xs text-muted">Categoria: {cats.find((c) => c.id === categoryFor(r.group, cats))?.name}</p>
              </li>
            ))}
          </ul>
          <p className="label">Importa come</p>
          <Segmented<Scope> value={scope} onChange={setScope} options={[{ id: 'personal', label: 'Personali' }, { id: 'common', label: 'Comuni' }]} />
          <p className="mt-1.5 px-1 text-xs text-muted">I gruppi che non corrispondono a una categoria esistente finiscono in «Generale»: l’importazione non crea categorie.</p>
          <div className="mt-5 flex gap-2">
            <button className="glass-btn flex-1" onClick={() => setTable(null)}>Indietro</button>
            <button className="glass-btn btn-primary flex-[2] !py-3" disabled={!rows.length || map.password < 0 && map.username < 0} onClick={confirm}>Importa {rows.length} voci</button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
