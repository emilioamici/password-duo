import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env, type KV } from './index'
import { seal, unseal } from './auth'

function kv(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, get: async (k) => data.get(k) ?? null, put: async (k, v) => { data.set(k, v) }, delete: async (k) => { data.delete(k) } }
}
const KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
const env = (): Env => ({ SUBS: kv(), ALLOWED_ORIGINS: 'https://app.example.com', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', SESSION_KEY: KEY })
afterEach(() => vi.restoreAllMocks())

describe('worker di accesso', () => {
  it('health dice se l\'accesso persistente è configurato', async () => {
    expect(await (await worker.fetch(new Request('https://w/health'), env())).json()).toEqual({ ok: true, auth: true })
    const e = env(); delete e.SESSION_KEY
    expect(await (await worker.fetch(new Request('https://w/health'), e)).json()).toEqual({ ok: true, auth: false })
  })

  it('rifiuta un\'origine di ritorno non autorizzata e accetta quella consentita', async () => {
    const e = env()
    const bad = await worker.fetch(new Request('https://w/auth/start?return=https://evil.example/'), e)
    expect(bad.status).toBe(403)
    const ok = await worker.fetch(new Request('https://w/auth/start?return=https://app.example.com/password-duo/&scope=file'), e)
    expect(ok.status).toBe(302)
    const loc = new URL(ok.headers.get('Location')!)
    expect(loc.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file')
    expect(loc.searchParams.get('access_type')).toBe('offline')
  })

  it('cifra il token di rinnovo a riposo e lo restituisce solo con la sessione giusta', async () => {
    const e = env()
    const sealed = await seal(e, { rt: 'REFRESH', email: 'a@b.it', touched: Date.now() })
    expect(sealed).not.toContain('REFRESH')
    expect((await unseal<{ rt: string }>(e, sealed))?.rt).toBe('REFRESH')

    const sid = 'x'.repeat(43)
    await e.SUBS.put(`sess:${sid}`, sealed)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 })))
    const origin = { Origin: 'https://app.example.com' }
    const r = await worker.fetch(new Request('https://w/auth/refresh', { method: 'POST', headers: { ...origin, Authorization: `Bearer ${sid}` }, body: '{}' }), e)
    expect(await r.json()).toEqual({ access_token: 'AT', expires_in: 3600, email: 'a@b.it' })
    const noSess = await worker.fetch(new Request('https://w/auth/refresh', { method: 'POST', headers: { ...origin, Authorization: `Bearer ${'y'.repeat(43)}` }, body: '{}' }), e)
    expect(noSess.status).toBe(401)
    const noOrigin = await worker.fetch(new Request('https://w/auth/refresh', { method: 'POST', headers: { Authorization: `Bearer ${sid}` }, body: '{}' }), e)
    expect(noOrigin.status).toBe(403)
  })

  it('il logout elimina la sessione del dispositivo', async () => {
    const e = env(); const sid = 'z'.repeat(43)
    await e.SUBS.put(`sess:${sid}`, 'x')
    await worker.fetch(new Request('https://w/auth/logout', { method: 'POST', headers: { Origin: 'https://app.example.com', Authorization: `Bearer ${sid}` }, body: '{}' }), e)
    expect(await e.SUBS.get(`sess:${sid}`)).toBeNull()
  })
})
