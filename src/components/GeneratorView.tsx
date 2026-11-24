import { useState } from 'react'
import { useUi } from '../store/UiContext'
import { GeneratorPanel } from './GeneratorPanel'
import { LockButton, SyncPill } from './Chrome'
import { MascotPeek } from './Mascots'
import { PageHeader, PasswordInput, StrengthBar } from './ui'

export function GeneratorView() {
  const { openEntrySheet } = useUi()
  const [check, setCheck] = useState('')
  return (
    <>
      <PageHeader title="Generatore" subtitle="Password casuali e sicure" right={<><SyncPill /><LockButton /></>} />
      <MascotPeek kind="zenitsu" side="left">
        <div className="card p-4">
          <GeneratorPanel useLabel="Salva come nuova voce" onUse={(pw) => openEntrySheet({ password: pw })} />
        </div>
      </MascotPeek>
      <div className="card mt-3 p-4">
        <p className="font-bold">Controlla una password</p>
        <p className="mb-2 text-xs text-muted">Resta sul dispositivo: non viene salvata né inviata.</p>
        <PasswordInput value={check} onChange={setCheck} mono placeholder="Incolla o scrivi una password" ariaLabel="Password da controllare" />
        <div className="mt-3"><StrengthBar password={check} /></div>
        {check && <button className="glass-btn mt-3 w-full" onClick={() => openEntrySheet({ password: check })}>Salva come nuova voce</button>}
      </div>
    </>
  )
}
