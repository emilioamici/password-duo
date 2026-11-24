/**
 * Link d'invito: `…/password-duo/#join=<id del file>`. Chi lo apre e accede con Google trova l'invito già pronto:
 * con il permesso ristretto `drive.file` gli basta un tocco sul Picker (che mostra solo quel file) per dare all'app l'accesso.
 */
const KEY = 'pwduo:joinId'
const ID = /^[\w-]{10,100}$/

export const inviteLink = (fileId: string): string => `${window.location.origin}${import.meta.env.BASE_URL}#join=${fileId}`

/** All'apertura: se l'indirizzo contiene un invito lo si ricorda (sopravvive al giro su Google) e lo si toglie dalla barra. */
export function consumeInviteFromUrl(): boolean {
  try {
    const m = /^#join=([\w-]+)$/.exec(window.location.hash)
    if (!m) return false
    if (ID.test(m[1])) localStorage.setItem(KEY, m[1])
    history.replaceState(null, '', window.location.pathname + window.location.search)
    return true
  } catch { return false }
}

export function pendingInvite(): string | null {
  try { const v = localStorage.getItem(KEY); return v && ID.test(v) ? v : null } catch { return null }
}
export function clearInvite(): void { try { localStorage.removeItem(KEY) } catch { /* noop */ } }
