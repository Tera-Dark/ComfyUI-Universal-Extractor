import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n/I18nProvider'
import { ConfirmProvider } from './components/shared/ConfirmDialog'
import { ToastProvider } from './components/shared/ToastViewport'
import { OperationStatusProvider } from './components/shared/OperationStatusCenter'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ConfirmProvider>
        <OperationStatusProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </OperationStatusProvider>
      </ConfirmProvider>
    </I18nProvider>
  </StrictMode>,
)
