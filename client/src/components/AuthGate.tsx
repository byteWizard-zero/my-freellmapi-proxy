import { useState, useEffect, useCallback, type ReactNode, type FormEvent } from 'react'
import { apiFetch, setToken, UNAUTHORIZED_EVENT } from '@/lib/api'

interface AuthStatus {
  needsSetup: boolean
  authenticated: boolean
}

interface AuthGateProps {
  children: ReactNode
}

export default function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const checkAuth = useCallback(async () => {
    try {
      const data = await apiFetch<AuthStatus>('/api/auth/status')
      setStatus(data)
    } catch {
      // If we can't reach the server, show login anyway
      setStatus({ needsSetup: false, authenticated: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  // Listen for unauthorized events (401 from api.ts)
  useEffect(() => {
    const handler = () => {
      setStatus({ needsSetup: false, authenticated: false })
      setError('Session expired. Please log in again.')
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handler)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }, [])

  const handleAuth = (token: string) => {
    setToken(token)
    setError('')
    setStatus({ needsSetup: false, authenticated: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    )
  }

  if (status?.needsSetup) {
    return <SetupForm onSuccess={handleAuth} error={error} setError={setError} />
  }

  if (!status?.authenticated) {
    return <LoginForm onSuccess={handleAuth} error={error} setError={setError} />
  }

  return <>{children}</>
}

// ─── Login Form ──────────────────────────────────────────────────────────────

function LoginForm({
  onSuccess,
  error,
  setError,
}: {
  onSuccess: (token: string) => void
  error: string
  setError: (e: string) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const data = await apiFetch<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      onSuccess(data.token)
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="inline-block size-2 rounded-full bg-foreground" />
            <span className="font-semibold tracking-tight text-sm text-foreground">FreeLLMAPI</span>
          </div>
          <h1 className="text-xl font-semibold text-foreground">Sign in to Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Enter your credentials to access the admin panel</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-foreground mb-1.5">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-foreground mb-1.5">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Setup Form ──────────────────────────────────────────────────────────────

function SetupForm({
  onSuccess,
  error,
  setError,
}: {
  onSuccess: (token: string) => void
  error: string
  setError: (e: string) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setSubmitting(true)

    try {
      const body: Record<string, string> = { email, password }
      if (setupCode.trim()) {
        body.setupCode = setupCode.trim()
      }

      const data = await apiFetch<{ token: string }>('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      onSuccess(data.token)
    } catch (err: any) {
      setError(err.message || 'Setup failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="inline-block size-2 rounded-full bg-foreground" />
            <span className="font-semibold tracking-tight text-sm text-foreground">FreeLLMAPI</span>
          </div>
          <h1 className="text-xl font-semibold text-foreground">Create Admin Account</h1>
          <p className="text-sm text-muted-foreground mt-1">Set up your dashboard credentials for the first time</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="setup-email" className="block text-sm font-medium text-foreground mb-1.5">
              Email
            </label>
            <input
              id="setup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label htmlFor="setup-password" className="block text-sm font-medium text-foreground mb-1.5">
              Password
            </label>
            <input
              id="setup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Minimum 8 characters"
            />
          </div>

          <div>
            <label htmlFor="setup-confirm" className="block text-sm font-medium text-foreground mb-1.5">
              Confirm Password
            </label>
            <input
              id="setup-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label htmlFor="setup-code" className="block text-sm font-medium text-foreground mb-1.5">
              Setup Code <span className="text-muted-foreground font-normal">(from server logs, required for remote access)</span>
            </label>
            <input
              id="setup-code"
              type="text"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono tracking-widest text-center"
              placeholder="ABC123"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-xs text-muted-foreground text-center mt-4">
          If connecting remotely, check your server logs (e.g. Render dashboard logs) for the 6-character setup code.
        </p>
      </div>
    </div>
  )
}
