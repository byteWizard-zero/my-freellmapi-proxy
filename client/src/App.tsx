import { useEffect, useState, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Button } from '@/components/ui/button'
import KeysPage from '@/pages/KeysPage'
import PlaygroundPage from '@/pages/PlaygroundPage'
import FallbackPage from '@/pages/FallbackPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import CooldownsPage from '@/pages/CooldownsPage'
import ClientKeysPage from '@/pages/ClientKeysPage'
import AuthGate from '@/components/AuthGate'
import { clearToken, UNAUTHORIZED_EVENT, apiFetch } from '@/lib/api'
import PasskeyManagerModal from '@/components/PasskeyManagerModal'
import { Lock, Fingerprint, Menu, X, Zap, Activity, Sun, Moon } from 'lucide-react'

// Register GSAP plugins
gsap.registerPlugin(useGSAP)

const queryClient = new QueryClient()

function NavItem({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `relative px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
          isActive
            ? 'text-foreground bg-muted/90 border border-border/80 font-semibold shadow-xs'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {children}
          {isActive && (
            <span className="absolute -bottom-[9px] inset-x-2 h-[2px] bg-gradient-to-r from-emerald-500 via-cyan-400 to-emerald-400 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          )}
        </>
      )}
    </NavLink>
  )
}

function MobileNavItem({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center px-4 py-3 text-sm font-medium transition-colors border-b border-border/40 ${
          isActive
            ? 'text-emerald-400 bg-emerald-500/10 font-semibold'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

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
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
      className="size-8 rounded-lg hover:bg-muted/60 transition-colors"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? (
        <Sun className="size-4 text-amber-400 transition-transform hover:rotate-45" />
      ) : (
        <Moon className="size-4 text-slate-700 transition-transform hover:-rotate-12" />
      )}
    </Button>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div className="relative flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 via-cyan-500/10 to-transparent border border-emerald-500/30 text-emerald-400 shadow-sm transition-transform hover:scale-105">
        <Zap className="size-4 text-emerald-400 fill-emerald-400/20" />
        <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-400 status-beacon-emerald" />
      </div>
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold tracking-tight text-sm text-foreground">FreeLLMAPI</span>
          <span className="text-[10px] uppercase font-mono px-1 py-0.2 rounded bg-muted/80 text-muted-foreground border border-border/60">
            Proxy
          </span>
        </div>
      </div>
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
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm mobile-only"
        onClick={onClose}
      />
      {/* Menu panel */}
      <div className="fixed top-[53px] left-0 right-0 z-50 bg-background/95 backdrop-blur-xl border-b border-border/80 shadow-2xl mobile-only animate-in slide-in-from-top-2 duration-200">
        <nav className="flex flex-col py-1">
          <MobileNavItem to="/playground" onClick={onClose}>Playground</MobileNavItem>
          <MobileNavItem to="/project-keys" onClick={onClose}>Project Keys</MobileNavItem>
          <MobileNavItem to="/keys" onClick={onClose}>Provider Keys</MobileNavItem>
          <MobileNavItem to="/cooldowns" onClick={onClose}>Cooldowns</MobileNavItem>
          <MobileNavItem to="/fallback" onClick={onClose}>Fallback Chain</MobileNavItem>
          <MobileNavItem to="/analytics" onClick={onClose}>Analytics</MobileNavItem>
        </nav>
      </div>
    </>
  )
}

function AppShell() {
  const location = useLocation()
  const mainRef = useRef<HTMLDivElement>(null)
  const [showPasskeyManager, setShowPasskeyManager] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Query system health for status indicators
  const { data: healthData } = useQuery({
    queryKey: ['system-health-badge'],
    queryFn: () => apiFetch<{ cooldowns: any[]; platforms: any[]; keys: any[] }>('/api/health'),
    refetchInterval: 30000,
    staleTime: 15000,
  })

  const cooldownsCount = healthData?.cooldowns?.length ?? 0

  function handleLock() {
    clearToken()
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { reason: 'locked' } }))
  }

  // Smooth GSAP staggered entrance reveal on route change
  useGSAP(
    () => {
      if (!mainRef.current) return

      // Entrance animation for main container
      gsap.fromTo(
        mainRef.current,
        { opacity: 0, y: 12 },
        {
          opacity: 1,
          y: 0,
          duration: 0.35,
          ease: 'power2.out',
          clearProps: 'transform',
        }
      )

      // Staggered reveal for page sections and cards
      const targets = mainRef.current.querySelectorAll(
        '.gsap-reveal, [data-slot="card"], section, .metric-card'
      )
      if (targets.length > 0) {
        gsap.fromTo(
          targets,
          { opacity: 0, y: 14 },
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            stagger: 0.05,
            ease: 'power2.out',
            clearProps: 'transform',
          }
        )
      }
    },
    { scope: mainRef, dependencies: [location.pathname] }
  )

  return (
    <div className="min-h-screen bg-background bg-tech-grid text-foreground flex flex-col">
      <PasskeyManagerModal isOpen={showPasskeyManager} onClose={() => setShowPasskeyManager(false)} />

      {/* Sleek Obsidian Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/60 transition-all duration-200">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Brand />

            {/* Desktop navigation tabs */}
            <nav className="desktop-only flex items-center gap-1.5">
              <NavItem to="/playground">Playground</NavItem>
              <NavItem to="/project-keys">Project Keys</NavItem>
              <NavItem to="/keys">Provider Keys</NavItem>
              <NavItem to="/cooldowns">Cooldowns</NavItem>
              <NavItem to="/fallback">Fallback</NavItem>
              <NavItem to="/analytics">Analytics</NavItem>
            </nav>
          </div>

          {/* Quick System Stats & Operational Badges */}
          <div className="hidden lg:flex items-center gap-2.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium badge-luminous">
              <span className="size-2 rounded-full bg-emerald-500 status-beacon-emerald inline-block" />
              <span>17+ Free Providers Active</span>
            </div>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono text-muted-foreground bg-muted/50 border border-border/50">
              <Activity className={`size-3.5 ${cooldownsCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`} />
              <span>{cooldownsCount > 0 ? `${cooldownsCount} Cooldown${cooldownsCount > 1 ? 's' : ''}` : 'All Systems Operational'}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowPasskeyManager(true)}
              aria-label="Manage Passkeys"
              className="size-8 rounded-lg hover:bg-muted/60"
              title="Manage Passkeys & Biometrics"
            >
              <Fingerprint className="size-4 text-muted-foreground hover:text-foreground transition-colors" />
            </Button>

            <DarkModeToggle />

            <Button
              variant="ghost"
              size="icon"
              onClick={handleLock}
              aria-label="Lock Dashboard"
              className="size-8 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              title="Lock Dashboard Session"
            >
              <Lock className="size-4" />
            </Button>

            {/* Mobile hamburger button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle navigation"
              className="mobile-only size-8 rounded-lg"
              title="Toggle Navigation Menu"
            >
              {mobileMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile slide-down nav */}
      <MobileMenuOverlay isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      {/* Main Container with GSAP scope */}
      <main ref={mainRef} className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-6 py-6 md:py-8">
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
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthGate>
          <AppShell />
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
