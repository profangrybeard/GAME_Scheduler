import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { MobileApp } from './mobile/MobileApp.tsx'
import { useIsMobile } from './hooks/useIsMobile.ts'
import { SchedulerStateProvider } from './state/SchedulerStateContext.tsx'

function Root() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileApp /> : <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SchedulerStateProvider>
      <Root />
    </SchedulerStateProvider>
  </StrictMode>,
)
