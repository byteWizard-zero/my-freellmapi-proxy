import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import KeysPage from '@/pages/KeysPage'
import PlaygroundPage from '@/pages/PlaygroundPage'
import FallbackPage from '@/pages/FallbackPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import CooldownsPage from '@/pages/CooldownsPage'
import ClientKeysPage from '@/pages/ClientKeysPage'
import AuthGate from '@/components/AuthGate'

const queryClient = new QueryClient()

function NavItem({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `relative text-sm px-1 py-4 transition-colors ${
          isActive
            ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

function MobileNavItem({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `block px-4 py-3 text-sm font-medium transition-colors border-b border-border/50 ${
          isActive
            ? 'text-foreground bg-muted/50'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

import { clearToken, UNAUTHORIZED_EVENT } from '@/lib/api'
import PasskeyManagerModal from '@/components/PasskeyManagerModal'
import { Lock, Fingerprint, Menu, X } from 'lucide-react'

function DarkModeToggle() {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark')
      setDark(true)
    }
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme" className="size-8">
      {dark ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      )}
    </Button>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block size-2 rounded-full bg-foreground" />
      <span className="font-semibold tracking-tight text-sm">FreeLLMAPI</span>
    </div>
  )
}

function MobileMenuOverlay({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const location = useLocation()

  // Close on route change
  useEffect(() => {
    onClose()
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
        onClick={onClose}
      />
      {/* Menu panel */}
      <div className="fixed top-[49px] left-0 right-0 z-50 bg-background border-b shadow-lg md:hidden animate-in slide-in-from-top-2 duration-200">
        <nav className="flex flex-col">
          <MobileNavItem to="/playground" onClick={onClose}>Playground</MobileNavItem>
          <MobileNavItem to="/project-keys" onClick={onClose}>Project Keys</MobileNavItem>
          <MobileNavItem to="/keys" onClick={onClose}>Provider Keys</MobileNavItem>
          <MobileNavItem to="/cooldowns" onClick={onClose}>Cooldowns</MobileNavItem>
          <MobileNavItem to="/fallback" onClick={onClose}>Fallback</MobileNavItem>
          <MobileNavItem to="/analytics" onClick={onClose}>Analytics</MobileNavItem>
        </nav>
      </div>
    </>
  )
}

function App() {
  const [showPasskeyManager, setShowPasskeyManager] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  function handleLock() {
    clearToken()
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { reason: 'locked' } }))
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthGate>
        <PasskeyManagerModal isOpen={showPasskeyManager} onClose={() => setShowPasskeyManager(false)} />
        <div className="min-h-screen bg-background">
          <header className="sticky top-0 z-40 bg-background/60 backdrop-blur-md border-b border-border/80">
            <div className="max-w-6xl mx-auto px-4 md:px-6 flex items-center">
              <Brand />

              {/* Mobile hamburger button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle navigation"
                className="size-8 md:hidden ml-auto"
              >
                {mobileMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
              </Button>

              {/* Desktop navigation */}
              <nav className="hidden md:flex items-center gap-6 ml-10">
                <NavItem to="/playground">Playground</NavItem>
                <NavItem to="/project-keys">Project Keys</NavItem>
                <NavItem to="/keys">Provider Keys</NavItem>
                <NavItem to="/cooldowns">Cooldowns</NavItem>
                <NavItem to="/fallback">Fallback</NavItem>
                <NavItem to="/analytics">Analytics</NavItem>
              </nav>

              {/* Action buttons */}
              <div className="hidden md:flex ml-auto py-2 items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => setShowPasskeyManager(true)} aria-label="Manage Passkeys" className="size-8" title="Manage Passkeys & Biometrics">
                  <Fingerprint className="size-4" />
                </Button>
                <DarkModeToggle />
                <Button variant="ghost" size="icon" onClick={handleLock} aria-label="Lock Dashboard" className="size-8 text-muted-foreground hover:text-foreground" title="Lock Dashboard">
                  <Lock className="size-4" />
                </Button>
              </div>

              {/* Mobile action buttons (right side, next to hamburger) */}
              <div className="flex md:hidden items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => setShowPasskeyManager(true)} aria-label="Manage Passkeys" className="size-8" title="Manage Passkeys & Biometrics">
                  <Fingerprint className="size-4" />
                </Button>
                <DarkModeToggle />
                <Button variant="ghost" size="icon" onClick={handleLock} aria-label="Lock Dashboard" className="size-8 text-muted-foreground hover:text-foreground" title="Lock Dashboard">
                  <Lock className="size-4" />
                </Button>
              </div>
            </div>
          </header>

          {/* Mobile slide-down nav */}
          <MobileMenuOverlay isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

          <main className="max-w-6xl mx-auto px-4 md:px-6 py-4 md:py-8">
            <Routes>
              <Route path="/" element={<Navigate to="/playground" replace />} />
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="/project-keys" element={<ClientKeysPage />} />
              <Route path="/keys" element={<KeysPage />} />
              <Route path="/cooldowns" element={<CooldownsPage />} />
              <Route path="/fallback" element={<FallbackPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/test" element={<Navigate to="/playground" replace />} />
              <Route path="/health" element={<Navigate to="/keys" replace />} />
            </Routes>
          </main>
        </div>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
