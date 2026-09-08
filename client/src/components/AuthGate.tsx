import { useState, useEffect, useCallback, type ReactNode, type FormEvent } from 'react'
import { apiFetch, setToken, UNAUTHORIZED_EVENT } from '@/lib/api'
import { startRegistration, startAuthentication } from '@simplewebauthn/browser'
import AdminGreetingLoader from '@/components/AdminGreetingLoader'
import { Lock, Fingerprint } from 'lucide-react'

interface AuthStatus {
  needsSetup: boolean
  authenticated: boolean
}

interface AuthGateProps {
  children: ReactNode
}

export async function registerDevicePasskey(): Promise<boolean> {
  try {
    const options = await apiFetch<any>('/api/auth/webauthn/register-options', { method: 'POST' })
    const authResponse = await startRegistration({ optionsJSON: options })
    await apiFetch('/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: JSON.stringify(authResponse),
    })
    try {
      localStorage.setItem('freellmapi_has_passkeys', 'true')
    } catch {}
    return true
  } catch (err: any) {
    alert(err.message || 'Passkey registration canceled or failed')
    return false
  }
}

export default function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showPasskeyPrompt, setShowPasskeyPrompt] = useState(false)
  const [showGreeting, setShowGreeting] = useState(false)
  const [adminEmail, setAdminEmail] = useState(() => {
    try {
      return localStorage.getItem('freellmapi_admin_email') || ''
    } catch {
      return ''
    }
  })

  const checkAuth = useCallback(async () => {
    try {
      const data = await apiFetch<AuthStatus>('/api/auth/status')
      setStatus(data)
      if (data.authenticated) {
        const passkeyCheck = await apiFetch<{ hasPasskeys: boolean }>('/api/auth/webauthn/has-passkeys').catch(() => ({ hasPasskeys: true }))
        if (!passkeyCheck.hasPasskeys) {
          setShowPasskeyPrompt(true)
        }
      }
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

  // Listen for unauthorized events (401 from api.ts or manual lock)
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent
      const isLocked = customEvent?.detail?.reason === 'locked'
      setStatus({ needsSetup: false, authenticated: false })
      setShowGreeting(false)
      setError(isLocked ? 'Console locked. Please authenticate to resume.' : 'Session expired. Please log in again.')
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handler)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }, [])

  const handleAuth = async (token: string, email?: string) => {
    setToken(token)
    setError('')
    if (email) setAdminEmail(email)
    setShowGreeting(true)
    setStatus({ needsSetup: false, authenticated: true })
    const passkeyCheck = await apiFetch<{ hasPasskeys: boolean }>('/api/auth/webauthn/has-passkeys').catch(() => ({ hasPasskeys: true }))
    if (!passkeyCheck.hasPasskeys) {
      setShowPasskeyPrompt(true)
    }
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

  return (
    <>
      {showGreeting && (
        <AdminGreetingLoader
          email={adminEmail}
          onComplete={() => setShowGreeting(false)}
        />
      )}
      {showPasskeyPrompt && !showGreeting && (
        <div className="bg-primary/10 border-b border-primary/20 text-foreground px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔑</span>
            <span className="text-sm">You haven't set up a Passkey yet. Set one up to sign in with your fingerprint or device PIN next time!</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const success = await registerDevicePasskey()
                if (success) setShowPasskeyPrompt(false)
              }}
              className="text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
            >
              Set up Passkey
            </button>
            <button
              onClick={() => setShowPasskeyPrompt(false)}
              className="text-sm bg-transparent border border-border px-3 py-1.5 rounded-md hover:bg-muted transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {children}
    </>
  )
}

// ─── Login Form ──────────────────────────────────────────────────────────────

