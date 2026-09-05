import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/page-header'
import {
  Shield,
  Plus,
  Copy,
  Check,
  Trash2,
  Power,
  KeyRound,
  BarChart3,
  Code2,
} from 'lucide-react'
import type { ClientApiKey, ClientApiKeyCreatedResponse } from '../../../shared/types'

export default function ClientKeysPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [rateLimitRpm, setRateLimitRpm] = useState('60')
  const [monthlyTokenBudget, setMonthlyTokenBudget] = useState('1000000')
  const [createdKeyData, setCreatedKeyData] = useState<ClientApiKeyCreatedResponse | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)

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
      apiFetch(`/api/client-keys/${id}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-keys'] }),
  })

  const keys = data?.keys ?? []
  const activeCount = keys.filter(k => k.enabled).length
  const totalTokensUsed = keys.reduce((sum, k) => sum + (k.tokensUsed || 0), 0)

  function copyKey(val: string) {
    navigator.clipboard.writeText(val)
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 1500)
  }

  function copyCodeSnippet(keyStr: string) {
    const origin = window.location.origin
    const snippet = `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${origin}/v1",\n    api_key="${keyStr}",\n)\n\nresponse = client.chat.completions.create(\n    model="auto",\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(response.choices[0].message.content)`
    navigator.clipboard.writeText(snippet)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 1500)
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
    <div className="space-y-6">
      <PageHeader
        title="Project API Keys"
        description="Issue dedicated API keys for neighbor apps and agents with per-project RPM rate limits and monthly token budgets."
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Configured Projects</p>
            <p className="text-2xl font-bold mt-1">{keys.length}</p>
          </div>
          <div className="p-2.5 rounded-full bg-primary/10 text-primary">
            <KeyRound className="size-5" />
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Active Keys</p>
            <p className="text-2xl font-bold mt-1">{activeCount} / {keys.length}</p>
          </div>
          <div className="p-2.5 rounded-full bg-emerald-500/10 text-emerald-500">
            <Power className="size-5" />
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Tokens Consumed This Month</p>
            <p className="text-2xl font-bold mt-1">{totalTokensUsed.toLocaleString()}</p>
          </div>
          <div className="p-2.5 rounded-full bg-blue-500/10 text-blue-500">
            <BarChart3 className="size-5" />
          </div>
        </div>
      </div>

      {/* Create New Key Section */}
      <section className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Issue New Project Token</h2>
        </div>

        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-muted/20 border p-3.5 rounded-lg">
          <div className="space-y-1">
            <Label className="text-xs">Project / App Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lumina-AI, Discord Bot"
              className="text-xs h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Rate Limit (RPM)</Label>
            <Input
              type="number"
              min={1}
              max={10000}
              value={rateLimitRpm}
              onChange={(e) => setRateLimitRpm(e.target.value)}
              placeholder="60"
              className="text-xs h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Monthly Token Budget</Label>
            <Input
              type="number"
              min={1000}
              step={50000}
              value={monthlyTokenBudget}
              onChange={(e) => setMonthlyTokenBudget(e.target.value)}
              placeholder="1000000"
              className="text-xs h-9"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              size="sm"
              className="w-full h-9 gap-1.5 text-xs font-medium"
              disabled={!name.trim() || createKey.isPending}
            >
              <Plus className="size-3.5" />
              {createKey.isPending ? 'Generating…' : 'Generate Project Key'}
            </Button>
          </div>
        </form>

        {/* Modal-like Banner for Newly Created Key */}
        {createdKeyData && (
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-3 animate-in fade-in duration-200">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  🎉 Project Key Generated: {createdKeyData.name}
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Save this key now. For your security, this is the only time the full secret key will be displayed.
                </p>
              </div>
              <Button variant="ghost" size="xs" onClick={() => setCreatedKeyData(null)}>
                Dismiss
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs bg-background/80 px-3 py-2 rounded border select-all truncate text-foreground font-semibold">
                {createdKeyData.key}
              </code>
              <Button variant="outline" size="sm" onClick={() => copyKey(createdKeyData.key)} className="gap-1.5 text-xs">
                {copiedKey ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                {copiedKey ? 'Copied' : 'Copy Key'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => copyCodeSnippet(createdKeyData.key)} className="gap-1.5 text-xs">
                {copiedCode ? <Check className="size-3 text-emerald-500" /> : <Code2 className="size-3" />}
                {copiedCode ? 'Copied Code' : 'Copy Python SDK'}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Existing Keys Table */}
      <section className="rounded-lg border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">Active Project Keys</h2>

        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4">Loading project tokens…</p>
        ) : keys.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
            <Shield className="size-6 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium">No project keys issued yet</p>
            <p className="text-xs text-muted-foreground">
              Generate an isolated key above to grant a neighbor app safe, quota-controlled access.
            </p>
          </div>
        ) : (
          <div className="divide-y border rounded-lg overflow-hidden">
            {keys.map((k) => {
              const usagePercent = Math.min(100, Math.round(((k.tokensUsed || 0) / (k.monthlyTokenBudget || 1)) * 100))
              return (
                <div key={k.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/10 transition-colors">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className={`size-2 rounded-full flex-shrink-0 ${k.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                      <span className="text-xs font-semibold text-foreground">{k.name}</span>
                      <code className="text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {k.prefix}••••••••
                      </code>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">
                        {k.rateLimitRpm} RPM
                      </span>
                    </div>

                    {/* Token Quota Progress */}
                    <div className="space-y-1 max-w-md pt-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>Usage: {(k.tokensUsed || 0).toLocaleString()} tokens</span>
                        <span>Budget: {(k.monthlyTokenBudget || 0).toLocaleString()} ({usagePercent}%)</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            usagePercent > 90 ? 'bg-rose-500' : usagePercent > 70 ? 'bg-amber-500' : 'bg-primary'
                          }`}
                          style={{ width: `${usagePercent}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant={k.enabled ? 'outline' : 'secondary'}
                      size="xs"
                      onClick={() => toggleKey.mutate({ id: k.id, enabled: !k.enabled })}
                      className="text-xs"
                      disabled={toggleKey.isPending}
                    >
                      <Power className="size-3 mr-1" />
                      {k.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => deleteKey.mutate(k.id)}
                      className="text-destructive hover:bg-destructive/10 text-xs"
                      disabled={deleteKey.isPending}
                    >
                      <Trash2 className="size-3 mr-1" />
                      Revoke
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
