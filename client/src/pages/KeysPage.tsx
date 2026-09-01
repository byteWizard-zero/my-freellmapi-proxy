import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/page-header'
import { AlertCircle, Sparkles, ChevronDown, Loader2, AlertTriangle, Shield, Key, Plus, Check, Copy } from 'lucide-react'
import type { ApiKey, Platform, ClientApiKey, ClientApiKeyCreatedResponse } from '../../../shared/types'

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'google', label: 'Google AI Studio' },
  { value: 'groq', label: 'Groq' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'sambanova', label: 'SambaNova' },
  { value: 'nvidia', label: 'NVIDIA NIM' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'github', label: 'GitHub Models' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'zhipu', label: 'Zhipu AI (Z.ai)' },
  { value: 'ollama', label: 'Ollama Cloud' },
  { value: 'kilo', label: 'Kilo Gateway (anon ok)' },
  { value: 'pollinations', label: 'Pollinations (anon ok)' },
  { value: 'llm7', label: 'LLM7 (anon ok)' },
  { value: 'moonshot', label: 'Moonshot AI (Kimi)' },
]

export const PLATFORM_CAPABILITIES: Record<Platform, string[]> = {
  google: ['Chat', 'Vision', 'Image Gen', 'Audio STT', 'Embeddings', 'Moderation'],
  cloudflare: ['Chat', 'Vision', 'Image Gen', 'Audio STT', 'Audio TTS', 'Embeddings', 'Moderation'],
  groq: ['Chat', 'Vision', 'Audio STT'],
  pollinations: ['Chat', 'Image Gen', 'Audio TTS'],
  mistral: ['Chat', 'Vision', 'Embeddings'],
  openrouter: ['Chat', 'Vision'],
  github: ['Chat', 'Vision'],
  zhipu: ['Chat', 'Vision'],
  cerebras: ['Chat'],
  sambanova: ['Chat'],
  nvidia: ['Chat'],
  cohere: ['Chat', 'Embeddings'],
  ollama: ['Chat'],
  kilo: ['Chat'],
  llm7: ['Chat'],
  moonshot: ['Chat'],
}

const statusDot: Record<string, string> = {
  healthy: 'bg-emerald-500',
  rate_limited: 'bg-amber-500',
  invalid: 'bg-rose-500',
  error: 'bg-rose-500',
  unknown: 'bg-muted-foreground/40',
}

const statusLabel: Record<string, string> = {
  healthy: 'healthy',
  rate_limited: 'rate-limited',
  invalid: 'invalid',
  error: 'error',
  unknown: 'unchecked',
}

interface HealthPlatform {
  platform: string
  totalKeys: number
  healthyKeys: number
  rateLimitedKeys: number
  invalidKeys: number
  errorKeys: number
  unknownKeys: number
}

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
  platforms: HealthPlatform[]
  keys: { id: number; platform: string; status: string; lastCheckedAt: string | null; errorMessage?: string | null }[]
  cooldowns: CooldownInfo[]
}

