/**
 * Servizio Google Drive (API v3) + Google Identity Services (OAuth 2.0 client-side).
 * Scope: drive.file → l'app vede solo i file che ha creato o che l'utente ha aperto con il Picker.
 * Sul Drive viaggia solo il file cifrato `family-vault-db.enc.json`: Google non vede mai password né chiavi.
 */
import type { VaultFile } from '../types'
import { parseVault } from './vaultModel'
import { SessionExpired, brokerAvailable, hasSession, logoutBroker, refreshAccessToken, startBrokerLogin } from './broker'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { google?: any; gapi?: any }
}

export const SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const DB_FILE_NAME = 'family-vault-db.enc.json'
/** Marcatore per ritrovare il file anche se qualcuno lo rinomina. */
const PROP_KEY = 'passwordduo'
const PROP_VAL = 'vault'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export interface GoogleConfig { clientId: string; apiKey: string; appId: string }

export interface DriveMeta {
  id: string; name: string; version: string; modifiedTime: string
  /** email del proprietario del file = il Capofamiglia */
  ownerEmail: string
  /** chi può condividere il file (solo il proprietario, perché `writersCanShare` è disattivato) */
  canShare: boolean
}
export interface DrivePermission { id: string; emailAddress?: string; displayName?: string; role: string }
export interface GoogleUser { email: string; name: string }

export class AuthError extends Error { constructor(m = 'Sessione Google scaduta. Riconnettiti.') { super(m); this.name = 'AuthError' } }
export class NotFoundError extends Error { constructor(m = 'File non trovato o non accessibile.') { super(m); this.name = 'NotFoundError' } }
export class ConflictError extends Error { constructor() { super('Version conflict'); this.name = 'ConflictError' } }
export class NetworkError extends Error { constructor() { super('Nessuna connessione'); this.name = 'NetworkError' } }
export class ReadOnlyError extends Error { constructor() { super('Hai solo accesso in lettura al file: chiedi al Capofamiglia il permesso di modifica.'); this.name = 'ReadOnlyError' } }

/* ---------- caricamento script ---------- */
const scripts = new Map<string, Promise<void>>()
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src; s.async = true
      s.onload = () => resolve()
      s.onerror = () => { scripts.delete(src); reject(new NetworkError()) }
      document.head.appendChild(s)
    })
    scripts.set(src, p)
  }
  return p
}

/* ---------- autenticazione ---------- */
// Con il server di accesso (Worker) la sessione è persistente: i token si rinnovano da soli.
// Senza server si usa Google Identity Services (token di 1 ora, con popup).
const TOKEN_KEY = 'pwduo:token'
interface Tok { value: string; exp: number }
let tok: Tok | null = null
try { const raw = sessionStorage.getItem(TOKEN_KEY); if (raw) tok = JSON.parse(raw) as Tok } catch { /* storage non disponibile */ }
let tokenClient: any = null
let tokenClientId = ''
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null

export function setToken(value: string, expiresInSec: number): void {
  tok = { value, exp: Date.now() + expiresInSec * 1000 }
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tok)) } catch { /* noop */ }
}
function clearToken(): void { tok = null; try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* noop */ } }

export function hasValidToken(): boolean { return !!tok && Date.now() < tok.exp - 30_000 }
export const currentToken = (): string | null => (hasValidToken() ? tok!.value : null)
/** Millisecondi di validità residua del token (0 se assente o scaduto). */
export const tokenRemainingMs = (): number => (tok ? Math.max(0, tok.exp - Date.now()) : 0)

async function getTokenClient(clientId: string) {
  await loadScript('https://accounts.google.com/gsi/client')
  if (!tokenClient || tokenClientId !== clientId) {
    tokenClientId = clientId
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp: any) => {
        if (resp.error) { pending?.reject(new AuthError(resp.error_description || resp.error)); pending = null; return }
        setToken(resp.access_token, Number(resp.expires_in) || 3600)
        pending?.resolve(resp.access_token); pending = null
      },
      error_callback: (err: any) => {
        pending?.reject(new AuthError(err?.type === 'popup_closed' ? 'Accesso annullato.' : err?.message || 'Accesso non riuscito.'))
        pending = null
      },
    })
  }
  return tokenClient
}

