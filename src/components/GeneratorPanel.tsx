import { Check, Copy, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DEFAULT_GEN, generatePassword, type GenOptions } from '../services/cryptoService'
import { copyText } from '../lib/clipboard'
import { useVault } from '../store/VaultContext'
import { useUi } from '../store/UiContext'
import { StrengthBar } from './ui'

const KEY = 'pwduo:gen'
export function loadGenOptions(): GenOptions {
  try { return { ...DEFAULT_GEN, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<GenOptions>) } } catch { return DEFAULT_GEN }
}
/** Genera con le ultime opzioni usate (per il pulsante «Genera» dentro una voce). */
export function quickGenerate(): string {
  const o = loadGenOptions()
  try { return generatePassword(o) } catch { return generatePassword(DEFAULT_GEN) }
}

const TOGGLES: { k: 'upper' | 'lower' | 'digits' | 'symbols'; label: string }[] = [
  { k: 'upper', label: 'ABC' }, { k: 'lower', label: 'abc' }, { k: 'digits', label: '123' }, { k: 'symbols', label: '#$%' },
]

/** Generatore: lunghezza 8–64, gruppi di caratteri, robustezza, copia e uso in 1 tap. */
export function GeneratorPanel({ onUse, useLabel = 'Usa questa password' }: { onUse?: (pw: string) => void; useLabel?: string }) {
  const { prefs } = useVault()
  const { showToast } = useUi()
  const [opts, setOpts] = useState<GenOptions>(loadGenOptions)
  const [pw, setPw] = useState(() => { try { return generatePassword(loadGenOptions()) } catch { return generatePassword(DEFAULT_GEN) } })
  const [copied, setCopied] = useState(false)

  const regen = (o: GenOptions) => { try { setPw(generatePassword(o)) } catch { /* almeno un gruppo */ } }
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(opts)) } catch { /* noop */ } }, [opts])
  const change = (patch: Partial<GenOptions>) => {
    const next = { ...opts, ...patch }
    // almeno un gruppo sempre attivo
    if (!next.upper && !next.lower && !next.digits && !next.symbols) return
    setOpts(next); regen(next)
  }

  const copy = async () => {
    const ok = await copyText(pw, prefs.clearClipboard)
    if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 1500); showToast(prefs.clearClipboard ? 'Password copiata · appunti svuotati tra 30 s' : 'Password copiata') }
    else showToast('Copia non riuscita: selezionala a mano')
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-bg p-4">
        <p className="break-all text-center font-mono text-lg font-semibold leading-snug" aria-live="polite" data-testid="generated">{pw}</p>
        <div className="mt-3"><StrengthBar password={pw} /></div>
      </div>
      <div className="flex gap-2">
        <button className="glass-btn flex-1" onClick={() => regen(opts)}><RefreshCw size={16} />Rigenera</button>
        <button className="glass-btn flex-1" onClick={() => void copy()}>{copied ? <Check size={16} className="text-inc" /> : <Copy size={16} />}{copied ? 'Copiata' : 'Copia'}</button>
      </div>
      <div>
        <div className="flex items-center justify-between px-1">
          <label htmlFor="len" className="text-xs font-semibold uppercase tracking-wide text-muted">Lunghezza</label>
          <span className="text-sm font-bold">{opts.length}</span>
        </div>
        <input id="len" type="range" min={8} max={64} value={opts.length} onChange={(e) => change({ length: Number(e.target.value) })} className="mt-1 w-full accent-[rgb(var(--brand))]" />
      </div>
      <div className="flex flex-wrap gap-2">
        {TOGGLES.map(({ k, label }) => (
          <button key={k} type="button" role="switch" aria-checked={opts[k]} onClick={() => change({ [k]: !opts[k] })} className={`chip font-mono ${opts[k] ? 'chip-active' : ''}`}>{label}</button>
        ))}
      </div>
      {onUse && <button className="glass-btn btn-primary w-full !py-3" onClick={() => onUse(pw)}>{useLabel}</button>}
    </div>
  )
}
