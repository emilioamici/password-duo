import { Cloud, Copy, Download, FileUp, HardDrive, KeyRound, LogOut, Loader2, Lock, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { activeMembers } from '../services/vaultModel'
import { inviteLink } from '../services/invite'
import { copyText } from '../lib/clipboard'
import { useVault } from '../store/VaultContext'
import { useUi } from '../store/UiContext'
import { MIN_FAMILY, MIN_PERSONAL } from './Gate'
import { LockButton, SyncPill } from './Chrome'
import { MascotPeek } from './Mascots'
import { Accordion, Avatar, ConfirmButton, PageHeader, PasswordInput, StrengthBar, Toggle } from './ui'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
type Sec = 'sync' | 'members' | 'security' | 'backup' | null
const SEC_KEY = 'pwduo:open'

/** Cambio di una password (famiglia o personale) con doppia digitazione. */
function ChangePassword({ label, min, onSave, hint }: { label: string; min: number; hint: string; onSave: (pw: string) => Promise<void> }) {
  const [a, setA] = useState(''); const [b, setB] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState(false)
  const bad = a.length < min ? `Almeno ${min} caratteri.` : a !== b ? 'Le due password non coincidono.' : ''
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault(); if (bad || busy) return
      setBusy(true); setErr(''); setOk(false)
      try { await onSave(a); setA(''); setB(''); setOk(true) } catch (x) { setErr(msg(x)) } finally { setBusy(false) }
    }}>
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs text-muted">{hint}</p>
      <PasswordInput value={a} onChange={setA} autoComplete="new-password" placeholder="Nuova password" ariaLabel={`Nuova ${label}`} />
      <StrengthBar password={a} />
      <PasswordInput value={b} onChange={setB} autoComplete="new-password" placeholder="Ripetila" ariaLabel={`Ripeti ${label}`} />
      {err && <p role="alert" className="rounded-xl bg-exp/10 p-2 text-xs text-exp">{err}</p>}
      {ok && <p className="rounded-xl bg-inc/10 p-2 text-xs text-inc">Password cambiata.</p>}
      <button type="submit" className="glass-btn w-full" disabled={busy || !!bad}>{busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}Cambia</button>
    </form>
  )
}

