import { Loader2, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { UnlockError } from '../services/vaultModel'
import { useVault } from '../store/VaultContext'
import { MIN_PERSONAL } from './Gate'
import { MascotImg } from './Mascots'
import { Avatar, PasswordInput } from './ui'

/** Schermata di sblocco: Password di Famiglia + password personale. Al primo accesso dopo un invito si sceglie la propria password personale. */
export function UnlockScreen() {
  const { file, meta, unlock, lockReason, status, setOfflineSkipped, disconnect } = useVault()
  const me = file?.members.find((m) => m.id === meta.memberId)
  const setup = !!me && !me.personal
  const [fam, setFam] = useState('')
  const [per, setPer] = useState(''); const [per2, setPer2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const problem = setup && (per.length < MIN_PERSONAL ? `La password personale deve avere almeno ${MIN_PERSONAL} caratteri.` : per !== per2 ? 'Le due password personali non coincidono.' : '')

  const submit = async () => {
    setBusy(true); setErr('')
    try { await unlock(fam, per) } catch (e) {
      setErr(e instanceof UnlockError ? e.message : e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-full flex-col justify-center px-1 py-10">
      <div className="mb-6 text-center">
        <MascotImg kind="pair" className="mx-auto h-28 w-auto" />
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">{setup ? 'Benvenuto!' : 'Cassaforte bloccata'}</h1>
        <p className="mt-1 flex items-center justify-center gap-2 text-sm text-muted">{me && <Avatar member={me} size={22} />}{file?.houseName}{me ? ` · ${me.name}` : ''}</p>
      </div>
      <form className="glass-strong space-y-1 p-5" onSubmit={(e) => { e.preventDefault(); if (!busy && !problem && fam && per) void submit() }}>
        {lockReason && <p className="mb-2 rounded-xl bg-brand/10 p-3 text-sm text-brand">{lockReason}</p>}
        {err && <p role="alert" className="mb-2 rounded-xl bg-exp/10 p-3 text-sm text-exp">{err}</p>}
        {setup && <p className="mb-2 text-sm text-muted">Inserisci la <b>Password di Famiglia</b> che ti ha dato il Capofamiglia e scegli una <b>tua password personale</b> per le password che non vuoi condividere.</p>}
        <label className="label !mt-0">Password di Famiglia</label>
        <PasswordInput value={fam} onChange={setFam} autoComplete="current-password" ariaLabel="Password di Famiglia" />
        <label className="label">{setup ? 'Scegli la tua password personale' : 'Password personale'}</label>
        <PasswordInput value={per} onChange={setPer} autoComplete={setup ? 'new-password' : 'current-password'} ariaLabel="Password personale" />
        {setup && <div className="pt-2"><PasswordInput value={per2} onChange={setPer2} autoComplete="new-password" placeholder="Ripetila" ariaLabel="Ripeti password personale" /></div>}
        {setup && <p className="px-1 pt-1 text-xs text-muted">Usa una frase lunga: chi ha accesso al file potrebbe provare a indovinare una password corta. Se la dimentichi non si recupera.</p>}
        {problem && per && <p className="px-1 pt-1 text-xs text-muted">{problem}</p>}
        <button type="submit" className="glass-btn btn-primary !mt-4 w-full !py-3" disabled={busy || !fam || !per || !!problem}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <LockKeyhole size={18} />}{setup ? 'Crea e sblocca' : 'Sblocca'}
        </button>
        {status === 'auth' && <button type="button" className="glass-btn mt-2 w-full !text-xs" onClick={() => setOfflineSkipped(false)}>Riconnetti Google</button>}
        <button type="button" className="glass-btn mt-2 w-full !text-xs" onClick={() => { if (window.confirm('Scollegare questa cassaforte dal dispositivo? Le password restano cifrate su Drive.')) void disconnect() }}>Scollega da questo dispositivo</button>
      </form>
    </div>
  )
}
