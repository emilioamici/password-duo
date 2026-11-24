import { Folder, Loader2, RefreshCw, ShieldCheck, Smartphone, UserRound, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import * as drive from '../services/googleDriveService'
import { hasSession } from '../services/broker'
import { clearInvite, pendingInvite } from '../services/invite'
import { useVault } from '../store/VaultContext'
import { PasswordInput, StrengthBar } from './ui'

type Phase = 'login' | 'choose' | 'none' | 'invite' | 'local'
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const MIN_FAMILY = 10
export const MIN_PERSONAL = 8

/** Form di creazione: nome della casa, nome del Capofamiglia, Password di Famiglia e password personale. */
function NewHouseForm({ busy, submitLabel, onSubmit }: { busy: boolean; submitLabel: string; onSubmit: (a: { houseName: string; ownerName: string; familyPassword: string; personalSecret: string }) => void }) {
  const [houseName, setHouseName] = useState('La nostra famiglia')
  const [ownerName, setOwnerName] = useState('')
  const [fam, setFam] = useState(''); const [fam2, setFam2] = useState('')
  const [per, setPer] = useState(''); const [per2, setPer2] = useState('')
  const problem =
    fam.length < MIN_FAMILY ? `La Password di Famiglia deve avere almeno ${MIN_FAMILY} caratteri.`
    : fam !== fam2 ? 'Le due Password di Famiglia non coincidono.'
    : per.length < MIN_PERSONAL ? `La password personale deve avere almeno ${MIN_PERSONAL} caratteri.`
    : per !== per2 ? 'Le due password personali non coincidono.'
    : per === fam ? 'La password personale deve essere diversa da quella di famiglia.'
    : ''
  return (
    <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (!problem && !busy) onSubmit({ houseName, ownerName, familyPassword: fam, personalSecret: per }) }}>
      <label className="label !mt-0" htmlFor="hn">Nome della famiglia</label>
      <input id="hn" className="field" value={houseName} onChange={(e) => setHouseName(e.target.value)} />
      <label className="label" htmlFor="on">Il tuo nome</label>
      <input id="on" className="field" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Come ti chiamano a casa" />
      <label className="label">Password di Famiglia</label>
      <PasswordInput value={fam} onChange={setFam} autoComplete="new-password" ariaLabel="Password di Famiglia" />
      <div className="pt-1"><StrengthBar password={fam} /></div>
      <PasswordInput value={fam2} onChange={setFam2} autoComplete="new-password" placeholder="Ripetila" ariaLabel="Ripeti Password di Famiglia" />
      <p className="px-1 pt-1 text-xs text-muted">Cifra le password <b>comuni</b>. La conoscono tutti i familiari: condividila di persona, mai via email.</p>
      <label className="label">Password personale</label>
      <PasswordInput value={per} onChange={setPer} autoComplete="new-password" ariaLabel="Password personale" />
      <PasswordInput value={per2} onChange={setPer2} autoComplete="new-password" placeholder="Ripetila" ariaLabel="Ripeti password personale" />
      <p className="px-1 pt-1 text-xs text-muted">Cifra le tue password <b>personali</b>: gli altri non possono leggerle. Usa una frase lunga, non un PIN corto: chiunque abbia il file potrebbe provare a indovinarla.</p>
      <p className="rounded-xl bg-exp/10 p-3 text-xs text-exp">Se dimentichi queste password i dati non si possono recuperare: nessuno, nemmeno io, può decifrarli.</p>
      {problem && fam && <p className="px-1 text-xs text-muted">{problem}</p>}
      <button type="submit" className="glass-btn btn-primary mt-2 w-full !py-3" disabled={busy || !!problem}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}{submitLabel}
      </button>
    </form>
  )
}

/**
 * Prima pagina: «Accedi con Google». Dopo l'accesso la cassaforte viene ritrovata su Drive e collegata in automatico;
 * se non c'è se ne crea una o ci si unisce a quella di un altro (invito, ID famiglia o selettore di Google).
 */
