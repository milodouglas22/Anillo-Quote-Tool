import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import { msalConfig } from './config/authConfig'
import { ThemeProvider } from './components/theme-provider'
import App from './App'
import './index.css'

const msalInstance = new PublicClientApplication(msalConfig)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MsalProvider instance={msalInstance}>
      <ThemeProvider defaultTheme="system" storageKey="arcline-theme">
        <App />
      </ThemeProvider>
    </MsalProvider>
  </StrictMode>,
)
