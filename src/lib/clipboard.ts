/** Copia negli appunti e, se richiesto, li svuota dopo 30 secondi (best effort: il browser può rifiutare se la pagina non ha il focus). */
let timer: number | undefined
export const CLIPBOARD_CLEAR_MS = 30_000

export async function copyText(text: string, clearAfter: boolean): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      if (!ok) return false
    } catch { return false }
  }
  window.clearTimeout(timer)
  if (clearAfter) timer = window.setTimeout(() => { navigator.clipboard?.writeText('').catch(() => undefined) }, CLIPBOARD_CLEAR_MS)
  return true
}