export function Gate({ reconnect = false }: { reconnect?: boolean }) {
  const app = useVault()
  const { config, user } = app
  const [phase, setPhase] = useState<Phase>('login')
  const [files, setFiles] = useState<drive.DriveMeta[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [joinId, setJoinId] = useState('')
  const pickerOk = drive.pickerAvailable(config)

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  const started = useRef(false)
  const invite = pendingInvite()

  /** Dopo l'accesso: con un invito si apre quel file; se l'app non ha ancora il permesso si chiede un tocco sul Picker. */
  const afterConnect = async (found: drive.DriveMeta[]) => {
    const inv = pendingInvite()
    if (inv) {
      try { await app.joinHouse(inv, false); return } catch (e) { if (!(e instanceof drive.NotFoundError)) throw e }
      setPhase('invite'); return
    }
    if (found.length === 1) await app.joinHouse(found[0].id, false) // una sola casa: collegamento automatico
    else { setFiles(found); setPhase(found.length > 1 ? 'choose' : 'none') }
  }
  const afterLogin = async () => { await afterConnect(await app.connect()) }

  // ritorno dal login di Google (pagina intera): la sessione c'è già, si prosegue da soli
  useEffect(() => {
    if (!reconnect && !started.current && (drive.hasValidToken() || hasSession())) { started.current = true; void guard(afterLogin) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = () => guard(async () => {
    if (reconnect) { await app.reconnect(); return }
    await afterLogin()
  })

  /** ID famiglia: si prova ad aprire il file; con l'accesso ristretto ai file un tocco sul Picker concede il permesso. */
  const joinWithId = async () => {
    try { await app.joinHouse(joinId, false) } catch (e) {
      if (e instanceof drive.NotFoundError && pickerOk) await app.joinHouse(joinId, true)
      else if (e instanceof drive.NotFoundError) throw new Error('Non riesco ad aprire la cassaforte: controlla l’ID e che ti abbia invitato con questo account Google.')
      else throw e
    }
  }

  const search = () => guard(async () => { await afterConnect(await drive.findDbFiles()) })

  return (
    <div className="flex min-h-full flex-col justify-center px-1 py-10">
      <div className="mb-8 text-center">
        <img src={import.meta.env.BASE_URL + 'app-icon.png'} alt="" draggable={false} className="mx-auto mb-4 h-32 w-32 rounded-[28%] shadow-[0_12px_30px_-10px_rgb(var(--glass-shade))]" />
        <h1 className="text-3xl font-extrabold tracking-tight">Password<span className="text-brand">Duo</span></h1>
        <p className="mt-2 text-sm text-muted">La cassaforte di famiglia. Cifrata sul tuo dispositivo, sincronizzata nel tuo Google Drive.</p>
      </div>

      <div className="glass-strong space-y-4 p-5">
        {err && <p role="alert" className="rounded-xl bg-exp/10 p-3 text-sm text-exp">{err}</p>}

        {phase === 'login' && reconnect && (
          <>
            <h2 className="text-lg font-bold">Sessione Google scaduta</h2>
            <p className="text-sm text-muted">{user?.email ? <>Per continuare a sincronizzare accedi di nuovo come <b>{user.email}</b>.</> : 'Per continuare a sincronizzare accedi di nuovo.'} Le password restano cifrate al sicuro su Drive e su questo dispositivo.</p>
          </>
        )}
        {phase === 'login' && !reconnect && invite && (
          <p className="rounded-xl bg-brand/10 p-3 text-sm font-semibold text-brand">Hai un invito per una cassaforte: accedi con Google per entrare.</p>
        )}
        {phase === 'login' && !reconnect && (
          <p className="text-sm text-muted">Accedi con il <b>tuo account Google</b>. Se la cassaforte di famiglia è già su Drive la ritrovo io; altrimenti puoi crearne una nuova.</p>
        )}

        {phase === 'login' && (
          <>
            {!config.clientId && (
              <div className="rounded-xl bg-brand/10 p-3 text-sm">
                <p className="mb-2">Manca il Client ID OAuth di Google Cloud (vedi README).</p>
                <input className="field" placeholder="xxxx.apps.googleusercontent.com" autoCapitalize="none" autoCorrect="off" aria-label="Google Client ID"
                  onBlur={(e) => app.setConfig({ ...config, clientId: e.target.value.trim() })} />
              </div>
            )}
            <button className="glass-btn btn-primary w-full !py-3" disabled={busy || !config.clientId} onClick={() => void login()}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <UserRound size={18} />}Accedi con Google
            </button>
            {reconnect ? (
              <>
                <button className="glass-btn w-full !text-xs" disabled={busy} onClick={() => app.setOfflineSkipped(true)}>Continua senza sincronizzare</button>
                <button className="glass-btn w-full !text-xs" disabled={busy} onClick={() => void app.disconnect()}>Scollega questa cassaforte</button>
              </>
            ) : (
              <button className="glass-btn w-full !text-xs" disabled={busy} onClick={() => setPhase('local')}><Smartphone size={14} />Usa solo su questo dispositivo</button>
            )}
          </>
        )}

        {phase === 'local' && (
          <>
            <h2 className="text-lg font-bold">Cassaforte solo locale</h2>
            <p className="text-sm text-muted">Resta cifrata su questo dispositivo, senza Google. Potrai collegarla a Drive più tardi dalla scheda Famiglia.</p>
            <NewHouseForm busy={busy} submitLabel="Crea cassaforte" onSubmit={(a) => void guard(() => app.createLocal(a))} />
            <button className="glass-btn w-full !text-xs" disabled={busy} onClick={() => setPhase('login')}>Indietro</button>
          </>
        )}

        {phase === 'invite' && invite && (
          <>
            <h2 className="text-lg font-bold">Ti hanno invitato in una famiglia</h2>
            <p className="text-sm text-muted">Per entrare tocca il pulsante e scegli il file della cassaforte: serve a dare a Password Duo il permesso di aprirlo. Si fa una volta sola.</p>
            {pickerOk ? (
              <button className="glass-btn btn-primary w-full !py-3" disabled={busy} onClick={() => void guard(() => app.joinHouse(invite, true))}>
                {busy ? <Loader2 size={18} className="animate-spin" /> : <Folder size={18} />}Scegli il file e unisciti
              </button>
            ) : <p className="rounded-xl bg-brand/10 p-3 text-sm">Il selettore di Google non è configurato in questa installazione (servono VITE_GOOGLE_API_KEY e VITE_GOOGLE_APP_ID, vedi README).</p>}
            <button className="glass-btn w-full !text-xs" disabled={busy} onClick={() => { clearInvite(); setPhase('none') }}>Non è il mio invito</button>
          </>
        )}

        {phase === 'choose' && (
          <>
            <p className="text-sm text-muted">Hai accesso a più cassaforti. Quale vuoi aprire?</p>
            <div className="space-y-2">
              {files.map((f) => (
                <button key={f.id} disabled={busy} onClick={() => void guard(() => app.joinHouse(f.id, false))} className="w-full rounded-xl border border-line p-3 text-left text-sm active:bg-line/40">
                  <p className="font-semibold">{f.name}</p>
                  <p className="text-xs text-muted">Proprietario: {f.ownerEmail || '—'} · aggiornata {new Date(f.modifiedTime).toLocaleDateString('it-IT')}</p>
                </button>
              ))}
            </div>
          </>
        )}

        {phase === 'none' && (
          <>
            <p className="text-sm">Nessuna cassaforte trovata per <b>{user?.email ?? 'questo account'}</b>.</p>

            <div className="space-y-3 rounded-2xl border border-line p-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><Users size={16} className="text-brand" />Crea la cassaforte di famiglia</p>
              <p className="text-xs text-muted">Sarai il <b>Capofamiglia</b>: il file vive nel tuo Drive e solo tu potrai invitare i familiari e gestire le categorie.</p>
              <NewHouseForm busy={busy} submitLabel="Crea cassaforte" onSubmit={(a) => void guard(() => app.createHouse(a))} />
            </div>

            <div className="space-y-2 rounded-2xl border border-line p-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><Folder size={16} className="text-brand" />Entra con l’ID famiglia</p>
              <p className="text-xs text-muted">Il Capofamiglia ti manda l’ID (o il link) che trova in Famiglia → Condivisione. Incollalo qui.</p>
              <input className="field font-mono !text-xs" placeholder="ID famiglia o link" value={joinId} onChange={(e) => setJoinId(e.target.value)} autoCapitalize="none" autoCorrect="off" aria-label="ID famiglia" />
              <button className="glass-btn btn-primary w-full" disabled={busy || !joinId.trim()} onClick={() => void guard(joinWithId)}>
                {busy ? <Loader2 size={18} className="animate-spin" /> : <Folder size={18} />}Entra
              </button>
              {pickerOk && <p className="text-xs text-muted">Al primo accesso Google può chiederti di confermare il file con un tocco: serve a dare a Password Duo il permesso di aprirlo.</p>}
            </div>

            <p className="rounded-xl bg-brand/10 p-3 text-sm text-muted">
              Aspetti un invito? Chiedi di aggiungere <b>{user?.email ?? 'la tua email'}</b>, poi
              <button className="ml-1 inline-flex items-center gap-1 font-semibold text-brand" disabled={busy} onClick={() => void search()}><RefreshCw size={14} />cerca di nuovo</button>.
            </p>
          </>
        )}
      </div>
      <p className="mt-6 text-center text-xs text-muted">Su Drive finisce solo un file cifrato: Google, il server di accesso e chiunque lo trovi non vedono mai le tue password.</p>
    </div>
  )
}
