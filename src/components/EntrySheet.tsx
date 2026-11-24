import { Copy, ExternalLink, Eye, EyeOff, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { GENERAL_CATEGORY_ID, type Entry, type Scope } from '../types'
import { canEditCommon } from '../services/vaultModel'
import { copyText } from '../lib/clipboard'
import { liveCategories } from '../lib/entries'
import { useVault, type NewEntryInput } from '../store/VaultContext'
import { useUi } from '../store/UiContext'
import { GeneratorPanel, quickGenerate } from './GeneratorPanel'
import { PICK_COLORS, autoColor, iconFor } from './icons'
import { ConfirmButton, PasswordInput, Segmented, Sheet, StrengthBar } from './ui'

const EMPTY: NewEntryInput = { title: '', categoryId: GENERAL_CATEGORY_ID, username: '', password: '', url: '', notes: '' }

function safeUrl(u: string): string | null {
  const s = u.trim()
  if (!s) return null
  try { const x = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`); return x.protocol === 'http:' || x.protocol === 'https:' ? x.toString() : null } catch { return null }
}

/** Foglio di una voce: nuova (modifica diretta), oppure esistente (consultazione con copia e mostra/nascondi, poi «Modifica»). */
export function EntrySheet() {
  const { entrySheet, openEntrySheet, showToast } = useUi()
  const { session, isOwner, meId, addEntry, updateEntry, deleteEntry, prefs, file } = useVault()
  const open = !!entrySheet
  const found = useMemo(() => {
    if (!entrySheet?.id || !session) return null
    for (const scope of ['common', 'personal'] as Scope[]) {
      const e = (scope === 'common' ? session.common.entries : session.personal.entries).find((x) => x.id === entrySheet.id && !x.deleted)
      if (e) return { entry: e, scope }
    }
    return null
  }, [entrySheet, session])
  const cats = session ? liveCategories(session) : []

  const [editing, setEditing] = useState(false)
  const [scope, setScope] = useState<Scope>('personal')
  const [f, setF] = useState<NewEntryInput>(EMPTY)
  const [showPw, setShowPw] = useState(false)
  const [gen, setGen] = useState(false)

  useEffect(() => {
    if (!entrySheet) return
    setShowPw(false); setGen(false)
    if (found) {
      const e: Entry = found.entry
      setF({ title: e.title, categoryId: e.categoryId, username: e.username, password: e.password, url: e.url, notes: e.notes, color: e.color })
      setScope(found.scope); setEditing(false)
    } else {
      setF({ ...EMPTY, password: entrySheet.password ?? '' }); setScope(entrySheet.scope ?? 'personal'); setEditing(true)
    }
  }, [entrySheet, found])

  const close = () => openEntrySheet(null)
  const canEdit = !found || found.scope === 'personal' || canEditCommon(found.entry, meId, isOwner)
  const authorName = found ? file?.members.find((m) => m.id === found.entry.createdBy)?.name : undefined
  const set = <K extends keyof NewEntryInput>(k: K, v: NewEntryInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const copy = async (what: string, value: string) => {
    if (!value) return
    const ok = await copyText(value, prefs.clearClipboard)
    showToast(ok ? `${what} copiato${what === 'Password' && prefs.clearClipboard ? ' · appunti svuotati tra 30 s' : ''}` : 'Copia non riuscita')
  }
  const save = () => {
    if (!f.title.trim()) return
    if (found) updateEntry(found.scope, found.entry.id, f, scope); else addEntry(scope, f)
    showToast(found ? 'Voce aggiornata' : scope === 'common' ? 'Voce comune salvata' : 'Voce personale salvata')
    close()
  }
  const color = f.color ?? autoColor(f.title || 'x')
  const Cat = iconFor(cats.find((c) => c.id === f.categoryId)?.icon ?? 'Folder')

  return (
    <Sheet open={open} onClose={close} title={!found ? 'Nuova voce' : editing ? 'Modifica voce' : f.title}>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); save() }}>
          <label className="label !mt-1">Visibilità</label>
          <Segmented<Scope> value={scope} onChange={setScope} options={[{ id: 'personal', label: 'Personale' }, { id: 'common', label: 'Comune' }]} />
          <p className="mt-1.5 px-1 text-xs text-muted">{scope === 'personal' ? 'Solo tu puoi leggerla (cifrata con la tua password personale).' : 'La vedono e la usano tutti i familiari (cifrata con la Password di Famiglia).'}</p>

          <label className="label" htmlFor="et">Titolo / Servizio</label>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-inner" style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)` }}>
              <Cat size={20} />
            </span>
            <input id="et" className="field" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Netflix, Banca, Wi-Fi casa…" autoFocus={!found} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Colore">
            {PICK_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Colore ${c}`} aria-pressed={color === c} onClick={() => set('color', c)} className={`h-7 w-7 rounded-full transition active:scale-90 ${color === c ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface' : ''}`} style={{ background: c }} />
            ))}
          </div>

          <label className="label">Categoria</label>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            {cats.map((c) => { const I = iconFor(c.icon); return <button key={c.id} type="button" className={`chip ${f.categoryId === c.id ? 'chip-active' : ''}`} onClick={() => set('categoryId', c.id)}><I size={14} />{c.name}</button> })}
          </div>

          <label className="label" htmlFor="eu">Username / Email</label>
          <input id="eu" className="field" value={f.username} onChange={(e) => set('username', e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="off" />

          <label className="label">Password</label>
          <PasswordInput value={f.password} onChange={(v) => set('password', v)} mono ariaLabel="Password della voce" />
          <div className="mt-2"><StrengthBar password={f.password} /></div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="glass-btn flex-1 !text-xs" onClick={() => { set('password', quickGenerate()); setGen(false) }}><Sparkles size={14} />Genera</button>
            <button type="button" className="glass-btn flex-1 !text-xs" onClick={() => setGen((g) => !g)}>{gen ? 'Chiudi opzioni' : 'Opzioni generatore'}</button>
          </div>
          {gen && <div className="mt-3 rounded-2xl border border-line bg-bg/60 p-3"><GeneratorPanel useLabel="Inserisci" onUse={(pw) => { set('password', pw); setGen(false) }} /></div>}

          <label className="label" htmlFor="ew">Sito web</label>
          <input id="ew" className="field" value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" inputMode="url" autoCapitalize="none" autoCorrect="off" />

          <label className="label" htmlFor="en">Note sicure</label>
          <textarea id="en" className="field min-h-24" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="PIN, domande di sicurezza, codici di recupero 2FA…" />

          <div className="mt-5 flex gap-2">
            {found && <button type="button" className="glass-btn flex-1" onClick={() => setEditing(false)}>Annulla</button>}
            <button type="submit" className="glass-btn btn-primary flex-[2] !py-3" disabled={!f.title.trim()}>Salva</button>
          </div>
        </form>
      ) : (
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-brand/15 px-2 py-0.5 font-semibold text-brand">{scope === 'common' ? 'Comune' : 'Personale'}</span>
            <span className="rounded-full bg-line/70 px-2 py-0.5 font-semibold text-muted">{cats.find((c) => c.id === f.categoryId)?.name ?? 'Generale'}</span>
            {scope === 'common' && authorName && <span className="text-muted">di {authorName}</span>}
          </div>
          <Row label="Username / Email" value={f.username} onCopy={() => void copy('Username', f.username)} />
          <div>
            <p className="label !mt-0">Password</p>
            <div className="flex items-center gap-2 rounded-2xl border border-line bg-bg px-3.5 py-2.5">
              <span className="min-w-0 flex-1 break-all font-mono text-[15px]" data-testid="pw-value">{showPw ? f.password : '•'.repeat(Math.min(f.password.length || 8, 20))}</span>
              <button className="p-1.5 text-muted active:scale-90" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Nascondi password' : 'Mostra password'}>{showPw ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              <button className="p-1.5 text-brand active:scale-90" onClick={() => void copy('Password', f.password)} aria-label="Copia password"><Copy size={18} /></button>
            </div>
            {showPw && <div className="mt-2"><StrengthBar password={f.password} /></div>}
          </div>
          {safeUrl(f.url) && (
            <div>
              <p className="label !mt-0">Sito web</p>
              <a href={safeUrl(f.url)!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-2xl border border-line bg-bg px-3.5 py-2.5 text-[15px] font-semibold text-brand"><span className="min-w-0 flex-1 truncate">{f.url}</span><ExternalLink size={16} /></a>
            </div>
          )}
          {f.notes && <div><p className="label !mt-0">Note sicure</p><p className="whitespace-pre-wrap rounded-2xl border border-line bg-bg px-3.5 py-2.5 text-sm">{f.notes}</p></div>}
          {found && <p className="px-1 text-xs text-muted">Aggiornata il {new Date(found.entry.updatedAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
          {canEdit ? (
            <div className="flex gap-2 pt-2">
              <ConfirmButton label="Elimina" icon={<Trash2 size={16} />} className="flex-1" onConfirm={() => { if (found) { deleteEntry(found.scope, found.entry.id); showToast('Voce eliminata'); close() } }} />
              <button className="glass-btn btn-primary flex-[2]" onClick={() => setEditing(true)}><Pencil size={16} />Modifica</button>
            </div>
          ) : <p className="rounded-xl bg-line/50 p-3 text-xs text-muted">Solo chi l’ha creata ({authorName ?? 'un altro familiare'}) o il Capofamiglia può modificare questa voce comune.</p>}
        </div>
      )}
    </Sheet>
  )
}

function Row({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  if (!value) return null
  return (
    <div>
      <p className="label !mt-0">{label}</p>
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-bg px-3.5 py-2.5">
        <span className="min-w-0 flex-1 break-all text-[15px]">{value}</span>
        <button className="p-1.5 text-brand active:scale-90" onClick={onCopy} aria-label={`Copia ${label}`}><Copy size={18} /></button>
      </div>
    </div>
  )
}
