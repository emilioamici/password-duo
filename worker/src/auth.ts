import { b64u } from './webpush'
import type { Env } from './index'

/**
 * Accesso persistente: il Worker fa da intermediario OAuth.
 * - il browser va su /auth/start, Google chiede il consenso e rimanda a /auth/callback
 * - il Worker scambia il codice (con il client secret) e conserva il TOKEN DI RINNOVO cifrato in KV
 * - all'app restituisce solo un identificativo di sessione casuale; con quello, /auth/refresh dà token d'accesso freschi (1 ora)
 * Il token di rinnovo non esce mai dal Worker.
 */

const SCOPE_FULL = 'https://www.googleapis.com/auth/drive'
const SCOPE_FILE = 'https://www.googleapis.com/auth/drive.file'
const SESSION_TTL = 180 * 24 * 3600
const TOUCH_AFTER_MS = 30 * 24 * 3600 * 1000
const STATE_TTL = 600
const enc = new TextEncoder()
const dec = new TextDecoder()

interface Session { rt: string; email: string; touched: number }

export const authConfigured = (env: Env): boolean => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_KEY)

const randomId = (bytes = 32) => b64u.enc(crypto.getRandomValues(new Uint8Array(bytes)))

// ---------- cifratura dei token di rinnovo a riposo (AES-GCM, chiave nei segreti del Worker)
async function aesKey(env: Env): Promise<CryptoKey> {
  const raw = b64u.dec(env.SESSION_KEY!)
  if (raw.length !== 32) throw new Error('SESSION_KEY deve essere di 32 byte')
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function seal(env: Env, s: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await aesKey(env), enc.encode(JSON.stringify(s))))
  return `${b64u.enc(iv)}.${b64u.enc(ct)}`
}
export async function unseal<T = Session>(env: Env, v: string): Promise<T | null> {
  try {
    const [iv, ct] = v.split('.')
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(iv) as BufferSource }, await aesKey(env), b64u.dec(ct) as BufferSource)
    return JSON.parse(dec.decode(plain)) as T
  } catch { return null }
}

const urls = (env: Env) => ({
  auth: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: `${env.GOOGLE_OAUTH_API || 'https://oauth2.googleapis.com'}/token`,
  api: env.GOOGLE_API || 'https://www.googleapis.com',
})

const allowedOrigins = (env: Env) => env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)

function page(status: number, title: string, text: string, back?: string): Response {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const html = `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CleanDuo</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1.25rem;line-height:1.5"><h1 style="font-size:1.3rem">${esc(title)}</h1><p>${esc(text)}</p>${back ? `<p><a href="${esc(back)}">Torna all'app</a></p>` : ''}</body></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

/** GET /auth/start?return=<indirizzo dell'app>&hint=<email>&scope=file → reindirizza a Google chiedendo il token di rinnovo. `scope=file` chiede solo `drive.file` (i file creati dall'app o scelti dall'utente), altrimenti tutto Drive. */
export async function authStart(env: Env, req: Request): Promise<Response> {
  if (!authConfigured(env)) return page(503, 'Accesso persistente non configurato', 'Mancano le credenziali Google sul server: segui la guida in worker/README.md.')
  const u = new URL(req.url)
  let back: URL
  try { back = new URL(u.searchParams.get('return') ?? '') } catch { return page(400, 'Richiesta non valida', 'Indirizzo di ritorno mancante.') }
  if (!allowedOrigins(env).includes(back.origin)) return page(403, 'Origine non autorizzata', 'Questo indirizzo non è tra quelli consentiti dal server.')
  back.hash = ''
  const state = randomId(16)
  await env.SUBS.put(`st:${state}`, back.toString(), { expirationTtl: STATE_TTL })
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: `${u.origin}/auth/callback`, response_type: 'code', scope: u.searchParams.get('scope') === 'file' ? SCOPE_FILE : SCOPE_FULL,
    access_type: 'offline', prompt: 'consent', state, include_granted_scopes: 'false',
  })
  const hint = u.searchParams.get('hint')
  if (hint && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hint)) q.set('login_hint', hint)
  return new Response(null, { status: 302, headers: { Location: `${urls(env).auth}?${q}`, 'Cache-Control': 'no-store' } })
}

async function emailOf(env: Env, accessToken: string): Promise<string | null> {
  const r = await fetch(`${urls(env).api}/drive/v3/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${accessToken}` } })
  return r.ok ? (((await r.json()) as { user?: { emailAddress?: string } }).user?.emailAddress?.toLowerCase() ?? null) : null
}

