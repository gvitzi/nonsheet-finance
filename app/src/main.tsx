import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { WealthStoreProvider } from './WealthStoreProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <WealthStoreProvider>
        <App />
      </WealthStoreProvider>
    </HashRouter>
  </StrictMode>,
)
