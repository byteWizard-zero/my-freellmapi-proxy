import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { registerDevicePasskey } from '@/components/AuthGate'
import { Fingerprint, Trash2, Plus, X, KeyRound, AlertCircle, Check } from 'lucide-react'

interface PasskeyItem {
  id: string
  device_type: string | null
  backed_up: number
  created_at: string
}

interface PasskeyManagerModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function PasskeyManagerModal({ isOpen, onClose }: PasskeyManagerModalProps) {
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const fetchPasskeys = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const data = await apiFetch<{ passkeys: PasskeyItem[] }>('/api/auth/webauthn/passkeys')
      setPasskeys(data.passkeys || [])
      if (data.passkeys?.length === 0) {
        localStorage.setItem('freellmapi_has_passkeys', 'false')
      } else {
        localStorage.setItem('freellmapi_has_passkeys', 'true')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load passkeys')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchPasskeys()
      setSuccessMsg('')
      setError('')
    }
  }, [isOpen, fetchPasskeys])

  if (!isOpen) return null

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this passkey?')) return
    setActionLoading(id)
    setError('')
    setSuccessMsg('')
    try {
      await apiFetch(`/api/auth/webauthn/passkeys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      setSuccessMsg('Passkey deleted successfully.')
      await fetchPasskeys()
    } catch (err: any) {
      setError(err.message || 'Failed to delete passkey')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleRemoveDuplicates() {
    if (passkeys.length <= 1) return
    if (!confirm(`This will keep the newest passkey and remove ${passkeys.length - 1} older duplicate(s). Continue?`)) return

    setActionLoading('bulk')
    setError('')
    setSuccessMsg('')
    try {
      // Keep the first (most recent), delete the rest
      const duplicates = passkeys.slice(1)
      for (const item of duplicates) {
        await apiFetch(`/api/auth/webauthn/passkeys/${encodeURIComponent(item.id)}`, {
          method: 'DELETE',
        })
      }
      setSuccessMsg(`Cleaned up ${duplicates.length} duplicate passkey(s). Retained newest key.`)
      await fetchPasskeys()
    } catch (err: any) {
      setError(err.message || 'Failed to remove duplicates')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleAddNew() {
    setRegistering(true)
    setError('')
    setSuccessMsg('')
    try {
      const success = await registerDevicePasskey()
      if (success) {
        setSuccessMsg('New passkey added successfully!')
        await fetchPasskeys()
      }
    } catch (err: any) {
      setError(err.message || 'Registration failed')
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Fingerprint className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Passkeys & Biometrics</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage registered devices, biometrics, and security keys
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Notifications */}
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
            <Check className="size-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Content list */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-[140px]">
          {loading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Loading registered passkeys...
            </div>
          ) : passkeys.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <KeyRound className="size-8 text-muted-foreground/50 mx-auto" />
              <p className="text-sm font-medium text-foreground">No passkeys registered</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                Add a passkey to sign in with Touch ID, Windows Hello, Face ID, or a hardware security key.
              </p>
            </div>
          ) : (
            passkeys.map((item, index) => {
              const isNewest = index === 0
              const formattedDate = new Date(item.created_at).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })
              const isDeleting = actionLoading === item.id

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3.5 rounded-xl border border-border/70 bg-background/50 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="size-8 rounded-lg bg-muted flex items-center justify-center text-foreground shrink-0">
                      <Fingerprint className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {item.device_type === 'singleDevice'
                            ? 'Device Passkey'
                            : item.device_type === 'multiDevice'
                            ? 'Synced Passkey (Cloud Keychain)'
                            : 'Security Key / Biometric'}
                        </span>
                        {isNewest && passkeys.length > 1 && (
                          <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            Active
                          </span>
                        )}
                        {!isNewest && passkeys.length > 1 && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            Duplicate
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span>ID: {item.id.slice(0, 8)}...{item.id.slice(-6)}</span>
                        <span>•</span>
                        <span>{formattedDate}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(item.id)}
                    disabled={isDeleting || actionLoading === 'bulk'}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0 disabled:opacity-50 ml-2"
                    title="Delete this passkey"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )
            })
          )}
        </div>

        {/* Actions Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
          {passkeys.length > 1 && (
            <button
              onClick={handleRemoveDuplicates}
              disabled={actionLoading !== null}
              className="text-xs text-amber-600 dark:text-amber-400 hover:underline font-medium flex items-center gap-1.5 px-1 py-1"
            >
              <Trash2 className="size-3.5" />
              <span>Clean up {passkeys.length - 1} duplicate(s)</span>
            </button>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleAddNew}
              disabled={registering || actionLoading !== null}
              className="rounded-lg bg-primary text-primary-foreground px-3.5 py-2 text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="size-3.5" />
              <span>{registering ? 'Registering...' : 'Register New Passkey'}</span>
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
