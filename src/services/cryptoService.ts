/**
 * Crittografia lato client con la Web Crypto API nativa del browser.
 * - Derivazione chiave: PBKDF2-SHA256 (600.000 iterazioni) con salt casuale per ogni blocco.
 * - Cifratura: AES-GCM a 256 bit, IV casuale di 12 byte a ogni cifratura, dati autenticati aggiuntivi (AAD) legati al blocco.
 * Le chiavi derivate NON sono esportabili: restano solo in memoria e spariscono al blocco.
 */
import type { Kdf } from '../types'

export const PBKDF2_ITER = 600_000
/** Limiti accettati quando si legge un file altrui: troppo pochi = debole, troppi = blocco del dispositivo. */
export const MIN_ITER = 100_000
export const MAX_ITER = 5_000_000
let defaultIter = PBKDF2_ITER
/** Solo per i test: iterazioni più basse (mai sotto MIN_ITER). */
export function setDefaultIterForTests(n: number): void { defaultIter = Math.max(MIN_ITER, n) }
const enc = new TextEncoder()
const dec = new TextDecoder()

export class DecryptError extends Error {
  constructor() { super('Impossibile decifrare: password errata o dati alterati.'); this.name = 'DecryptError' }
}

/* ---------- base64 ---------- */
export function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const randomBytes = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))

/** Intero casuale uniforme in [0, n) con campionamento per scarto (niente bias del modulo). */
export function randomInt(n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new RangeError('randomInt: n fuori intervallo')
  const limit = Math.floor(2 ** 32 / n) * n
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % n
  }
}

/** Identificativo casuale (96 bit, base64url). */
export function uid(prefix = ''): string {
  return prefix + b64(randomBytes(12)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/* ---------- chiavi ---------- */
export function newKdf(iter = defaultIter): Kdf {
  return { alg: 'PBKDF2-SHA256', iter, salt: b64(randomBytes(16)) }
}

/** Deriva la chiave AES-GCM dal segreto. Non esportabile. */
export async function deriveKey(secret: string, kdf: Kdf): Promise<CryptoKey> {
  if (kdf.alg !== 'PBKDF2-SHA256' || !Number.isInteger(kdf.iter) || kdf.iter < MIN_ITER || kdf.iter > MAX_ITER) throw new DecryptError()
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(kdf.salt), iterations: kdf.iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/* ---------- cifratura ---------- */
export async function encryptJson(key: CryptoKey, value: unknown, aad: string): Promise<{ iv: string; ct: string }> {
  const iv = randomBytes(12) // IV nuovo a ogni cifratura: mai riusato con la stessa chiave
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(value))))
  return { iv: b64(iv), ct: b64(ct) }
}

export async function decryptJson<T>(key: CryptoKey, data: { iv: string; ct: string }, aad: string): Promise<T> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(data.iv), additionalData: enc.encode(aad) }, key, unb64(data.ct))
    return JSON.parse(dec.decode(plain)) as T
  } catch {
    throw new DecryptError()
  }
}

/* ---------- generatore di password ---------- */
export interface GenOptions { length: number; upper: boolean; lower: boolean; digits: boolean; symbols: boolean }
export const DEFAULT_GEN: GenOptions = { length: 20, upper: true, lower: true, digits: true, symbols: true }

const SETS = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // senza I e O (ambigue)
  lower: 'abcdefghijkmnopqrstuvwxyz', // senza l
  digits: '23456789',                 // senza 0 e 1
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
} as const

/** Mescola con Fisher-Yates usando numeri casuali crittografici. */
export function secureShuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Genera una password: almeno un carattere per ogni gruppo attivo, il resto uniforme sull'unione dei gruppi. */
export function generatePassword(o: GenOptions): string {
  const groups = (['upper', 'lower', 'digits', 'symbols'] as const).filter((k) => o[k]).map((k) => SETS[k])
  if (!groups.length) throw new Error('Seleziona almeno un tipo di carattere.')
  const length = Math.max(groups.length, Math.min(128, Math.floor(o.length)))
  const all = groups.join('')
  const chars: string[] = groups.map((g) => g[randomInt(g.length)])
  while (chars.length < length) chars.push(all[randomInt(all.length)])
  return secureShuffle(chars).join('')
}

/* ---------- robustezza ---------- */
export interface Strength { bits: number; score: 0 | 1 | 2 | 3 | 4; label: string }

/** Stima grossolana dell'entropia (dimensione dell'alfabeto × lunghezza, con penalità per ripetizioni e sequenze). */
export function estimateStrength(pw: string): Strength {
  if (!pw) return { bits: 0, score: 0, label: 'Vuota' }
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/\d/.test(pw)) pool += 10
  if (/[^A-Za-z0-9]/.test(pw)) pool += 32
  let bits = pw.length * Math.log2(Math.max(pool, 2))
  const unique = new Set(pw).size
  if (unique < pw.length * 0.5) bits *= 0.6
  if (/(.)\1{2,}/.test(pw)) bits *= 0.85
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|wert|erty|asdf)/i.test(pw)) bits *= 0.7
  bits = Math.round(bits)
  const score = bits < 28 ? 0 : bits < 45 ? 1 : bits < 65 ? 2 : bits < 90 ? 3 : 4
  return { bits, score, label: ['Molto debole', 'Debole', 'Discreta', 'Robusta', 'Eccellente'][score] }
}
