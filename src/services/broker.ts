/**
 * Accesso persistente tramite il Worker (vedi worker/README.md): il server conserva il token di rinnovo e l'app
 * ottiene token Google freschi da sola, senza popup né tocchi, anche in background. Sul dispositivo resta solo
 * un identificativo di sessione casuale.
 */
import { authUrl } from './authUrl'

const SID_KEY = 'pwduo:session'
const HASH = 'pwduo_session='

const read = (): string => { try { return localStorage.getItem(SID_KEY) || '' } catch { return '' } }
export const hasSession = (): boolean => !!read()
/** Identificativo della sessione di accesso persistente (serve solo a chi registra la casa sul ponte). */
export const sessionId = (): string => read()
export function clearSession(): void { try { localStorage.removeItem(SID_KEY) } catch { /* noop */ } }

/** Dopo il ritorno da Google l'identificativo di sessione è nel frammento dell'indirizzo: lo si salva e lo si toglie dalla barra. */
export function consumeSessionFromUrl(): boolean {
  try {
    const h = window.location.hash.replace(/^#/, '')
    if (!h.startsWith(HASH)) return false
    const sid = decodeURIComponent(h.slice(HASH.length))
    if (/^[\w-]{30,80}$/.test(sid)) localStorage.setItem(SID_KEY, sid)
    history.replaceState(null, '', window.location.pathname + window.location.search)
    return true
  } catch { return false }
}

let availability: Promise<boolean> | null = null
/** Il server esiste ed è configurato per l'accesso persistente? */
export function brokerAvailable(): Promise<boolean> {
  const base = authUrl()
  if (!base) return Promise.resolve(false)
  availability ??= fetch(base + '/health').then((r) => (r.ok ? r.json() : null)).then((j) => !!j?.auth).catch(() => false)
  return availability
}

/** Apre il flusso di accesso di Google passando dal Worker; al ritorno l'app riparte con la sessione nel frammento. */
export function startBrokerLogin(hint?: string | null): void {
  const back = window.location.origin + window.location.pathname
  const q = new URLSearchParams({ return: back, scope: 'file' }) // permesso ristretto: solo i file dell'app
  if (hint) q.set('hint', hint)
  window.location.assign(`${authUrl()}/auth/start?${q}`)
}

export interface Refreshed { token: string; expiresIn: number; email: string }
export class SessionExpired extends Error {}

/** Token d'accesso fresco dalla sessione. Lancia SessionExpired se la sessione non vale più (serve un nuovo accesso). */
export async function refreshAccessToken(): Promise<Refreshed | null> {
  const sid = read()
  if (!sid || !authUrl()) return null
  const r = await fetch(authUrl() + '/auth/refresh', { method: 'POST', headers: { Authorization: `Bearer ${sid}` }, body: '{}' })
  if (r.status === 401) { clearSession(); throw new SessionExpired('Sessione scaduta') }
  if (!r.ok) throw new Error('Server di accesso non raggiungibile')
  const j = (await r.json()) as { access_token: string; expires_in: number; email: string }
  return { token: j.access_token, expiresIn: j.expires_in, email: j.email }
}

export async function logoutBroker(): Promise<void> {
  const sid = read()
  clearSession()
  if (sid && authUrl()) await fetch(authUrl() + '/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${sid}` }, body: '{}' }).catch(() => undefined)
}