function LoginForm({
  onSuccess,
  error,
  setError,
}: {
  onSuccess: (token: string, email?: string) => void
  error: string
  setError: (e: string) => void
}) {
  const [view, setView] = useState<'login' | 'forgot-password'>('login')
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('freellmapi_admin_email') || ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isWebAuthnSupported = typeof window !== 'undefined' && !!window.PublicKeyCredential
  const [hasPasskeys, setHasPasskeys] = useState(() => {
    try {
      return localStorage.getItem('freellmapi_has_passkeys') === 'true' || isWebAuthnSupported
    } catch {
      return isWebAuthnSupported
    }
  })

  useEffect(() => {
    apiFetch<{ hasPasskeys: boolean }>('/api/auth/webauthn/has-passkeys')
      .then(res => {
        setHasPasskeys(res.hasPasskeys || isWebAuthnSupported)
        if (res.hasPasskeys) {
          try {
            localStorage.setItem('freellmapi_has_passkeys', 'true')
          } catch {}
        }
      })
      .catch(() => {})
  }, [isWebAuthnSupported])

  const isSessionExpired = !!error && (error.toLowerCase().includes('session expired') || error.toLowerCase().includes('locked'))
  const isLocked = !!error && error.toLowerCase().includes('locked')

  if (view === 'forgot-password') {
    return <ForgotPasswordForm onSuccess={onSuccess} error={error} setError={setError} onBack={() => setView('login')} />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const data = await apiFetch<{ token: string; user?: { id: number; email: string } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      try {
        localStorage.setItem('freellmapi_admin_email', data.user?.email || email)
      } catch {}
      onSuccess(data.token, data.user?.email || email)
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePasskeyLogin() {
    setError('')
    setSubmitting(true)
    try {
      const options = await apiFetch<any>('/api/auth/webauthn/login-options', { method: 'POST' })
      const authResponse = await startAuthentication({ optionsJSON: options })
      const data = await apiFetch<{ token: string; user?: { id: number; email: string } }>('/api/auth/webauthn/login-verify', {
        method: 'POST',
        body: JSON.stringify(authResponse),
      })
      if (data.user?.email) {
        try {
          localStorage.setItem('freellmapi_admin_email', data.user.email)
        } catch {}
      }
      onSuccess(data.token, data.user?.email)
    } catch (err: any) {
      const msg = err.message || ''
      if (msg.includes('not recognized') || msg.includes('not registered') || msg.includes('No passkey')) {
        setError('No passkey registered on this device yet. Sign in with password below, then tap the Fingerprint icon in the header to register biometrics.')
      } else if (!msg.includes('canceled') && !msg.includes('cancelled') && !msg.includes('AbortError')) {
        setError(msg || 'Passkey authentication canceled or failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const showPasskeyOption = isSessionExpired || hasPasskeys || isWebAuthnSupported
  const showSpecificError = !!error && (!isSessionExpired || error.toLowerCase().includes('failed') || error.toLowerCase().includes('invalid') || error.toLowerCase().includes('not registered'))

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {isSessionExpired ? (
          <div className="text-center mb-6">
            <div className="size-12 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center mx-auto mb-3 text-amber-500 dark:text-amber-400 shadow-xs">
              <Lock className="size-6" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">
              {isLocked ? 'Console Locked' : 'Session Expired'}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Authenticate with biometrics, passkey, or password to resume
            </p>
          </div>
        ) : (
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="inline-block size-2 rounded-full bg-foreground" />
              <span className="font-semibold tracking-tight text-sm text-foreground">FreeLLMAPI</span>
            </div>
            <h1 className="text-xl font-semibold text-foreground">Sign in to Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter your credentials to access the admin panel</p>
          </div>
        )}

        {showPasskeyOption && (
          <div className="mb-6">
            <button
              type="button"
              onClick={handlePasskeyLogin}
              disabled={submitting}
              className="w-full rounded-xl border-2 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-4 py-3 text-sm font-semibold hover:bg-emerald-500/20 focus:outline-none focus:ring-2 focus:ring-emerald-500 flex items-center justify-center gap-2.5 disabled:opacity-50 transition-all shadow-xs group cursor-pointer"
            >
              <Fingerprint className="size-5 group-hover:scale-110 transition-transform" />
              <span>{isSessionExpired ? 'Unlock with Fingerprint / Passkey' : 'Sign in with Fingerprint / Passkey'}</span>
            </button>
            <div className="relative mt-5 mb-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">OR enter password</span>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {showSpecificError && (
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
              autoFocus={!hasPasskeys}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="login-password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <button
                type="button"
                onClick={() => setView('forgot-password')}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline focus:outline-none"
              >
                Forgot password?
              </button>
            </div>
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

// ─── Forgot Password Form ────────────────────────────────────────────────────

function ForgotPasswordForm({
  onSuccess,
  error,
  setError,
  onBack,
}: {
  onSuccess: (token: string, email?: string) => void
  error: string
  setError: (e: string) => void
  onBack: () => void
}) {
  const [phase, setPhase] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    setSubmitting(true)

    try {
      const data = await apiFetch<{ success: boolean; message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      if (data.success) {
        setPhase(2)
        setMessage(data.message)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to request code')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setSubmitting(true)

    try {
      const data = await apiFetch<{ token: string; user?: { id: number; email: string } }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, code, newPassword }),
      })
      onSuccess(data.token, data.user?.email || email)
    } catch (err: any) {
      setError(err.message || 'Reset failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 1) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-xl font-semibold text-foreground">Forgot Password</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter your email to receive a reset code</p>
          </div>

          <form onSubmit={handleRequestCode} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="forgot-email" className="block text-sm font-medium text-foreground mb-1.5">
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="admin@example.com"
              />
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Sending...' : 'Send Reset Code'}
              </button>
              <button
                type="button"
                onClick={onBack}
                disabled={submitting}
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
              >
                Back to sign in
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-foreground">Reset Password</h1>
          <p className="text-sm text-muted-foreground mt-1">Check your server logs (e.g. Render Dashboard Logs) for the 6-character code.</p>
        </div>

        <form onSubmit={handleReset} className="space-y-4">
          {message && (
            <div className="rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2 text-sm text-green-600 dark:text-green-400">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="reset-code" className="block text-sm font-medium text-foreground mb-1.5">
              Reset Code
            </label>
            <input
              id="reset-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              maxLength={6}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono tracking-widest text-center"
              placeholder="ABC123"
            />
          </div>

          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-foreground mb-1.5">
              New Password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Minimum 8 characters"
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-foreground mb-1.5">
              Confirm Password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="••••••••"
            />
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Resetting...' : 'Reset & Log In'}
            </button>
            <button
              type="button"
              onClick={onBack}
              disabled={submitting}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
            >
              Back to sign in
            </button>
          </div>
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
  onSuccess: (token: string, email?: string) => void
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

    if (!setupCode.trim() || setupCode.trim().length !== 6) {
      setError('6-character setup code from server console logs is required')
      return
    }

    setSubmitting(true)

    try {
      const body = {
        email: email.trim(),
        password,
        setupCode: setupCode.trim(),
      }

      const data = await apiFetch<{ token: string; user?: { id: number; email: string } }>('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      onSuccess(data.token, data.user?.email || email)
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
              Setup Code <span className="text-destructive">*</span> <span className="text-muted-foreground font-normal">(6-character code from server logs)</span>
            </label>
            <input
              id="setup-code"
              type="text"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value.toUpperCase())}
              required
              minLength={6}
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
          Check your server console logs (terminal or cloud dashboard) for the required 6-character setup code printed at boot.
        </p>
      </div>
    </div>
  )
}