let renewing: Promise<boolean> | null = null
/** Rinnova il token con la sessione persistente (nessun popup). true se ora c'è un token valido. */
export function renewWithSession(): Promise<boolean> {
  if (!hasSession()) return Promise.resolve(false)
  renewing ??= (async () => {
    try {
      const r = await refreshAccessToken()
      if (!r) return false
      setToken(r.token, r.expiresIn)
      return true
    } catch (e) {
      if (e instanceof SessionExpired) throw new AuthError()
      return hasValidToken() // server irraggiungibile: se il token vale ancora si prosegue
    } finally { renewing = null }
  })()
  return renewing
}

/**
 * interactive=true: apre l'accesso di Google (con il server: pagina intera che torna qui; senza: popup).
 * interactive=false: solo rinnovo silenzioso (sessione persistente, o GIS senza consenso).
 */
export async function signIn(clientId: string, interactive: boolean): Promise<string> {
  if (hasValidToken()) return tok!.value
  if (await renewWithSession() && hasValidToken()) return tok!.value
  if (interactive && (await brokerAvailable())) {
    startBrokerLogin(typeof localStorage !== 'undefined' ? localStorage.getItem('pwduo:email') : null)
    return new Promise<string>(() => { /* la pagina sta per cambiare */ })
  }
  if (!clientId) throw new AuthError('Inserisci prima il Google Client ID.')
  const client = await getTokenClient(clientId)
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject }
    client.requestAccessToken({ prompt: interactive ? 'select_account' : '' })
  })
}

export function signOut() {
  void logoutBroker()
  if (tok && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(tok.value, () => {})
  clearToken()
}

/* ---------- fetch con gestione errori ---------- */
async function api(path: string, init: RequestInit = {}, base = API): Promise<Response> {
  if (!hasValidToken()) {
    const ok = await renewWithSession() // AuthError se la sessione persistente non vale più
    if (!ok || !hasValidToken()) throw hasSession() ? new NetworkError() : new AuthError() // sessione valida ma server irraggiungibile: offline
  }
  let res: Response
  try {
    res = await fetch(base + path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok!.value}` } })
  } catch {
    throw new NetworkError()
  }
  if (res.status === 401) { clearToken(); throw new AuthError() }
  if (res.status === 404) throw new NotFoundError()
  if (res.status === 403) {
    const body = await res.json().catch(() => null)
    const reason = body?.error?.errors?.[0]?.reason
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') throw new NetworkError()
    throw new NotFoundError('Accesso negato: apri il file con «Unisciti a una famiglia» (selettore di Google) per autorizzare l’app.')
  }
  if (!res.ok) throw new Error(`Errore Google Drive (${res.status})`)
  return res
}

const META_FIELDS = 'id,name,version,modifiedTime,owners(emailAddress),capabilities(canShare,canEdit)'
interface RawMeta {
  id: string; name: string; version: string; modifiedTime: string
  owners?: { emailAddress?: string }[]; capabilities?: { canShare?: boolean; canEdit?: boolean }
}
function toMeta(r: RawMeta): DriveMeta {
  return { id: r.id, name: r.name, version: r.version, modifiedTime: r.modifiedTime, ownerEmail: (r.owners?.[0]?.emailAddress ?? '').toLowerCase(), canShare: !!r.capabilities?.canShare }
}

export async function getUser(): Promise<GoogleUser> {
  const res = await api('/about?fields=user(emailAddress,displayName)')
  const j = await res.json()
  return { email: (j.user?.emailAddress ?? '').toLowerCase(), name: j.user?.displayName ?? '' }
}

/* ---------- file della cassaforte ---------- */
export async function findDbFiles(): Promise<DriveMeta[]> {
  const q = encodeURIComponent(`(name='${DB_FILE_NAME}' or properties has { key='${PROP_KEY}' and value='${PROP_VAL}' }) and trashed=false`)
  const res = await api(`/files?q=${q}&orderBy=modifiedTime desc&pageSize=10&fields=files(${META_FIELDS})`)
  return ((await res.json()).files ?? []).map(toMeta)
}

export async function getMeta(fileId: string): Promise<DriveMeta & { canEdit: boolean }> {
  const res = await api(`/files/${encodeURIComponent(fileId)}?fields=${META_FIELDS}`)
  const raw = (await res.json()) as RawMeta
  return { ...toMeta(raw), canEdit: raw.capabilities?.canEdit !== false }
}

export async function readDb(fileId: string): Promise<{ meta: DriveMeta; file: VaultFile }> {
  // Prima i metadati: se qualcuno scrive nel frattempo, la versione "vecchia" farà scattare il conflitto in scrittura.
  const meta = await getMeta(fileId)
  const res = await api(`/files/${encodeURIComponent(fileId)}?alt=media`)
  return { meta, file: parseVault(await res.json()) }
}

function multipartBody(metadata: object, content: string, boundary: string): string {
  return [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(metadata),
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', content, `--${boundary}--`,
  ].join('\r\n')
}

/** Crea il file nel Drive del proprietario. `writersCanShare:false` → solo il proprietario può invitare o togliere persone. */
export async function createDb(file: VaultFile): Promise<DriveMeta> {
  const boundary = 'pwduo' + Math.random().toString(36).slice(2)
  const body = multipartBody(
    { name: DB_FILE_NAME, mimeType: 'application/json', writersCanShare: false, properties: { [PROP_KEY]: PROP_VAL } },
    JSON.stringify(file), boundary,
  )
  const res = await api(`/files?uploadType=multipart&fields=${META_FIELDS}`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  }, UPLOAD)
  return toMeta(await res.json())
}

/**
 * Scrive il file solo se la versione remota coincide con quella letta (controllo ottimistico sulla `version` di Drive).
 * Altrimenti lancia ConflictError e il chiamante rilegge, fa il merge e riprova.
 */
export async function writeDb(fileId: string, file: VaultFile, expectedVersion: string): Promise<DriveMeta> {
  const current = await getMeta(fileId)
  if (!current.canEdit) throw new ReadOnlyError()
  if (current.version !== expectedVersion) throw new ConflictError()
  const res = await api(`/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${META_FIELDS}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(file),
  }, UPLOAD)
  return toMeta(await res.json())
}

