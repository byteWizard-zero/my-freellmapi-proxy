import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { AlertCircle, Clock, RefreshCw, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CooldownInfo {
  keyId: number
  platform: string
  modelId: string
  errorMessage: string
  expiry: string
  remainingSeconds: number
  label: string
  maskedKey: string
}

interface HealthData {
  cooldowns: CooldownInfo[]
}

function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return 'Awaking...'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0) {
    return `${m}m ${s}s`
  }
  return `${s}s`
}

function CooldownCard({ item, onExpire }: { item: CooldownInfo; onExpire: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const diff = Math.max(0, Math.ceil((new Date(item.expiry).getTime() - Date.now()) / 1000))
    return diff
  })

  useEffect(() => {
    if (secondsLeft <= 0) {
      onExpire()
      return
    }

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          onExpire()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [secondsLeft, item.expiry, onExpire])

  return (
    <div className="rounded-lg border border-amber-500/20 bg-card p-5 flex flex-col gap-4 shadow-sm transition-all hover:border-amber-500/30">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide capitalize">
              {item.platform}
            </span>
            <code className="font-mono text-xs text-foreground/80">{item.maskedKey}</code>
            {item.label && (
              <span className="text-xs text-muted-foreground">({item.label})</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Triggered by model: <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px] text-foreground">{item.modelId}</code>
          </p>
        </div>

        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-md flex-shrink-0">
          <Clock className="size-3.5 text-amber-500 animate-spin-slow" />
          <span className="tabular-nums">{formatRemainingTime(secondsLeft)}</span>
        </div>
      </div>

      <div className="space-y-1">
        <h4 className="text-[10px] font-bold tracking-wider text-rose-500 uppercase flex items-center gap-1">
          <AlertCircle className="size-3" />
          Upstream Error Message
        </h4>
        <pre className="text-[11px] font-mono bg-muted/45 text-muted-foreground p-3 rounded-md overflow-x-auto whitespace-pre-wrap leading-relaxed border border-muted/20 select-all max-h-[140px] overflow-y-auto">
          {item.errorMessage}
        </pre>
      </div>
    </div>
  )
}

export default function CooldownsPage() {
  const queryClient = useQueryClient()

  const { data, isLoading, isRefetching, refetch } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    refetchInterval: 30000,
  })

  const cooldowns = data?.cooldowns ?? []

  function handleExpire() {
    // Invalidate query to trigger immediate refetch when cooldown ends
    queryClient.invalidateQueries({ queryKey: ['health'] })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sleeping Keys"
        description="API credentials that are temporarily suspended due to rate limits or transient errors. Cooldowns last for 1 hour."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading || isRefetching}>
            <RefreshCw className={`size-3.5 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : cooldowns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-emerald-500/25 bg-emerald-500/5 p-12 text-center flex flex-col items-center justify-center gap-4">
          <div className="size-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
            <Sun className="size-5 fill-emerald-500/20" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">All keys are active and awake!</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              No API keys are currently on cooldown. The proxy has full access to all configured credentials.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cooldowns.map((c, idx) => (
            <CooldownCard key={idx} item={c} onExpire={handleExpire} />
          ))}
        </div>
      )}
    </div>
  )
}
