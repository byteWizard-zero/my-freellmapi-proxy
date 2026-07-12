import { useEffect, useState, useRef } from 'react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import {
  Play,
  Pause,
  Trash2,
  Download,
  Search,
  Terminal,
  Copy,
  Check,
  WrapText,
  AlertCircle
} from 'lucide-react'

interface LogEntry {
  timestamp: string
  stream: 'stdout' | 'stderr'
  text: string
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [filterText, setFilterText] = useState('')
  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const [isWrapped, setIsWrapped] = useState(true)
  const [copied, setCopied] = useState(false)

  const terminalRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Establish Server-Sent Events connection
  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const url = `${base}/api/logs/stream`

    function connect() {
      setStatus('connecting')
      const es = new EventSource(url)
      eventSourceRef.current = es

      es.onopen = () => {
        setStatus('connected')
      }

      es.onerror = () => {
        setStatus('disconnected')
        es.close()
        // Retry connection after 5 seconds
        setTimeout(connect, 5000)
      }

      es.onmessage = (event) => {
        try {
          const entry: LogEntry = JSON.parse(event.data)
          setLogs((prev) => {
            // Keep maximum of 2000 lines in UI memory
            const updated = [...prev, entry]
            if (updated.length > 2000) {
              return updated.slice(updated.length - 2000)
            }
            return updated
          })
        } catch (e) {
          // Ignore parse errors from ping events
        }
      }
    }

    connect()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  // Smart Auto-Scroll Behavior
  useEffect(() => {
    if (isAutoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [logs, isAutoScroll])

  const handleScroll = () => {
    if (!terminalRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current
    // User scrolled up: disable auto scroll if they are further than 40px from bottom
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40
    if (isAtBottom && !isAutoScroll) {
      setIsAutoScroll(true)
    } else if (!isAtBottom && isAutoScroll) {
      setIsAutoScroll(false)
    }
  }

  const handleResumeScroll = () => {
    setIsAutoScroll(true)
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }

  // Filter logs based on search text
  const filteredLogs = logs.filter((log) => {
    if (!filterText) return true
    return log.text.toLowerCase().includes(filterText.toLowerCase())
  })

  // Format timestamp (e.g. "19:21:46.321")
  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString)
      const hours = String(d.getHours()).padStart(2, '0')
      const minutes = String(d.getMinutes()).padStart(2, '0')
      const seconds = String(d.getSeconds()).padStart(2, '0')
      const ms = String(d.getMilliseconds()).padStart(3, '0')
      return `${hours}:${minutes}:${seconds}.${ms}`
    } catch {
      return '00:00:00.000'
    }
  }

  // Highlight log lines
  const getLineStyle = (log: LogEntry) => {
    const textLower = log.text.toLowerCase()
    if (log.stream === 'stderr' || textLower.includes('error') || textLower.includes('failed')) {
      return {
        bg: 'bg-rose-950/20 hover:bg-rose-950/30',
        text: 'text-rose-400 font-medium',
        streamTag: 'text-rose-500 bg-rose-500/10 border-rose-500/20'
      }
    }
    if (textLower.includes('warn') || textLower.includes('cooldown')) {
      return {
        bg: 'bg-amber-950/20 hover:bg-amber-950/30',
        text: 'text-amber-400',
        streamTag: 'text-amber-500 bg-amber-500/10 border-amber-500/20'
      }
    }
    if (textLower.includes('success') || textLower.includes('healthy') || textLower.includes('initialized')) {
      return {
        bg: 'hover:bg-zinc-900/40',
        text: 'text-emerald-400',
        streamTag: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
      }
    }
    if (log.text.includes('[Proxy]')) {
      return {
        bg: 'hover:bg-zinc-900/40',
        text: 'text-sky-400',
        streamTag: 'text-sky-500 bg-sky-500/10 border-sky-500/20'
      }
    }
    if (log.text.includes('[Health]')) {
      return {
        bg: 'hover:bg-zinc-900/40',
        text: 'text-indigo-400',
        streamTag: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20'
      }
    }
    return {
      bg: 'hover:bg-zinc-900/40',
      text: 'text-zinc-300',
      streamTag: 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20'
    }
  }

  // Clear current log array
  const handleClear = () => {
    setLogs([])
  }

