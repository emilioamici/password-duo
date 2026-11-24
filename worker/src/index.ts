import { authCallback, authConfigured, authLogout, authRefresh, authStart } from './auth'

/**
 * Worker di Password Duo: SOLO accesso persistente a Google (broker OAuth). Non vede mai i dati della cassaforte
 * e non ne conserva: tiene il token di rinnovo di Google, cifrato, e dà all'app token d'accesso freschi.
 * (A differenza di Clean Duo qui non ci sono notifiche push, ponte verso il file né dispositivi: niente di tutto ciò serve.)
 */

/** Minimo indispensabile dell'archivio KV di Cloudflare (così il codice si prova anche in Node). */
export interface KV {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

export interface Env {
  SUBS: KV
  /** origini autorizzate a usare il server, separate da virgola (es. https://utente.github.io) */
  ALLOWED_ORIGINS: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** 32 byte casuali in base64url (node worker/scripts/generate-session-key.mjs) */
  SESSION_KEY?: string
  /** solo test: indirizzi di Google */
  GOOGLE_API?: string
  GOOGLE_AUTH_URL?: string
  GOOGLE_OAUTH_API?: string
}

function cors(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  return allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : {}
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(env, req)
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })
    const { pathname } = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { status: headers['Access-Control-Allow-Origin'] ? 204 : 403, headers })
    if (pathname === '/health') return json(200, { ok: true, auth: authConfigured(env) })
    // l'accesso passa da due pagine aperte nel browser (GET): Google rimanda qui dopo il consenso
    if (req.method === 'GET' && pathname === '/auth/start') return authStart(env, req)
    if (req.method === 'GET' && pathname === '/auth/callback') return authCallback(env, req)
    if (req.method !== 'POST') return json(404, { error: 'Non trovato' })
    // le chiamate dal browser devono arrivare da un'origine autorizzata
    if (!headers['Access-Control-Allow-Origin']) return json(403, { error: 'Origine non autorizzata' })
    try {
      if (pathname === '/auth/refresh') { const r = await authRefresh(env, req); return json(r.status, r.body) }
      if (pathname === '/auth/logout') { const r = await authLogout(env, req); return json(r.status, r.body) }
      return json(404, { error: 'Non trovato' })
    } catch {
      return json(500, { error: 'Errore interno' })
    }
  },
}