function UnifiedKeySection() {
  const queryClient = useQueryClient()
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const { data } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const regenerate = useMutation({
    mutationFn: () => apiFetch('/api/settings/api-key/regenerate', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['unified-key'] }),
  })

  const apiKey = data?.apiKey ?? ''
  const masked = apiKey ? apiKey.slice(0, 13) + '•'.repeat(32) : '…'
  const baseUrl = import.meta.env.DEV
    ? `http://${window.location.hostname}:${__SERVER_PORT__}/v1`
    : `${window.location.origin}/v1`

  function copy() {
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-medium">Your unified API key</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Use this as your OpenAI <code className="font-mono">api_key</code>; it authenticates requests to this proxy.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowConfirm(true)}
          disabled={regenerate.isPending}
        >
          Regenerate
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-xs bg-muted px-3 py-2 rounded-md select-all truncate tabular-nums">
          {showKey ? apiKey : masked}
        </code>
        <Button variant="outline" size="sm" onClick={() => setShowKey(!showKey)}>
          {showKey ? 'Hide' : 'Show'}
        </Button>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Base URL</span>
        <code className="font-mono">{baseUrl}</code>
        <span className="text-muted-foreground">Endpoint</span>
        <code className="font-mono">/v1/chat/completions</code>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-sm transition-all duration-200">
          <div className="bg-card border border-border/80 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-destructive/10 text-destructive flex-shrink-0">
                <AlertTriangle className="size-5" />
              </div>
              <div className="space-y-1 flex-1">
                <h3 className="text-base font-semibold leading-none text-foreground">Regenerate Unified API Key?</h3>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  Are you sure you want to regenerate your unified API key? The current key will be immediately invalidated, and any apps or integrations using it will fail to connect until updated.
                </p>
              </div>
            </div>
            
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirm(false)}
                disabled={regenerate.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  regenerate.mutate(undefined, {
                    onSuccess: () => {
                      setShowConfirm(false)
                    }
                  })
                }}
                disabled={regenerate.isPending}
              >
                {regenerate.isPending ? 'Regenerating…' : 'Regenerate Key'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function ClientKeysSection() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [rateLimitRpm, setRateLimitRpm] = useState(60)
  const [monthlyTokenBudget, setMonthlyTokenBudget] = useState(1000000)
  const [createdKeyData, setCreatedKeyData] = useState<ClientApiKeyCreatedResponse | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)

  const { data, isLoading } = useQuery<{ keys: ClientApiKey[] }>({
    queryKey: ['client-keys'],
    queryFn: () => apiFetch('/api/client-keys'),
  })

  const createKey = useMutation({
    mutationFn: (body: { name: string; rateLimitRpm: number; monthlyTokenBudget: number }) =>
      apiFetch<ClientApiKeyCreatedResponse>('/api/client-keys', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      setCreatedKeyData(res)
      setName('')
      queryClient.invalidateQueries({ queryKey: ['client-keys'] })
    },
  })

  const deleteKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/client-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-keys'] }),
  })

  const toggleKey = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiFetch(`/api/client-keys/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-keys'] }),
  })

  const keys = data?.keys ?? []

  function copyKey(val: string) {
    navigator.clipboard.writeText(val)
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 1500)
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    createKey.mutate({
      name: name.trim(),
      rateLimitRpm: Number(rateLimitRpm) || 60,
      monthlyTokenBudget: Number(monthlyTokenBudget) || 1000000,
    })
  }

  return (
    <section className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-primary" />
            <h2 className="text-sm font-medium">Multi-tenant Client Keys & Token Budgets</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Issue isolated API keys for downstream apps, agents, or tenants with per-key RPM limits and monthly token quotas.
          </p>
        </div>
      </div>

      {/* Create Client Key Form */}
      <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-muted/20 border p-3 rounded-lg">
        <div className="space-y-1">
          <Label className="text-xs">Client / App Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mobile App, Discord Bot"
            className="text-xs h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Rate Limit (RPM)</Label>
          <Input
            type="number"
            min={1}
            max={10000}
            value={rateLimitRpm}
            onChange={(e) => setRateLimitRpm(Number(e.target.value))}
            className="text-xs h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Monthly Token Budget</Label>
          <Input
            type="number"
            min={1000}
            step={50000}
            value={monthlyTokenBudget}
            onChange={(e) => setMonthlyTokenBudget(Number(e.target.value))}
            className="text-xs h-8"
          />
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            size="sm"
            className="w-full h-8 gap-1.5 text-xs"
            disabled={!name.trim() || createKey.isPending}
          >
            <Plus className="size-3.5" />
            {createKey.isPending ? 'Generating…' : 'Create Client Key'}
          </Button>
        </div>
      </form>

      {/* New Key Alert Banner */}
      {createdKeyData && (
        <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 space-y-2 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Key className="size-3.5" /> Key Generated for "{createdKeyData.name}"
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setCreatedKeyData(null)}
            >
              Dismiss
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Copy this key now. For security reasons, it will never be displayed in full again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-background/80 px-2.5 py-1.5 rounded border select-all truncate text-foreground font-medium">
              {createdKeyData.key}
            </code>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => copyKey(createdKeyData.key)}
              className="gap-1 text-xs"
            >
              {copiedKey ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              {copiedKey ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      {/* Client Keys Table / List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="size-3.5 animate-spin text-primary" /> Loading client keys...
          </div>
        ) : keys.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
            No client keys created yet. Create one above to grant isolated API access with custom token budgets.
          </div>
        ) : (
          <div className="grid gap-2">
            {keys.map((k) => {
              const usagePercent = Math.min(100, Math.round((k.tokensUsed / (k.monthlyTokenBudget || 1)) * 100))
              const isOverQuota = k.tokensUsed >= k.monthlyTokenBudget
              return (
                <div
                  key={k.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border bg-background/50 hover:bg-background/80 transition-colors"
                >
                  <div className="space-y-1 min-w-[160px]">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-xs text-foreground">{k.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${k.enabled ? (isOverQuota ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20') : 'bg-muted text-muted-foreground'}`}>
                        {!k.enabled ? 'Disabled' : isOverQuota ? 'Quota Exceeded' : 'Active'}
                      </span>
                    </div>
                    <code className="text-[11px] font-mono text-muted-foreground">{k.prefix}••••••••</code>
                  </div>

                  <div className="flex-1 max-w-sm space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{k.tokensUsed.toLocaleString()} / {k.monthlyTokenBudget.toLocaleString()} tokens</span>
                      <span className="font-mono font-medium">{usagePercent}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${usagePercent >= 90 ? 'bg-rose-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-primary'}`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-muted/60 text-muted-foreground">
                      {k.rateLimitRpm} RPM
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => toggleKey.mutate({ id: k.id, enabled: !k.enabled })}
                      disabled={toggleKey.isPending}
                    >
                      {k.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => deleteKey.mutate(k.id)}
                      disabled={deleteKey.isPending}
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}


function parseMarkdown(text: string) {
  if (!text) return null
  const lines = text.split('\n')
  return lines.map((line, idx) => {
    const content = line.trim()
    if (content.startsWith('### ')) {
      return <h4 key={idx} className="font-semibold text-xs mt-3 mb-1 text-foreground">{content.slice(4)}</h4>
    }
    if (content.startsWith('## ')) {
      return <h3 key={idx} className="font-bold text-sm mt-4 mb-2 text-foreground">{content.slice(3)}</h3>
    }
    if (content.startsWith('# ')) {
      return <h2 key={idx} className="font-extrabold text-base mt-4 mb-2 text-foreground">{content.slice(2)}</h2>
    }

    const isBullet = content.startsWith('- ') || content.startsWith('* ') || /^\d+\.\s/.test(content)
    let bulletText = content
    if (content.startsWith('- ') || content.startsWith('* ')) {
      bulletText = content.slice(2)
    } else if (/^\d+\.\s/.test(content)) {
      bulletText = content.replace(/^\d+\.\s/, '')
    }

    const parts = []
    let currentText = bulletText
    const boldRegex = /\*\*(.*?)\*\*/g
    let match
    let lastIndex = 0
    while ((match = boldRegex.exec(currentText)) !== null) {
      if (match.index > lastIndex) {
        parts.push(currentText.substring(lastIndex, match.index))
      }
      parts.push(<strong key={match.index} className="font-semibold text-foreground">{match[1]}</strong>)
      lastIndex = boldRegex.lastIndex
    }
    if (lastIndex < currentText.length) {
      parts.push(currentText.substring(lastIndex))
    }

    const renderedContent = parts.length > 0 ? parts : bulletText

    if (isBullet) {
      return (
        <div key={idx} className="flex gap-2 ml-2 my-1 text-xs">
          <span className="text-muted-foreground select-none">•</span>
          <span>{renderedContent}</span>
        </div>
      )
    }

    return content ? <p key={idx} className="my-1.5 leading-relaxed text-xs">{renderedContent}</p> : <div key={idx} className="h-2" />
  })
}

export default function KeysPage() {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [label, setLabel] = useState('')
  
  const [expandedKeyId, setExpandedKeyId] = useState<number | null>(null)
  const [troubleshootText, setTroubleshootText] = useState<string | null>(null)
  const [loadingTroubleshoot, setLoadingTroubleshoot] = useState(false)

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ['keys'],
    queryFn: () => apiFetch('/api/keys'),
  })

  const { data: healthData } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    refetchInterval: 30000,
  })

  const addKey = useMutation({
    mutationFn: (body: { platform: string; key: string; label?: string }) =>
      apiFetch('/api/keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setPlatform('')
      setApiKey('')
      setAccountId('')
      setLabel('')
    },
  })

  const deleteKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })

  const checkAll = useMutation({
    mutationFn: (mode: 'sequential' | 'parallel') =>
      apiFetch(`/api/health/check-all?mode=${mode}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const checkKey = useMutation({
    mutationFn: (keyId: number) => apiFetch(`/api/health/check/${keyId}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const needsAccountId = platform === 'cloudflare'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!platform || !apiKey) return
    if (needsAccountId && !accountId) return
    const key = needsAccountId ? `${accountId}:${apiKey}` : apiKey
    addKey.mutate({ platform, key, label: label || undefined })
  }

  const handleToggleExpand = async (keyId: number) => {
    if (expandedKeyId === keyId) {
      setExpandedKeyId(null)
      return
    }

    setExpandedKeyId(keyId)
    setLoadingTroubleshoot(true)
    setTroubleshootText(null)

    try {
      const res = await apiFetch<{ suggestion: string }>(`/api/keys/${keyId}/troubleshoot`, {
        method: 'POST',
      })
      setTroubleshootText(res.suggestion)
    } catch (err: any) {
      setTroubleshootText(`Could not generate suggestions: ${err.message}`)
    } finally {
      setLoadingTroubleshoot(false)
    }
  }

  const healthKeyMap = new Map<number, { status: string; lastCheckedAt: string | null; errorMessage?: string | null }>()
  for (const k of healthData?.keys ?? []) healthKeyMap.set(k.id, k)

  const grouped = PLATFORMS.map(p => ({
    ...p,
    keys: keys.filter(k => k.platform === p.value),
  })).filter(p => p.keys.length > 0)

  return (
    <div>
      <PageHeader
        title="Keys"
        description="Provider credentials and the unified API key your apps connect with."
        actions={
          keys.length > 0 && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => checkAll.mutate('sequential')} disabled={checkAll.isPending}>
                {checkAll.isPending && checkAll.variables === 'sequential' ? 'Checking…' : 'Check one-by-one'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => checkAll.mutate('parallel')} disabled={checkAll.isPending}>
                {checkAll.isPending && checkAll.variables === 'parallel' ? 'Checking…' : 'Check simultaneously'}
              </Button>
            </div>
          )
        }
      />

      <div className="space-y-8">
        <UnifiedKeySection />
        <ClientKeysSection />

        <section>
          <h2 className="text-sm font-medium mb-3">Add a provider key</h2>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border p-4 bg-card">
            <div className="space-y-1.5">
              <Label className="text-xs">Platform</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsAccountId && (
              <div className="space-y-1.5">
                <Label className="text-xs">Account ID</Label>
                <Input
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  placeholder="a1b2c3d4…"
                  className="w-[200px] font-mono text-xs"
                />
              </div>
            )}
            <div className="space-y-1.5 flex-1 min-w-[240px]">
              <Label className="text-xs">{needsAccountId ? 'API token' : 'API key'}</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={needsAccountId ? 'Bearer token' : 'paste key here'}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Label</Label>
              <Input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="optional"
                className="w-[160px]"
              />
            </div>
            <Button type="submit" size="sm" disabled={!platform || !apiKey || (needsAccountId && !accountId) || addKey.isPending}>
              {addKey.isPending ? 'Adding…' : 'Add key'}
            </Button>
          </form>
          {addKey.isError && (
            <p className="text-destructive text-xs mt-2">{(addKey.error as Error).message}</p>
          )}
        </section>

        <section>
          <h2 className="text-sm font-medium mb-3">Configured providers</h2>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : keys.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No provider keys yet. Add one above to start routing.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(group => (
                <div key={group.value}>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium">{group.label}</h3>
                      <div className="flex items-center gap-1">
                        {PLATFORM_CAPABILITIES[group.value as Platform]?.map(cap => (
                          <span
                            key={cap}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              cap === 'Vision'
                                ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                                : cap === 'Image Gen'
                                ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400'
                                : cap.startsWith('Audio')
                                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {group.keys.length} key{group.keys.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="rounded-lg border divide-y bg-card overflow-hidden">
                    {group.keys.map(k => {
                      const h = healthKeyMap.get(k.id)
                      const status = h?.status ?? k.status
                      const lastChecked = h?.lastCheckedAt
                      const errorMessage = h?.errorMessage ?? k.errorMessage
                      const isError = status === 'error' || status === 'invalid'
                      const isExpanded = expandedKeyId === k.id && isError

                      return (
                        <div key={k.id} className="border-b last:border-b-0">
                          <div
                            onClick={() => {
                              if (isError) handleToggleExpand(k.id)
                            }}
                            className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                              isError ? 'cursor-pointer hover:bg-muted/40' : 'hover:bg-muted/10'
                            }`}
                          >
                            <span className={`size-1.5 rounded-full flex-shrink-0 ${statusDot[status] ?? statusDot.unknown}`} />
                            <code className="text-xs font-mono flex-shrink-0">{k.maskedKey}</code>
                            {k.label && <span className="text-xs text-muted-foreground">{k.label}</span>}
                            
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              {statusLabel[status] ?? status}
                              {isError && (
                                <ChevronDown
                                  className={`size-3.5 text-muted-foreground transition-transform duration-200 ${
                                    isExpanded ? 'rotate-180 text-rose-500 font-semibold' : ''
                                  }`}
                                />
                              )}
                            </span>

                            <div className="flex-1" />
                            {lastChecked && (
                              <span className="text-[11px] text-muted-foreground tabular-nums mr-2">
                                {new Date(lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation()
                                checkKey.mutate(k.id)
                              }}
                              disabled={checkKey.isPending}
                            >
                              Check
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteKey.mutate(k.id)
                              }}
                              disabled={deleteKey.isPending}
                            >
                              Remove
                            </Button>
                          </div>

                          <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
                            <div className="overflow-hidden bg-muted/10">
                              <div className="px-4 pb-4 pt-2 border-t space-y-3">
                                <div className="space-y-1">
                                  <h4 className="text-[10px] font-bold tracking-wider text-rose-500 uppercase flex items-center gap-1">
                                    <AlertCircle className="size-3" />
                                    Exact Error Message
                                  </h4>
                                  <pre className="text-[11px] font-mono bg-rose-500/5 text-rose-600 dark:text-rose-400 p-2.5 rounded-md border border-rose-500/10 whitespace-pre-wrap select-all">
                                    {errorMessage || 'Unknown validation error'}
                                  </pre>
                                </div>
                                <div className="space-y-1">
                                  <h4 className="text-[10px] font-bold tracking-wider text-primary uppercase flex items-center gap-1">
                                    <Sparkles className="size-3" />
                                    AI Troubleshooting Suggestions
                                  </h4>
                                  <div className="text-xs text-muted-foreground bg-background/50 p-3 rounded-md border">
                                    {loadingTroubleshoot ? (
                                      <div className="flex items-center gap-2 py-1 text-muted-foreground font-medium">
                                        <Loader2 className="size-3 animate-spin text-primary" />
                                        <span>Generating suggestions using available healthy keys...</span>
                                      </div>
                                    ) : troubleshootText ? (
                                      parseMarkdown(troubleshootText)
                                    ) : (
                                      <span className="text-muted-foreground italic text-xs">Failed to load troubleshooting tips.</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
