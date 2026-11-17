import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import GlobalShortcuts from './components/GlobalShortcuts'
import { AuthProvider } from './lib/auth'
import { ConfirmProvider } from './lib/confirm'
import { ToastProvider } from './lib/toast'
import { ThemeProvider } from './lib/theme'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <GlobalShortcuts />
              <App />
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