/* ---------- condivisione (solo il Capofamiglia) ---------- */
export async function shareFile(fileId: string, email: string, message?: string): Promise<void> {
  const msg = message ? `&emailMessage=${encodeURIComponent(message)}` : ''
  await api(`/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=true${msg}&fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  })
}

/** Toglie l'accesso al file a un account (il proprietario non si può togliere). */
export async function removeShare(fileId: string, email: string): Promise<boolean> {
  const perms = await listPermissions(fileId)
  const hit = perms.filter((p) => p.emailAddress?.toLowerCase() === email.toLowerCase() && p.role !== 'owner')
  for (const p of hit) await api(`/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(p.id)}`, { method: 'DELETE' })
  return hit.length > 0
}

export async function listPermissions(fileId: string): Promise<DrivePermission[]> {
  const res = await api(`/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,emailAddress,displayName,role)`)
  return (await res.json()).permissions ?? []
}

/* ---------- Google Picker ---------- */
export function pickerAvailable(cfg: GoogleConfig): boolean { return !!cfg.apiKey && !!cfg.appId }

/** Apre il Picker e restituisce l'ID del file scelto (concede all'app l'accesso drive.file a quel file). */
export async function pickDbFile(cfg: GoogleConfig, onlyFileId?: string): Promise<string | null> {
  if (!hasValidToken()) throw new AuthError()
  const accessToken = tok!.value
  await loadScript('https://apis.google.com/js/api.js')
  await new Promise<void>((resolve) => window.gapi.load('picker', () => resolve()))
  const g = window.google.picker
  // con un invito il selettore mostra solo il file dell'invito: un tocco e l'app ottiene l'accesso
  const views = onlyFileId
    ? [new g.DocsView(g.ViewId.DOCS).setFileIds(onlyFileId).setIncludeFolders(false)]
    : [
        new g.DocsView(g.ViewId.DOCS).setMimeTypes('application/json').setOwnedByMe(false).setIncludeFolders(false),
        new g.DocsView(g.ViewId.DOCS).setMimeTypes('application/json').setIncludeFolders(false),
      ]
  return new Promise<string | null>((resolve) => {
    let builder = new g.PickerBuilder()
    for (const v of views) builder = builder.addView(v)
    const picker = builder
      .setLocale('it')
      .setOAuthToken(accessToken)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setTitle(`Scegli ${DB_FILE_NAME}`)
      .setCallback((data: any) => {
        if (data.action === g.Action.PICKED) resolve(data.docs?.[0]?.id ?? null)
        else if (data.action === g.Action.CANCEL) resolve(null)
      })
      .build()
    picker.setVisible(true)
  })
}

/** Estrae un ID file da un link Drive oppure dall'ID stesso. */
export function parseFileId(input: string): string {
  const s = input.trim()
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) || s.match(/join=([\w-]{10,})/)
  return m ? m[1] : s
}
