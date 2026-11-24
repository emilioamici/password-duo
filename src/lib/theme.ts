/** Tema dell'app: «Mochi» (chiaro, il gatto bianco e arancione), «Zenitsu» (scuro, il gatto grigio), oppure automatico (segue il dispositivo). */
export type Theme = 'auto' | 'light' | 'dark'

export const THEME_KEY = 'pwduo:theme'
export const THEME_NAME: Record<Theme, string> = { auto: 'Automatico', light: 'Modalità Mochi', dark: 'Modalità Zenitsu' }
/** colore della barra di stato per ogni tema (coincide con lo sfondo) */
export const THEME_COLOR = { light: '#fff7ee', dark: '#16181d' }

export const parseTheme = (v: unknown): Theme => (v === 'light' || v === 'dark' ? v : 'auto')

export function getTheme(): Theme {
  try { return parseTheme(localStorage.getItem(THEME_KEY)) } catch { return 'auto' }
}

const systemDark = (): boolean => !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches

/** Il tema effettivamente visibile (risolve «automatico»). */
export const effectiveTheme = (t: Theme = getTheme()): 'light' | 'dark' => (t === 'auto' ? (systemDark() ? 'dark' : 'light') : t)

/** Applica il tema alla pagina e alla barra di stato del telefono. */
export function applyTheme(t: Theme): void {
  const root = document.documentElement
  if (t === 'auto') delete root.dataset.theme
  else root.dataset.theme = t
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  metas.forEach((m) => {
    const mode = (m.media || '').includes('dark') ? 'dark' : 'light'
    m.content = t === 'auto' ? THEME_COLOR[mode] : THEME_COLOR[t]
  })
  window.dispatchEvent(new Event('pwduo-theme'))
}

export function setTheme(t: Theme): void {
  try { if (t === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t) } catch { /* noop */ }
  applyTheme(t)
}
