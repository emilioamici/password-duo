import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { UiProvider } from './store/UiContext'
import { VaultProvider } from './store/VaultContext'
import { consumeSessionFromUrl } from './services/broker'
import { consumeInviteFromUrl } from './services/invite'

consumeInviteFromUrl() // link d'invito: si ricorda l'ID del file
consumeSessionFromUrl() // ritorno dal login con il server: salva la sessione e ripulisce l'indirizzo

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VaultProvider>
      <UiProvider>
        <App />
      </UiProvider>
    </VaultProvider>
  </StrictMode>,
)