/** GET /auth/callback → scambia il codice, conserva la sessione e rimanda all'app con l'identificativo nel frammento dell'indirizzo. */
export async function authCallback(env: Env, req: Request): Promise<Response> {
  if (!authConfigured(env)) return page(503, 'Accesso persistente non configurato', 'Mancano le credenziali Google sul server.')
  const u = new URL(req.url)
  const state = u.searchParams.get('state') ?? ''
  const back = state ? await env.SUBS.get(`st:${state}`) : null
  if (state) await env.SUBS.delete(`st:${state}`) // monouso
  if (!back) return page(400, 'Richiesta scaduta', 'Il collegamento non è più valido (dura 10 minuti). Torna all\'app e riprova.')
  if (u.searchParams.get('error')) return page(400, 'Accesso annullato', 'Google non ha concesso l\'accesso. Torna all\'app e riprova.', back)
  const code = u.searchParams.get('code')
  if (!code) return page(400, 'Richiesta non valida', 'Codice mancante.', back)

  const r = await fetch(urls(env).token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${u.origin}/auth/callback`, grant_type: 'authorization_code' }),
  })
  if (!r.ok) return page(502, 'Google ha rifiutato lo scambio', 'Controlla che l\'indirizzo di reindirizzamento e il client secret siano quelli del progetto (guida in worker/README.md).', back)
  const t = (await r.json()) as { access_token?: string; refresh_token?: string; scope?: string }
  if (!t.access_token) return page(502, 'Risposta di Google non valida', 'Riprova tra poco.', back)
  if (!t.refresh_token) return page(400, 'Google non ha rilasciato il token di rinnovo', 'Succede se l\'app era già autorizzata. Vai su myaccount.google.com/permissions, rimuovi l\'accesso a CleanDuo e riprova.', back)
  if (!(t.scope ?? '').includes('/auth/drive')) return page(400, 'Permessi insufficienti', 'Serve l\'accesso a Google Drive. Riprova e lascia selezionata la casella dei permessi.', back)
  const email = await emailOf(env, t.access_token)
  if (!email) return page(502, 'Account non riconosciuto', 'Non riesco a leggere l\'account Google. Riprova.', back)

  const sid = randomId(32)
  await env.SUBS.put(`sess:${sid}`, await seal(env, { rt: t.refresh_token, email, touched: Date.now() }), { expirationTtl: SESSION_TTL })
  const to = new URL(back)
  to.hash = `cleanduo_session=${sid}`
  return new Response(null, { status: 302, headers: { Location: to.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}

const sessionId = (req: Request) => /^Bearer ([\w-]{30,80})$/.exec(req.headers.get('Authorization') ?? '')?.[1] ?? null

/** POST /auth/refresh (Authorization: Bearer <sessione>) → token d'accesso fresco. */
export async function authRefresh(env: Env, req: Request): Promise<{ status: number; body: unknown }> {
  if (!authConfigured(env)) return { status: 503, body: { error: 'Accesso persistente non configurato' } }
  const sid = sessionId(req)
  if (!sid) return { status: 401, body: { error: 'Sessione mancante' } }
  const stored = await env.SUBS.get(`sess:${sid}`)
  const sess = stored ? await unseal(env, stored) : null
  if (!sess) return { status: 401, body: { error: 'Sessione non valida o scaduta' } }

  const r = await fetch(urls(env).token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: sess.rt, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, grant_type: 'refresh_token' }),
  })
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string }
    if (err.error === 'invalid_grant') { await env.SUBS.delete(`sess:${sid}`); return { status: 401, body: { error: 'Accesso revocato o scaduto: serve un nuovo accesso' } } }
    return { status: 502, body: { error: 'Google non risponde' } }
  }
  const t = (await r.json()) as { access_token?: string; expires_in?: number }
  if (!t.access_token) return { status: 502, body: { error: 'Risposta di Google non valida' } }
  // a ogni uso non si riscrive (limite di scritture di KV): solo se la sessione sta invecchiando
  if (Date.now() - sess.touched > TOUCH_AFTER_MS) await env.SUBS.put(`sess:${sid}`, await seal(env, { ...sess, touched: Date.now() }), { expirationTtl: SESSION_TTL })
  return { status: 200, body: { access_token: t.access_token, expires_in: t.expires_in ?? 3600, email: sess.email } }
}

/**
 * POST /auth/logout → elimina la sessione di QUESTO dispositivo. Il token di rinnovo non viene revocato su Google:
 * revocarlo scollegherebbe anche gli altri dispositivi. Per revocare tutto: myaccount.google.com/permissions.
 */
export async function authLogout(env: Env, req: Request): Promise<{ status: number; body: unknown }> {
  const sid = sessionId(req)
  if (sid) await env.SUBS.delete(`sess:${sid}`)
  return { status: 200, body: { ok: true } }
}