export function FamilyView() {
  const app = useVault()
  const { file, meta, isOwner, user, prefs, setPrefs, status, statusMessage, meId } = app
  const { openImport, showToast } = useUi()
  const [open, setOpen] = useState<Sec>(() => { try { return (localStorage.getItem(SEC_KEY) as Sec) || 'members' } catch { return 'members' } })
  const toggle = (s: Exclude<Sec, null>) => setOpen((cur) => { const n = cur === s ? null : s; try { localStorage.setItem(SEC_KEY, n ?? '') } catch { /* noop */ } return n })
  const [email, setEmail] = useState(''); const [name, setName] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [rotate, setRotate] = useState(false)
  const members = file ? activeMembers(file) : []
  const guard = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) } }

  const download = () => {
    const blob = new Blob([app.exportBackup()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `family-vault-db-${new Date().toISOString().slice(0, 10)}.enc.json`
    document.body.appendChild(a); a.click(); a.remove()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    showToast('Backup cifrato scaricato')
  }

  const syncSummary = meta.mode === 'local' ? 'Solo su questo dispositivo' : status === 'idle' ? 'Sincronizzata con Google Drive' : statusMessage || 'In attesa'

  return (
    <>
      <PageHeader title="Famiglia" subtitle={file?.houseName} right={<><SyncPill /><LockButton /></>} />
      <MascotPeek kind="pair">
        <div className="space-y-3">
          <Accordion title="Sincronizzazione" icon={<Cloud size={20} />} summary={syncSummary} open={open === 'sync'} onToggle={() => toggle('sync')}>
            <div className="space-y-3 text-sm">
              {meta.mode === 'drive' ? (
                <>
                  <p>File su Drive: <b className="font-mono text-xs">family-vault-db.enc.json</b></p>
                  <p className="text-muted">Capofamiglia (proprietario del file): <b className="text-ink">{meta.ownerEmail || '—'}</b>{user && <><br />Accesso come: <b className="text-ink">{user.email}</b></>}</p>
                  {statusMessage && <p className="rounded-xl bg-brand/10 p-2 text-xs text-brand">{statusMessage}</p>}
                  <p className="text-xs text-muted">Il controllo dei conflitti usa la <i>versione</i> del file su Drive: prima di scrivere si rilegge, si uniscono le modifiche e si riprova.</p>
                  <button className="glass-btn w-full" onClick={() => void app.syncNow()}><Cloud size={16} />Sincronizza ora</button>
                </>
              ) : (
                <>
                  <p className="text-muted">La cassaforte è cifrata su questo dispositivo. Collegandola a Google Drive potrai condividerla con la famiglia: il file caricato resta cifrato.</p>
                  {err && <p role="alert" className="rounded-xl bg-exp/10 p-2 text-xs text-exp">{err}</p>}
                  <button className="glass-btn btn-primary w-full" disabled={busy} onClick={() => void guard(app.upgradeToDrive)}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}Collega a Google Drive</button>
                </>
              )}
            </div>
          </Accordion>

          <Accordion title="Membri e condivisione" icon={<Users size={20} />} summary={`${members.length} ${members.length === 1 ? 'persona' : 'persone'}`} open={open === 'members'} onToggle={() => toggle('members')}>
            <ul className="space-y-2">
              {members.map((m) => {
                const isChief = meta.mode === 'local' ? m.id === meId : m.email === meta.ownerEmail
                return (
                  <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-line bg-bg/60 p-2.5">
                    <Avatar member={m} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{m.name}{m.id === meId && <span className="font-normal text-muted"> (tu)</span>}</p>
                      <p className="truncate text-xs text-muted">{m.email || 'solo locale'}</p>
                    </div>
                    {isChief ? <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">Capofamiglia</span>
                      : !m.personal ? <span className="rounded-full bg-line/70 px-2 py-0.5 text-[11px] font-semibold text-muted">Invitato</span> : null}
                    {isOwner && !isChief && m.id !== meId && (
                      <ConfirmButton label="" confirmLabel="Rimuovi?" className="!p-2 text-xs" icon={<Trash2 size={16} />} onConfirm={() => void guard(async () => { await app.removeFamilyMember(m.id); setRotate(true) })} />
                    )}
                  </li>
                )
              })}
            </ul>
            {err && <p role="alert" className="mt-3 rounded-xl bg-exp/10 p-2 text-xs text-exp">{err}</p>}
            {rotate && <p className="mt-3 rounded-xl bg-brand/10 p-3 text-xs text-brand">Membro rimosso dal file. Conosceva la Password di Famiglia e potrebbe avere una copia vecchia del file: cambia la Password di Famiglia (sezione Sicurezza) e comunicala di persona agli altri.</p>}

            {isOwner && meta.mode === 'drive' && (
              <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); void guard(async () => { await app.shareWith(email, name); showToast(`Invito inviato a ${email}`); setEmail(''); setName('') }) }}>
                <p className="flex items-center gap-2 text-sm font-semibold"><UserPlus size={16} className="text-brand" />Invita un familiare</p>
                <input className="field" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email Google del familiare" autoCapitalize="none" autoCorrect="off" aria-label="Email del familiare" />
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (facoltativo)" aria-label="Nome del familiare" />
                <button type="submit" className="glass-btn btn-primary w-full" disabled={busy || !email.trim()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}Invita con Google Drive</button>
                <p className="text-xs text-muted">Gli arriva un’email di Drive con il link. La <b>Password di Famiglia</b> dagliela di persona: non viaggia mai con l’invito.</p>
                <div className="flex gap-2">
                  <button type="button" className="glass-btn flex-1 !text-xs" onClick={() => void copyText(inviteLink(meta.fileId), false).then(() => showToast('Link d’invito copiato'))}><Copy size={14} />Copia link</button>
                  <button type="button" className="glass-btn flex-1 !text-xs" onClick={() => void copyText(meta.fileId, false).then(() => showToast('ID famiglia copiato'))}><Copy size={14} />Copia ID</button>
                </div>
              </form>
            )}
            {!isOwner && meta.mode === 'drive' && <p className="mt-3 rounded-xl bg-line/50 p-3 text-xs text-muted">Solo il Capofamiglia ({meta.ownerEmail || 'proprietario del file'}) può invitare o rimuovere persone.</p>}
          </Accordion>

          <Accordion title="Sicurezza" icon={<ShieldCheck size={20} />} summary={`Blocco dopo ${prefs.autoLockMin} min`} open={open === 'security'} onToggle={() => toggle('security')}>
            <div className="space-y-4">
              <div>
                <label className="label !mt-0" htmlFor="al">Blocco automatico dopo</label>
                <select id="al" className="field" value={prefs.autoLockMin} onChange={(e) => setPrefs({ autoLockMin: Number(e.target.value) })}>
                  {[1, 2, 5, 10, 15].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'minuto' : 'minuti'} di inattività</option>)}
                </select>
              </div>
              <Toggle checked={prefs.lockOnHide} onChange={(v) => setPrefs({ lockOnHide: v })} label="Blocca quando l’app va in background" hint="Dopo 20 secondi, il tempo di incollare una password altrove." />
              <Toggle checked={prefs.clearClipboard} onChange={(v) => setPrefs({ clearClipboard: v })} label="Svuota gli appunti dopo 30 secondi" hint="Se il browser lo consente: con l’app non in primo piano potrebbe non riuscire." />
              <button className="glass-btn w-full" onClick={() => void app.lock()}><Lock size={16} />Blocca ora</button>
              <hr className="border-line/60" />
              <ChangePassword label="Password personale" min={MIN_PERSONAL} hint="Cifra le tue password personali. Gli altri dispositivi con cui entri dovranno usare quella nuova." onSave={app.changePersonalPw} />
              {isOwner ? (
                <>
                  <hr className="border-line/60" />
                  <ChangePassword label="Password di Famiglia" min={MIN_FAMILY} hint="Ricifra le password comuni. Dopo il cambio tutti i familiari dovranno inserire la nuova password al prossimo sblocco: comunicala di persona." onSave={async (pw) => { await app.changeFamilyPw(pw); setRotate(false) }} />
                </>
              ) : <p className="rounded-xl bg-line/50 p-3 text-xs text-muted">La Password di Famiglia può cambiarla solo il Capofamiglia.</p>}
            </div>
          </Accordion>

          <Accordion title="Backup e importazione" icon={<HardDrive size={20} />} summary="Esporta il file cifrato, importa da CSV/JSON" open={open === 'backup'} onToggle={() => toggle('backup')}>
            <div className="space-y-2">
              <button className="glass-btn w-full" onClick={download}><Download size={16} />Esporta backup cifrato</button>
              <p className="px-1 text-xs text-muted">Scarica una copia del file <span className="font-mono">.enc.json</span>: resta cifrata e si apre solo con le tue password.</p>
              <button className="glass-btn w-full" onClick={() => openImport(true)}><FileUp size={16} />Importa da CSV / JSON (KeePass…)</button>
            </div>
          </Accordion>

          <div className="card p-4">
            <ConfirmButton label="Scollega da questo dispositivo" confirmLabel="Tocca ancora per scollegare" className="w-full" icon={<LogOut size={16} />} onConfirm={() => void app.disconnect()} />
            <p className="mt-2 px-1 text-xs text-muted">{meta.mode === 'local' ? 'Attenzione: in modalità solo locale cancella la cassaforte da questo dispositivo. Esporta prima un backup.' : 'Le password restano cifrate su Drive; qui viene rimossa la copia locale.'}</p>
          </div>
        </div>
      </MascotPeek>
    </>
  )
}