  // Download raw log text
  const handleDownload = () => {
    const logText = logs
      .map((l) => `[${l.timestamp}] [${l.stream}] ${l.text}`)
      .join('\n')
    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `freellmapi-logs-${new Date().toISOString()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Copy logs to clipboard
  const handleCopy = () => {
    const logText = logs
      .map((l) => `[${l.timestamp}] [${l.stream}] ${l.text}`)
      .join('\n')
    navigator.clipboard.writeText(logText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Tail Logs"
        description="Real-time console logs (stdout/stderr) from the API proxy server. Keep track of model requests, routing decisions, key checks, and startup events."
      />

      <div className="flex flex-col gap-4">
        {/* Control Panel */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-card border border-border p-4 rounded-xl shadow-sm">
          {/* Connection Status and Controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-lg text-xs font-medium">
              <span
                className={`size-2.5 rounded-full ${
                  status === 'connected'
                    ? 'bg-emerald-500 animate-pulse'
                    : status === 'connecting'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-rose-500'
                }`}
              />
              <span className="capitalize text-muted-foreground">
                {status === 'connected' ? 'Streaming' : status === 'connecting' ? 'Connecting' : 'Disconnected'}
              </span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleResumeScroll}
              disabled={isAutoScroll}
              className="text-xs"
            >
              {isAutoScroll ? (
                <>
                  <Play className="size-3.5 mr-1.5 text-emerald-500 fill-emerald-500/20" />
                  Locked Bottom
                </>
              ) : (
                <>
                  <Pause className="size-3.5 mr-1.5 text-amber-500 fill-amber-500/20 animate-pulse" />
                  Resume Scroll
                </>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsWrapped(!isWrapped)}
              title="Toggle text wrapping"
              className="text-xs"
            >
              <WrapText className={`size-3.5 mr-1.5 ${isWrapped ? 'text-foreground' : 'text-muted-foreground'}`} />
              {isWrapped ? 'Wrapped' : 'Unwrapped'}
            </Button>
          </div>

          {/* Search, Download, Copy, Clear */}
          <div className="flex items-center flex-wrap gap-2 w-full sm:w-auto">
            <div className="relative flex-grow sm:flex-grow-0 sm:w-64">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter logs..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="w-full bg-background border border-border text-xs rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring placeholder:text-muted-foreground/60 text-foreground"
              />
            </div>

            <Button variant="outline" size="sm" onClick={handleCopy} title="Copy all logs" disabled={logs.length === 0}>
              {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5 text-muted-foreground" />}
            </Button>

            <Button variant="outline" size="sm" onClick={handleDownload} title="Download raw log file" disabled={logs.length === 0}>
              <Download className="size-3.5 text-muted-foreground" />
            </Button>

            <Button variant="outline" size="sm" onClick={handleClear} title="Clear terminal screen" className="hover:text-rose-500">
              <Trash2 className="size-3.5 text-muted-foreground hover:text-inherit" />
            </Button>
          </div>
        </div>

        {/* Warning banner when scrolling is paused */}
        {!isAutoScroll && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-500 text-xs font-medium animate-fade-in">
            <AlertCircle className="size-4 animate-bounce" />
            <span>Auto-scrolling is paused because you scrolled up. Click "Resume Scroll" to lock back to real-time.</span>
          </div>
        )}

        {/* Terminal Screen */}
        <div className="relative rounded-2xl border border-zinc-800 bg-zinc-950 p-1 shadow-2xl overflow-hidden group">
          {/* Subtle Cyberpunk Header/Glow */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-500/30 to-transparent opacity-60" />

          {/* Code Container */}
          <div
            ref={terminalRef}
            onScroll={handleScroll}
            className="overflow-y-auto max-h-[600px] min-h-[400px] p-6 font-mono text-[12px] leading-relaxed text-zinc-300 select-text flex flex-col gap-1.5 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent"
          >
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-grow py-20 text-zinc-600 gap-3">
                <Terminal className="size-10 text-zinc-800 animate-pulse" />
                <p className="text-sm">
                  {filterText
                    ? 'No matching log entries found.'
                    : 'Terminal quiet. Send requests to the proxy to output live logs...'}
                </p>
              </div>
            ) : (
              filteredLogs.map((log, index) => {
                const style = getLineStyle(log)
                return (
                  <div
                    key={index}
                    className={`flex items-start gap-3 px-2 py-1 rounded transition-colors duration-150 ${style.bg} ${
                      isWrapped ? 'break-all whitespace-pre-wrap' : 'whitespace-pre overflow-x-auto'
                    }`}
                  >
                    {/* Timestamp */}
                    <span className="text-zinc-500 font-medium select-none flex-shrink-0">
                      {formatTime(log.timestamp)}
                    </span>

                    {/* Stream tag */}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 border rounded uppercase font-bold tracking-wider select-none flex-shrink-0 ${style.streamTag}`}
                    >
                      {log.stream}
                    </span>

                    {/* Message content */}
                    <span className={`flex-grow leading-5 ${style.text}`}>{log.text}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Small debug summary */}
        <div className="flex items-center justify-between px-2 text-[10px] text-muted-foreground font-mono">
          <span>Active Session Buffer: {logs.length}/2000 lines</span>
          <span>SSE Protocol Stream v1.0</span>
        </div>
      </div>
    </div>
  )
}
