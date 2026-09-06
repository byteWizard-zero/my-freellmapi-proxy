import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/page-header'

interface FallbackEntry {
  modelDbId: number
  priority: number
  effectivePriority: number
  penalty: number
  rateLimitHits: number
  enabled: boolean
  platform: string
  modelId: string
  displayName: string
  intelligenceRank: number
  speedRank: number
  sizeLabel: string
  rpmLimit: number | null
  rpdLimit: number | null
  monthlyTokenBudget: string
  keyCount: number
  modality?: string
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

interface TokenUsageData {
  totalBudget: number
  totalUsed: number
  models: { displayName: string; platform: string; budget: number }[]
}

const platformColors: Record<string, string> = {
  google:      '#4285f4',
  groq:        '#f55036',
  cerebras:    '#8b5cf6',
  sambanova:   '#10b981',
  nvidia:      '#76b900',
  mistral:     '#f97316',
  openrouter:  '#6366f1',
  github:      '#e2e8f0',
  cohere:      '#d97706',
  cloudflare:  '#f38020',
  zhipu:       '#0284c7',
  ollama:      '#94a3b8',
  kilo:        '#06b6d4',
  pollinations:'#ec4899',
  llm7:        '#a855f7',
  moonshot:    '#3b82f6',
  experiential:'#14b8a6',
}

function TokenUsageBar({ data }: { data: TokenUsageData }) {
  const { totalBudget, totalUsed, models } = data
  const remainingTotal = Math.max(0, totalBudget - totalUsed)
  const usagePercent = totalBudget > 0 ? Math.min(100, Math.round((totalUsed / totalBudget) * 100)) : 0

  const activeModels = models.filter(m => m.budget > 0)
  const modelsWithWidth = activeModels.map(m => ({
    ...m,
    remainingTokens: m.budget,
    widthPercent: totalBudget > 0 ? (m.budget / totalBudget) * 100 : 0,
  }))

  return (
    <section className="rounded-lg border bg-card p-5" aria-label="Monthly token budget pool">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-medium">Monthly free token pool</h2>
        <span className="text-xs font-mono text-muted-foreground">
          {formatTokens(remainingTotal)} / {formatTokens(totalBudget)} remaining ({100 - usagePercent}%)
        </span>
      </div>

      <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
        {modelsWithWidth.map((m, i) => (
          <div
            key={i}
            className="h-full transition-all duration-300 first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${m.widthPercent}%`,
              backgroundColor: platformColors[m.platform] ?? '#94a3b8',
            }}
            title={`${m.displayName} (${m.platform}): ${formatTokens(m.remainingTokens)}`}
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-1.5 text-xs tabular-nums">
        {modelsWithWidth.map((m, i) => (
          <div key={i} className="flex items-center gap-2 min-w-0">
            <span
              className="size-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: platformColors[m.platform] ?? '#94a3b8' }}
            />
            <span className="truncate">{m.displayName}</span>
            <span className="flex-1" />
            <span className="font-mono text-muted-foreground">{formatTokens(m.remainingTokens)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function SortableModelRow({
  entry,
  index,
  onToggle,
}: {
  entry: FallbackEntry
  index: number
  onToggle: (modelDbId: number, enabled: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.modelDbId,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const modalityBadge = (() => {
    switch (entry.modality) {
      case 'vision':
        return <span className="text-[10px] bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded font-mono font-medium">Vision</span>
      case 'image':
        return <span className="text-[10px] bg-pink-500/10 text-pink-600 dark:text-pink-400 px-1.5 py-0.5 rounded font-mono font-medium">Image</span>
      case 'audio_stt':
        return <span className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-mono font-medium">Audio STT</span>
      case 'audio_tts':
        return <span className="text-[10px] bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 px-1.5 py-0.5 rounded font-mono font-medium">Audio TTS</span>
      case 'embedding':
        return <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-mono font-medium">Embedding</span>
      case 'moderation':
        return <span className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-mono font-medium">Moderation</span>
      default:
        return null
    }
  })()

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 px-4 py-3 bg-card ${isDragging ? 'opacity-50' : ''} ${entry.enabled ? '' : 'opacity-50'}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground transition-colors"
        aria-label="Drag to reorder"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>

      <span className="text-xs font-mono text-muted-foreground w-6 text-right tabular-nums">
        {index + 1}
      </span>

      <span
        className="size-2 rounded-sm flex-shrink-0"
        style={{ backgroundColor: platformColors[entry.platform] ?? '#94a3b8' }}
        title={entry.platform}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{entry.displayName}</span>
          {modalityBadge}
          <span className="text-xs text-muted-foreground">{entry.platform}</span>
          {entry.sizeLabel && (
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">
              {entry.sizeLabel}
            </span>
          )}
          {entry.keyCount === 0 && entry.platform !== 'pollinations' && (
            <span className="text-[10px] bg-rose-500/10 text-rose-500 px-1.5 py-0.5 rounded font-mono">
              No Key
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          {entry.rpmLimit && <span>{entry.rpmLimit} RPM</span>}
          {entry.rpdLimit && <span>{entry.rpdLimit} RPD</span>}
          <span>{entry.monthlyTokenBudget} tok/mo</span>
        </div>
      </div>
      <Switch
        checked={entry.enabled}
        onCheckedChange={(checked) => onToggle(entry.modelDbId, checked)}
      />
    </div>
  )
}

export default function FallbackPage() {
  const queryClient = useQueryClient()
  const [localEntries, setLocalEntries] = useState<FallbackEntry[] | null>(null)
  const [modalityFilter, setModalityFilter] = useState<'all' | 'chat' | 'vision' | 'image' | 'audio_stt' | 'audio_tts' | 'embedding' | 'moderation'>('all')
  const [showUnconfigured, setShowUnconfigured] = useState(false)

  const { data: entries = [], isLoading } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })

  const { data: tokenUsage } = useQuery<TokenUsageData>({
    queryKey: ['fallback', 'token-usage'],
    queryFn: () => apiFetch('/api/fallback/token-usage'),
  })

  const saveMutation = useMutation({
    mutationFn: (data: { modelDbId: number; priority: number; enabled: boolean }[]) =>
      apiFetch('/api/fallback', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setLocalEntries(null)
    },
  })

  const sortMutation = useMutation({
    mutationFn: (preset: string) =>
      apiFetch(`/api/fallback/sort/${preset}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setLocalEntries(null)
    },
  })

  const allEntries = localEntries ?? entries
  const visibleEntries = showUnconfigured
    ? allEntries
    : allEntries.filter(e => e.keyCount > 0 || e.platform === 'pollinations')
  const displayEntries = visibleEntries.filter(e => {
    if (modalityFilter === 'all') return true
    if (modalityFilter === 'chat') return !e.modality || e.modality === 'chat'
    return e.modality === modalityFilter
  })
  const unconfiguredPlatforms = [...new Set(allEntries.filter(e => e.keyCount === 0 && e.platform !== 'pollinations').map(e => e.platform))]

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = displayEntries.findIndex(e => e.modelDbId === active.id)
    const newIndex = displayEntries.findIndex(e => e.modelDbId === over.id)
    const reorderedVisible = arrayMove(displayEntries, oldIndex, newIndex)
    const unconfigured = allEntries.filter(e => e.keyCount === 0 && e.platform !== 'pollinations')
    const merged = [
      ...reorderedVisible.map((e, i) => ({ ...e, priority: i + 1 })),
      ...unconfigured.map((e, i) => ({ ...e, priority: reorderedVisible.length + i + 1 })),
    ]
    setLocalEntries(merged)
  }

  function handleToggle(modelDbId: number, enabled: boolean) {
    const updated = allEntries.map(e =>
      e.modelDbId === modelDbId ? { ...e, enabled } : e
    )
    setLocalEntries(updated)
  }

  function handleSave() {
    if (!localEntries) return
    saveMutation.mutate(
      allEntries.map(e => ({
        modelDbId: e.modelDbId,
        priority: e.priority,
        enabled: e.enabled,
      }))
    )
  }

  const hasChanges = localEntries !== null

  return (
    <div>
      <PageHeader
        title="Fallback chain"
        description="Drag to reorder. Requests try models top-to-bottom until one succeeds."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => sortMutation.mutate('intelligence')}
              disabled={sortMutation.isPending}
            >
              Sort by intelligence
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sortMutation.mutate('speed')}
              disabled={sortMutation.isPending}
            >
              Sort by speed
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sortMutation.mutate('budget')}
              disabled={sortMutation.isPending}
            >
              Sort by budget
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {tokenUsage && tokenUsage.totalBudget > 0 && (
          <TokenUsageBar data={tokenUsage} />
        )}

        {/* Filter Controls Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Modality Filter Pills */}
          <div className="flex items-center gap-1.5 p-1 bg-muted/60 border rounded-lg overflow-x-auto">
            {[
              { id: 'all', label: 'All Models' },
              { id: 'chat', label: '💬 Chat / LLM' },
              { id: 'vision', label: '👁️ Vision' },
              { id: 'image', label: '🎨 Image Gen' },
              { id: 'audio_stt', label: '🎙️ Audio STT' },
              { id: 'audio_tts', label: '🔊 Audio TTS' },
              { id: 'embedding', label: '🔢 Embeddings' },
              { id: 'moderation', label: '🛡️ Moderation' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setModalityFilter(tab.id as any)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                  modalityFilter === tab.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none border rounded-lg px-3 py-1.5 bg-muted/30 whitespace-nowrap self-start sm:self-auto">
            <input
              type="checkbox"
              checked={showUnconfigured}
              onChange={(e) => setShowUnconfigured(e.target.checked)}
              className="rounded border-input text-primary focus:ring-ring size-3.5 cursor-pointer"
            />
            <span>Show unconfigured models</span>
          </label>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : displayEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No models found for this filter. Add API keys on the <a href="/keys" className="underline text-foreground">Keys page</a> first.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border divide-y overflow-hidden">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={displayEntries.map(e => e.modelDbId)}
                  strategy={verticalListSortingStrategy}
                >
                  {displayEntries.map((entry, index) => (
                    <SortableModelRow
                      key={entry.modelDbId}
                      entry={entry}
                      index={index}
                      onToggle={handleToggle}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>

            {hasChanges && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setLocalEntries(null)}>
                  Discard
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Saving…' : 'Save order'}
                </Button>
              </div>
            )}

            {unconfiguredPlatforms.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Hidden (no keys): {unconfiguredPlatforms.join(', ')}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
