import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/page-header'
import { processUniversalImage } from '@/lib/image-processor'
import {
  MessageSquare,
  ImageIcon,
  Mic,
  Volume2,
  Paperclip,
  X,
  Download,
  Copy,
  Check,
  Sparkles,
  Play,
  Square,
  Radio,
  Eye,
  Loader2,
  Binary,
  ShieldAlert,
  ShieldCheck,
  Scale,
} from 'lucide-react'

interface FallbackEntry {
  modelDbId: number
  priority: number
  enabled: boolean
  platform: string
  modelId: string
  displayName: string
  sizeLabel: string
  keyCount: number
  modality?: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  imageUrl?: string
  meta?: {
    platform?: string
    model?: string
    latency?: number
    fallbackAttempts?: number
    webSearchExecuted?: boolean
  }
}

interface GeneratedImage {
  id: string
  url?: string
  b64_json?: string
  prompt: string
  platform?: string
  model?: string
  createdAt: number
}

export default function PlaygroundPage() {
  const [activeTab, setActiveTab] = useState<'chat' | 'images' | 'audio' | 'embeddings' | 'moderations'>('chat')

  // ---- CHAT & VISION STATE ----
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem('freellmapi_playground_messages')
    return saved ? JSON.parse(saved) : []
  })
  const [input, setInput] = useState(() => localStorage.getItem('freellmapi_playground_input') || '')
  const [loading, setLoading] = useState(false)
  const [imageProcessing, setImageProcessing] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>(() => localStorage.getItem('freellmapi_playground_model') || 'auto')
  const [numChoices, setNumChoices] = useState<number>(1)
  const [disableFallback, setDisableFallback] = useState(() => localStorage.getItem('freellmapi_playground_disable_fallback') === 'true')
  const [enableWebSearch, setEnableWebSearch] = useState(() => localStorage.getItem('freellmapi_playground_web_search') === 'true')
  const [attachedImage, setAttachedImage] = useState<string | null>(null)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- IMAGE STUDIO STATE ----
  const [imagePrompt, setImagePrompt] = useState('')
  const [imageSize, setImageSize] = useState('1024x1024')
  const [imageModel, setImageModel] = useState('auto')
  const [imageLoading, setImageLoading] = useState(false)
  const [imageRefUrl, setImageRefUrl] = useState<string | null>(null)
  const [imageRefProcessing, setImageRefProcessing] = useState(false)
  const imageRefInputRef = useRef<HTMLInputElement>(null)
  const [gallery, setGallery] = useState<GeneratedImage[]>(() => {
    const saved = localStorage.getItem('freellmapi_image_gallery')
    return saved ? JSON.parse(saved) : []
  })
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null)

  // ---- AUDIO LAB STATE ----
  const [audioMode, setAudioMode] = useState<'tts' | 'stt'>('tts')
  // TTS
  const [ttsInput, setTtsInput] = useState('Welcome to FreeLLMAPI! High quality neural text to speech with free routing.')
  const [ttsVoice, setTtsVoice] = useState('alloy')
  const [ttsFormat, setTtsFormat] = useState('mp3')
  const [ttsLoading, setTtsLoading] = useState(false)
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null)
  // STT
  const [sttFile, setSttFile] = useState<File | null>(null)
  const [sttModel, setSttModel] = useState('whisper-large-v3')
  const [sttTask, setSttTask] = useState<'transcribe' | 'translate'>('transcribe')
  const [sttLoading, setSttLoading] = useState(false)
  const [sttTranscript, setSttTranscript] = useState<string | null>(null)
  const [sttMeta, setSttMeta] = useState<any>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<any>(null)

  // ---- EMBEDDINGS STATE ----
  const [embedText1, setEmbedText1] = useState('Machine learning and artificial intelligence.')
  const [embedText2, setEmbedText2] = useState('Deep neural networks and LLMs.')
  const [embedModel, setEmbedModel] = useState('auto')
  const [embedLoading, setEmbedLoading] = useState(false)
  const [embedResult1, setEmbedResult1] = useState<number[] | null>(null)
  const [embedResult2, setEmbedResult2] = useState<number[] | null>(null)
  const [embedMeta, setEmbedMeta] = useState<any>(null)
  const [similarityScore, setSimilarityScore] = useState<number | null>(null)

  // ---- MODERATION STATE ----
  const [modInput, setModInput] = useState('I love programming, building software, and learning new AI frameworks.')
  const [modLoading, setModLoading] = useState(false)
  const [modResult, setModResult] = useState<any>(null)
  const [modMeta, setModMeta] = useState<any>(null)

  // Persist State
  useEffect(() => {
    localStorage.setItem('freellmapi_playground_messages', JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    localStorage.setItem('freellmapi_playground_input', input)
  }, [input])

  useEffect(() => {
    localStorage.setItem('freellmapi_playground_model', selectedModel)
  }, [selectedModel])

  useEffect(() => {
    localStorage.setItem('freellmapi_playground_disable_fallback', String(disableFallback))
  }, [disableFallback])

  useEffect(() => {
    localStorage.setItem('freellmapi_playground_web_search', String(enableWebSearch))
  }, [enableWebSearch])

  useEffect(() => {
    localStorage.setItem('freellmapi_image_gallery', JSON.stringify(gallery))
  }, [gallery])

  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const { data: fallbackEntries = [] } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })

  const availableModels = fallbackEntries.filter(e => e.keyCount > 0 && e.enabled)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // ---- CHAT HANDLERS ----
  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImageProcessing(true)
    try {
      const result = await processUniversalImage(file)
      setAttachedImage(result.dataUrl)
    } catch (err: any) {
      alert(`Failed to process image format: ${err.message}`)
    } finally {
      setImageProcessing(false)
    }
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          setImageProcessing(true)
          try {
            const result = await processUniversalImage(file)
            setAttachedImage(result.dataUrl)
          } catch (err: any) {
            console.error('[Playground] Failed to process pasted image:', err)
          } finally {
            setImageProcessing(false)
          }
        }
      }
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if ((!text && !attachedImage) || loading || imageProcessing) return

    const userMsg: ChatMessage = {
      role: 'user',
      content: text || (attachedImage ? 'Analyze this image.' : ''),
      imageUrl: attachedImage || undefined,
    }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setAttachedImage(null)

    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
    setLoading(true)
    inputRef.current?.focus()

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`
      if (selectedModel !== 'auto' && disableFallback) headers['X-Disable-Fallback'] = 'true'

      const formattedMessages = newMessages.map(m => {
        if (m.imageUrl) {
          return {
            role: m.role,
            content: [
              { type: 'text', text: m.content },
              { type: 'image_url', image_url: { url: m.imageUrl } },
            ],
          }
        }
        return { role: m.role, content: m.content }
      })

      const body: any = { messages: formattedMessages }
      if (selectedModel !== 'auto') body.model = selectedModel
      if (enableWebSearch) body.web_search = true
      if (numChoices > 1) body.n = numChoices

      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const start = Date.now()
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const latency = Date.now() - start
      const routedVia = res.headers.get('X-Routed-Via')
      const webSearchHeader = res.headers.get('X-Web-Search')
      const fallbackAttempts = res.headers.get('X-Fallback-Attempts')

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        setMessages([...newMessages, {
          role: 'assistant',
          content: `Error: ${err.error?.message ?? 'Unknown error'}`,
        }])
        return
      }

      const data = await res.json()
      const via = data._routed_via ?? (routedVia ? {
        platform: routedVia.split('/')[0],
        model: routedVia.split('/').slice(1).join('/'),
      } : undefined)

      const choices = data.choices || []
      if (choices.length > 1) {
        const choiceMsgs: ChatMessage[] = choices.map((c: any, i: number) => ({
          role: 'assistant',
          content: `**Choice ${i + 1} of ${choices.length}:**\n\n` + (c.message?.content ?? 'No content'),
          meta: {
            platform: via?.platform,
            model: via?.model,
            latency,
            fallbackAttempts: fallbackAttempts ? parseInt(fallbackAttempts) : undefined,
            webSearchExecuted: webSearchHeader === 'executed' || enableWebSearch,
          },
        }))
        setMessages([...newMessages, ...choiceMsgs])
      } else {
        const content = choices[0]?.message?.content ?? (choices[0]?.message?.tool_calls ? '[Tool Call Requested]' : 'No text response returned by model.')
        setMessages([...newMessages, {
          role: 'assistant',
          content,
          meta: {
            platform: via?.platform,
            model: via?.model,
            latency,
            fallbackAttempts: fallbackAttempts ? parseInt(fallbackAttempts) : undefined,
            webSearchExecuted: webSearchHeader === 'executed' || enableWebSearch,
          },
        }])
      }
    } catch (err: any) {
      setMessages([...newMessages, {
        role: 'assistant',
        content: `Error: ${err.message}`,
      }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([])
    setInput('')
    setAttachedImage(null)
    if (inputRef.current) inputRef.current.style.height = 'auto'
    inputRef.current?.focus()
  }

  // ---- IMAGE STUDIO HANDLERS ----
  const handleImageRefChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImageRefProcessing(true)
    try {
      const result = await processUniversalImage(file)
      setImageRefUrl(result.dataUrl)
    } catch (err: any) {
      alert(`Failed to process reference image: ${err.message}`)
    } finally {
      setImageRefProcessing(false)
    }
  }

  const handleGenerateImage = async () => {
    const rawPrompt = imagePrompt.trim()
    if (!rawPrompt || imageLoading) return

    const effectivePrompt = imageRefUrl
      ? `${rawPrompt}, high resolution, intricate details, masterpiece quality`
      : rawPrompt

    setImageLoading(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`

      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const res = await fetch(`${base}/v1/images/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: effectivePrompt,
          model: imageModel === 'auto' ? undefined : imageModel,
          size: imageSize,
          response_format: 'b64_json',
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        alert(`Image generation failed: ${err.error?.message || 'Unknown error'}`)
        return
      }

      const data = await res.json()
      const item = data.data?.[0]
      if (item) {
        const newImg: GeneratedImage = {
          id: `img-${Date.now()}`,
          url: item.url,
          b64_json: item.b64_json,
          prompt: effectivePrompt,
          platform: data._routed_via?.platform,
          model: data._routed_via?.model,
          createdAt: Date.now(),
        }
        setGallery([newImg, ...gallery])
      }
    } catch (e: any) {
      alert(`Error generating image: ${e.message}`)
    } finally {
      setImageLoading(false)
    }
  }

  const copyPrompt = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedPromptId(id)
    setTimeout(() => setCopiedPromptId(null), 1500)
  }

  const downloadImage = (img: GeneratedImage) => {
    const src = img.b64_json ? `data:image/png;base64,${img.b64_json}` : img.url
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    a.download = `freellmapi-${img.id}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // ---- AUDIO TTS HANDLERS ----
  const handleGenerateTTS = async () => {
    const text = ttsInput.trim()
    if (!text || ttsLoading) return

    setTtsLoading(true)
    if (ttsAudioUrl) {
      URL.revokeObjectURL(ttsAudioUrl)
      setTtsAudioUrl(null)
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`

      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const res = await fetch(`${base}/v1/audio/speech`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: ttsVoice,
          response_format: ttsFormat,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        alert(`TTS failed: ${err.error?.message || 'Server error'}`)
        return
      }

      const blob = await res.blob()
      const audioUrl = URL.createObjectURL(blob)
      setTtsAudioUrl(audioUrl)
    } catch (e: any) {
      alert(`TTS Error: ${e.message}`)
    } finally {
      setTtsLoading(false)
    }
  }

  // ---- AUDIO STT HANDLERS ----
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      const recorder = new MediaRecorder(stream)

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/mp3' })
        const file = new File([blob], 'mic-recording.mp3', { type: 'audio/mp3' })
        setSttFile(file)
        stream.getTracks().forEach(t => t.stop())
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setRecordingSeconds(0)

      timerRef.current = setInterval(() => {
        setRecordingSeconds(s => s + 1)
      }, 1000)
    } catch (e: any) {
      alert(`Microphone access error: ${e.message}`)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      clearInterval(timerRef.current)
    }
  }

  const handleTranscribeAudio = async () => {
    if (!sttFile || sttLoading) return

    setSttLoading(true)
    setSttTranscript(null)
    setSttMeta(null)

    try {
      const headers: Record<string, string> = {}
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`

      const formData = new FormData()
      formData.append('file', sttFile)
      formData.append('model', sttModel)

      const endpoint = sttTask === 'translate' ? '/v1/audio/translations' : '/v1/audio/transcriptions'
      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const res = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers,
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        alert(`Transcription failed: ${err.error?.message || 'Server error'}`)
        return
      }

      const data = await res.json()
      setSttTranscript(data.text || '(No text transcribed)')
      setSttMeta(data._routed_via)
    } catch (e: any) {
      alert(`Transcription error: ${e.message}`)
    } finally {
      setSttLoading(false)
    }
  }

  function computeCosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || b.length === 0) return 0
    const len = Math.min(a.length, b.length)
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    if (normA === 0 || normB === 0) return 0
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  const handleGenerateEmbeddings = async () => {
    if (!embedText1.trim()) return
    setEmbedLoading(true)
    setEmbedResult1(null)
    setEmbedResult2(null)
    setSimilarityScore(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`

      const inputs = embedText2.trim() ? [embedText1.trim(), embedText2.trim()] : [embedText1.trim()]
      const res = await apiFetch<any>('/v1/embeddings', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: embedModel,
          input: inputs,
        }),
      })

      const vec1 = res.data?.[0]?.embedding || null
      const vec2 = res.data?.[1]?.embedding || null
      setEmbedResult1(vec1)
      setEmbedResult2(vec2)
      setEmbedMeta(res._routed_via || { platform: 'auto', model: embedModel })

      if (vec1 && vec2) {
        setSimilarityScore(computeCosineSimilarity(vec1, vec2))
      }
    } catch (err: any) {
      alert(`Embedding generation failed: ${err.message}`)
    } finally {
      setEmbedLoading(false)
    }
  }

  const handleRunModeration = async () => {
    if (!modInput.trim()) return
    setModLoading(true)
    setModResult(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`

      const res = await apiFetch<any>('/v1/moderations', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: modInput.trim(),
        }),
      })

      setModResult(res.results?.[0] || null)
      setModMeta(res._routed_via || { platform: 'auto', model: res.model })
    } catch (err: any) {
      alert(`Moderation check failed: ${err.message}`)
    } finally {
      setModLoading(false)
    }
  }

  const renderMessageContent = (content: string) => {
    if (!content) return null
    const imageRegex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+|https?:\/\/[^\s)]+)\)/g
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = imageRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index))
      }
      const alt = match[1] || 'Generated Image'
      const src = match[2]
      parts.push(
        <div key={match.index} className="my-2 relative group inline-block max-w-full">
          <img
            src={src}
            alt={alt}
            className="max-h-72 max-w-full rounded-xl object-contain border shadow-sm cursor-pointer bg-black/5"
            onClick={() => setLightboxImage(src)}
          />
          <div
            onClick={() => setLightboxImage(src)}
            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center text-white text-xs font-medium gap-1 cursor-pointer"
          >
            <Eye className="size-4" /> View Full
          </div>
        </div>
      )
      lastIndex = imageRegex.lastIndex
    }

    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex))
    }

    return parts.length > 0 ? parts : content
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PageHeader
        title="Playground"
        description="Test LLM text chat, multimodal vision, AI image generation, vector embeddings, moderation, and audio."
        actions={
          <div className="flex items-center gap-1.5 p-1 bg-muted/60 border rounded-lg flex-wrap">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'chat'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <MessageSquare className="size-3.5" />
              <span>Chat & Vision</span>
            </button>
            <button
              onClick={() => setActiveTab('images')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'images'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ImageIcon className="size-3.5 text-pink-500" />
              <span>Image Studio</span>
            </button>
            <button
              onClick={() => setActiveTab('audio')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'audio'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Volume2 className="size-3.5 text-blue-500" />
              <span>Audio Lab</span>
            </button>
            <button
              onClick={() => setActiveTab('embeddings')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'embeddings'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Binary className="size-3.5 text-emerald-500" />
              <span>Embeddings</span>
            </button>
            <button
              onClick={() => setActiveTab('moderations')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'moderations'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ShieldAlert className="size-3.5 text-amber-500" />
              <span>Moderation</span>
            </button>
          </div>
        }
      />

      {/* ======================= TAB 1: CHAT & VISION ======================= */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col rounded-lg border bg-card overflow-hidden min-h-0">
          {/* Top Controls Toolbar */}
          <div className="flex items-center justify-between gap-3 p-3 border-b bg-muted/20 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v ?? 'auto')}>
                <SelectTrigger className="w-[240px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (fallback chain)</SelectItem>
                  {availableModels.map(m => (
                    <SelectItem key={m.modelDbId} value={m.modelId}>
                      <span className="flex items-center gap-2">
                        <span>{m.displayName}</span>
                        {m.modality === 'vision' && (
                          <span className="text-[10px] bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded font-mono">
                            Vision
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">({m.platform})</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className={`flex items-center gap-1.5 text-xs cursor-pointer select-none border rounded-md px-2.5 py-1.5 transition-colors h-9 ${
                enableWebSearch ? 'bg-primary/10 border-primary/40 text-primary font-medium' : 'bg-background text-muted-foreground hover:text-foreground'
              }`}>
                <input
                  type="checkbox"
                  checked={enableWebSearch}
                  onChange={(e) => setEnableWebSearch(e.target.checked)}
                  className="rounded border-input bg-background text-primary focus:ring-ring size-3.5 cursor-pointer"
                />
                <span>🌐 Web Search</span>
              </label>

              {selectedModel !== 'auto' && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none border rounded-md px-2.5 py-1.5 bg-background transition-colors h-9">
                  <input
                    type="checkbox"
                    checked={disableFallback}
                    onChange={(e) => setDisableFallback(e.target.checked)}
                    className="rounded border-input bg-background text-primary focus:ring-ring size-3.5 cursor-pointer"
                  />
                  <span>Pin model</span>
                </label>
              )}

              <div className="flex items-center gap-1.5 border rounded-md px-2.5 py-1 bg-background h-9 text-xs">
                <span className="text-muted-foreground font-medium">n:</span>
                <select
                  value={numChoices}
                  onChange={(e) => setNumChoices(Number(e.target.value))}
                  className="bg-transparent text-xs font-mono font-medium focus:outline-none cursor-pointer text-foreground"
                >
                  <option value={1} className="bg-card text-foreground">1 choice</option>
                  <option value={2} className="bg-card text-foreground">2 choices</option>
                  <option value={3} className="bg-card text-foreground">3 choices</option>
                  <option value={4} className="bg-card text-foreground">4 choices</option>
                </select>
              </div>
            </div>

            {messages.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleClear} className="h-8 text-xs">
                Clear chat
              </Button>
            )}
          </div>

          {/* Chat Messages Log */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-center">
                <div className="space-y-3 max-w-md">
                  <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                    <Sparkles className="size-6" />
                  </div>
                  <p className="text-base font-semibold">Multimodal Chat & Vision</p>
                  <p className="text-sm text-muted-foreground">
                    Ask questions, upload or paste images, and test seamless multi-provider fallback.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed space-y-2 ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      {msg.imageUrl && (
                        <div className="relative group cursor-pointer" onClick={() => setLightboxImage(msg.imageUrl!)}>
                          <img
                            src={msg.imageUrl}
                            alt="Attached"
                            className="max-h-56 max-w-full rounded-lg object-contain border border-black/10 bg-black/5"
                          />
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center text-white text-xs font-medium gap-1">
                            <Eye className="size-4" /> View Full
                          </div>
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{renderMessageContent(msg.content)}</div>
                      {msg.meta && (
                        <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px] opacity-70 tabular-nums border-t border-current/10 pt-1.5">
                          {msg.meta.platform && <span className="font-semibold uppercase tracking-wider">{msg.meta.platform}</span>}
                          {msg.meta.model && <span className="font-mono">· {msg.meta.model}</span>}
                          {msg.meta.latency != null && <span>· {msg.meta.latency} ms</span>}
                          {msg.meta.webSearchExecuted && <span className="text-emerald-500 font-medium">· 🌐 Grounded</span>}
                          {msg.meta.fallbackAttempts != null && msg.meta.fallbackAttempts > 0 && (
                            <span>· {msg.meta.fallbackAttempts} fallback{msg.meta.fallbackAttempts > 1 ? 's' : ''}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-2xl px-4 py-3">
                      <div className="flex gap-1.5 items-center">
                        <span className="size-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="size-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="size-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Attached Image Preview */}
          {(attachedImage || imageProcessing) && (
            <div className="px-4 py-2 border-t bg-muted/40 flex items-center gap-3">
              {imageProcessing ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  <span>Processing & converting image format (HEIC/RAW/TIFF)…</span>
                </div>
              ) : attachedImage ? (
                <>
                  <div className="relative size-14 rounded-lg overflow-hidden border bg-background shrink-0">
                    <img src={attachedImage} alt="Attachment" className="size-full object-cover" />
                    <button
                      onClick={() => setAttachedImage(null)}
                      className="absolute top-0.5 right-0.5 p-0.5 bg-black/70 hover:bg-black text-white rounded-full"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    Image attached & normalized. Ready to send with vision model.
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* Input Area */}
          <div className="border-t bg-background p-3">
            <div className="flex gap-2 items-end">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.heic,.heif,.tiff,.tif,.bmp,.webp,.avif,.png,.jpg,.jpeg,.svg,.gif,.ico"
                className="hidden"
                onChange={handleImageFileChange}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                title="Attach Image (or paste Ctrl+V)"
                className="size-10 shrink-0"
              >
                <Paperclip className="size-4 text-muted-foreground" />
              </Button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Type a message or paste an image… (⏎ to send, ⇧⏎ for newline)"
                rows={1}
                className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[40px] max-h-[160px]"
                style={{ height: 'auto', overflow: 'hidden' }}
                onInput={e => {
                  const el = e.target as HTMLTextAreaElement
                  el.style.height = 'auto'
                  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
                }}
              />
              <Button onClick={handleSend} disabled={loading || (!input.trim() && !attachedImage)} className="h-10">
                {loading ? <Loader2 className="size-4 animate-spin" /> : 'Send'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ======================= TAB 2: IMAGE STUDIO ======================= */}
      {activeTab === 'images' && (
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto pb-6">
          {/* Image Generation Config Card */}
          <div className="p-5 rounded-xl border bg-card space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="size-4 text-pink-500" />
                  AI Image Generation Studio
                </h3>
                <p className="text-xs text-muted-foreground">
                  Generate images with Flux, SDXL, and Imagen 3 with instant multi-provider fallback.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="Describe the image you want to generate in detail…"
                rows={2}
                className="flex-1 resize-none rounded-md border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
              />
            </div>

            {/* Reference Image Attachment (for Image-to-Image / Style Transfer) */}
            <div className="flex items-center gap-3">
              <input
                ref={imageRefInputRef}
                type="file"
                accept="image/*,.heic,.heif,.tiff,.bmp,.webp,.avif,.png,.jpg,.jpeg"
                className="hidden"
                onChange={handleImageRefChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => imageRefInputRef.current?.click()}
                className="text-xs h-8 gap-1.5"
              >
                <Paperclip className="size-3.5 text-muted-foreground" />
                <span>{imageRefUrl ? 'Change Reference Image' : 'Attach Reference Image (Style Transfer)'}</span>
              </Button>

              {imageRefProcessing && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin text-pink-500" />
                  <span>Processing reference image…</span>
                </div>
              )}

              {imageRefUrl && !imageRefProcessing && (
                <div className="flex items-center gap-2 bg-muted/50 border rounded-lg px-2 py-1">
                  <img src={imageRefUrl} alt="Ref" className="size-6 rounded object-cover border" />
                  <span className="text-[11px] text-muted-foreground">Reference attached</span>
                  <button
                    onClick={() => setImageRefUrl(null)}
                    className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Quick Style Presets */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <span>Style Presets:</span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {[
                  { label: 'Studio Ghibli 🍃', prompt: 'in authentic Studio Ghibli hand-drawn anime aesthetic, lush watercolor colors, Hayao Miyazaki masterpiece' },
                  { label: 'Anime / Manga 🌸', prompt: 'in vibrant Japanese anime art style, crisp lineart, cel shaded, Makoto Shinkai lighting' },
                  { label: 'Cyberpunk 🌆', prompt: 'in futuristic cyberpunk style, glowing neon lights, holographic reflections, moody atmosphere' },
                  { label: 'Pixar 3D 🧸', prompt: 'in Disney Pixar 3D animation style, adorable character, volumetric studio lighting, 8k render' },
                  { label: 'Watercolor 🎨', prompt: 'in delicate watercolor wash painting on textured cold-press paper, fluid soft pastel tones' },
                  { label: 'Oil Painting 🖼️', prompt: 'in classic textured oil painting on canvas, visible rich impasto brushstrokes, dramatic chiaroscuro' },
                  { label: '8k Photoreal 📸', prompt: 'award-winning 8k photorealistic portrait, 85mm f/1.4 lens bokeh, natural soft studio lighting' },
                  { label: 'Vintage Comic 💥', prompt: 'in vintage Marvel/DC comic book illustration, dynamic ink outlines, retro halftones' },
                ].map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setImagePrompt(prev => {
                        const clean = prev.replace(/in\s+[a-zA-Z\s]+style.*$/i, '').trim();
                        return clean ? `${clean}, ${s.prompt}` : s.prompt;
                      });
                    }}
                    className="shrink-0 px-2.5 py-1 rounded-md border bg-muted/40 hover:bg-muted text-foreground text-[11px] transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 pt-2 border-t flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                {/* Model Selector */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Model:</span>
                  <Select value={imageModel} onValueChange={(v) => setImageModel(v ?? 'auto')}>
                    <SelectTrigger className="w-[200px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (Smart Fallback)</SelectItem>
                      <SelectItem value="flux">Pollinations Flux (Free / Unlimited)</SelectItem>
                      <SelectItem value="@cf/black-forest-labs/flux-1-schnell">Cloudflare Flux 1 Schnell</SelectItem>
                      <SelectItem value="@cf/stabilityai/stable-diffusion-xl-base-1.0">Cloudflare SDXL Base</SelectItem>
                      <SelectItem value="imagen-3.0-generate-002">Google Imagen 3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Aspect Ratio / Size */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Size:</span>
                  <Select value={imageSize} onValueChange={(v) => setImageSize(v ?? '1024x1024')}>
                    <SelectTrigger className="w-[160px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1024x1024">1:1 (1024x1024)</SelectItem>
                      <SelectItem value="1792x1024">16:9 (1792x1024)</SelectItem>
                      <SelectItem value="1024x1792">9:16 (1024x1792)</SelectItem>
                      <SelectItem value="1024x768">4:3 (1024x768)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={handleGenerateImage}
                disabled={imageLoading || !imagePrompt.trim()}
                className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white shadow-sm h-9 px-5"
              >
                {imageLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4 mr-2" />
                    Generate Image
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Generated Gallery Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Generated Gallery ({gallery.length})
              </h4>
              {gallery.length > 0 && (
                <button
                  onClick={() => setGallery([])}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  Clear Gallery
                </button>
              )}
            </div>

            {gallery.length === 0 ? (
              <div className="p-12 text-center border rounded-xl bg-card/50 border-dashed space-y-2">
                <ImageIcon className="size-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-medium">No images generated yet</p>
                <p className="text-xs text-muted-foreground">
                  Type a prompt above and click Generate to see images appear here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {gallery.map((img) => {
                  const src = img.b64_json ? `data:image/png;base64,${img.b64_json}` : img.url
                  return (
                    <div
                      key={img.id}
                      className="group relative rounded-xl border bg-card overflow-hidden shadow-sm flex flex-col"
                    >
                      <div className="relative aspect-square bg-muted/40 overflow-hidden cursor-pointer" onClick={() => setLightboxImage(src!)}>
                        <img
                          src={src}
                          alt={img.prompt}
                          className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setLightboxImage(src!); }}
                            className="p-2 rounded-full bg-white/20 hover:bg-white/40 text-white backdrop-blur-sm"
                            title="Full View"
                          >
                            <Eye className="size-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); downloadImage(img); }}
                            className="p-2 rounded-full bg-white/20 hover:bg-white/40 text-white backdrop-blur-sm"
                            title="Download PNG"
                          >
                            <Download className="size-4" />
                          </button>
                        </div>
                      </div>
                      <div className="p-3 space-y-2 flex-1 flex flex-col justify-between text-xs">
                        <p className="line-clamp-2 text-foreground font-medium" title={img.prompt}>
                          {img.prompt}
                        </p>
                        <div className="flex items-center justify-between pt-2 border-t border-muted text-[11px] text-muted-foreground">
                          <span className="font-mono">
                            {img.platform ? `${img.platform}/${img.model}` : 'Generated'}
                          </span>
                          <button
                            onClick={() => copyPrompt(img.id, img.prompt)}
                            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                          >
                            {copiedPromptId === img.id ? (
                              <>
                                <Check className="size-3 text-emerald-500" />
                                <span className="text-emerald-500">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="size-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================= TAB 3: AUDIO LAB ======================= */}
      {activeTab === 'audio' && (
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto pb-6">
          {/* Sub-tab switcher */}
          <div className="flex items-center gap-2 border-b pb-2">
            <button
              onClick={() => setAudioMode('tts')}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                audioMode === 'tts'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              🗣️ Text-to-Speech (TTS)
            </button>
            <button
              onClick={() => setAudioMode('stt')}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                audioMode === 'stt'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              🎧 Speech-to-Text (STT)
            </button>
          </div>

          {/* TTS Panel */}
          {audioMode === 'tts' && (
            <div className="p-5 rounded-xl border bg-card space-y-4 shadow-sm">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Volume2 className="size-4 text-blue-500" />
                  Neural Speech Synthesis (Text-to-Speech)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Transform written text into natural human speech streaming in realtime.
                </p>
              </div>

              <textarea
                value={ttsInput}
                onChange={(e) => setTtsInput(e.target.value)}
                placeholder="Enter text to synthesize into spoken audio…"
                rows={3}
                className="w-full resize-none rounded-md border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
              />

              <div className="flex items-center justify-between gap-4 pt-2 border-t flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Voice:</span>
                    <Select value={ttsVoice} onValueChange={(v) => setTtsVoice(v ?? 'alloy')}>
                      <SelectTrigger className="w-[150px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alloy">Alloy (Neutral)</SelectItem>
                        <SelectItem value="echo">Echo (Male)</SelectItem>
                        <SelectItem value="fable">Fable (British)</SelectItem>
                        <SelectItem value="onyx">Onyx (Deep Male)</SelectItem>
                        <SelectItem value="nova">Nova (Warm Female)</SelectItem>
                        <SelectItem value="shimmer">Shimmer (Expressive)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Format:</span>
                    <Select value={ttsFormat} onValueChange={(v) => setTtsFormat(v ?? 'mp3')}>
                      <SelectTrigger className="w-[110px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mp3">MP3</SelectItem>
                        <SelectItem value="wav">WAV</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  onClick={handleGenerateTTS}
                  disabled={ttsLoading || !ttsInput.trim()}
                  className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-sm h-9 px-5"
                >
                  {ttsLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" />
                      Synthesizing…
                    </>
                  ) : (
                    <>
                      <Play className="size-4 mr-2" />
                      Generate Speech
                    </>
                  )}
                </Button>
              </div>

              {/* Audio Player Output */}
              {ttsAudioUrl && (
                <div className="p-4 rounded-lg border bg-muted/30 flex items-center justify-between gap-4 mt-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="size-10 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0">
                      <Volume2 className="size-5" />
                    </div>
                    <audio controls src={ttsAudioUrl} className="w-full max-w-md h-10" />
                  </div>
                  <a
                    href={ttsAudioUrl}
                    download={`speech-${Date.now()}.${ttsFormat}`}
                    className="flex items-center gap-1.5 text-xs border rounded-md px-3 py-2 bg-background hover:bg-muted transition-colors font-medium shrink-0"
                  >
                    <Download className="size-3.5" />
                    <span>Download</span>
                  </a>
                </div>
              )}
            </div>
          )}

          {/* STT Panel */}
          {audioMode === 'stt' && (
            <div className="p-5 rounded-xl border bg-card space-y-4 shadow-sm">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Mic className="size-4 text-emerald-500" />
                  Whisper Audio Transcription & Translation (Speech-to-Text)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Record microphone audio or upload sound files to transcribe or translate into English.
                </p>
              </div>

              {/* Recording and Upload Box */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Live Mic Recorder */}
                <div className="p-4 rounded-lg border border-dashed flex flex-col items-center justify-center gap-3 text-center bg-muted/10">
                  <div className={`size-14 rounded-full flex items-center justify-center transition-all ${
                    isRecording ? 'bg-rose-500/20 text-rose-600 animate-pulse' : 'bg-primary/10 text-primary'
                  }`}>
                    {isRecording ? <Radio className="size-6 text-rose-600" /> : <Mic className="size-6" />}
                  </div>
                  <div>
                    <p className="text-xs font-semibold">
                      {isRecording ? `Recording… (${recordingSeconds}s)` : 'Live Microphone'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {isRecording ? 'Click stop to finish audio capture' : 'Record voice note directly in browser'}
                    </p>
                  </div>
                  <Button
                    variant={isRecording ? 'destructive' : 'outline'}
                    size="sm"
                    onClick={isRecording ? stopRecording : startRecording}
                    className="h-8 text-xs"
                  >
                    {isRecording ? (
                      <>
                        <Square className="size-3.5 mr-1.5 fill-current" />
                        Stop Recording
                      </>
                    ) : (
                      <>
                        <Mic className="size-3.5 mr-1.5" />
                        Start Recording
                      </>
                    )}
                  </Button>
                </div>

                {/* File Upload Dropzone */}
                <div className="p-4 rounded-lg border border-dashed flex flex-col items-center justify-center gap-2 text-center bg-muted/10">
                  <input
                    type="file"
                    id="audio-upload"
                    accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) setSttFile(file)
                    }}
                  />
                  <label
                    htmlFor="audio-upload"
                    className="cursor-pointer size-full flex flex-col items-center justify-center gap-2"
                  >
                    <div className="size-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                      <Paperclip className="size-5" />
                    </div>
                    <p className="text-xs font-medium">
                      {sttFile ? sttFile.name : 'Choose audio file (.mp3, .wav, .m4a)'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {sttFile ? `${(sttFile.size / 1024 / 1024).toFixed(2)} MB` : 'Click to select from disk'}
                    </p>
                  </label>
                  {sttFile && (
                    <Button variant="ghost" size="sm" onClick={() => setSttFile(null)} className="h-6 text-[11px] text-destructive">
                      Remove file
                    </Button>
                  )}
                </div>
              </div>

              {/* STT Controls */}
              <div className="flex items-center justify-between gap-4 pt-2 border-t flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Model:</span>
                    <Select value={sttModel} onValueChange={(v) => setSttModel(v ?? 'whisper-large-v3')}>
                      <SelectTrigger className="w-[180px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="whisper-large-v3">Whisper Large v3 (Groq)</SelectItem>
                        <SelectItem value="whisper-large-v3-turbo">Whisper v3 Turbo (Fast)</SelectItem>
                        <SelectItem value="@cf/openai/whisper">Cloudflare Whisper</SelectItem>
                        <SelectItem value="gemini-2.5-flash">Gemini 2.5 Audio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Task:</span>
                    <Select value={sttTask} onValueChange={(v) => setSttTask((v as any) ?? 'transcribe')}>
                      <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="transcribe">Transcribe</SelectItem>
                        <SelectItem value="translate">Translate to EN</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  onClick={handleTranscribeAudio}
                  disabled={sttLoading || !sttFile}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm h-9 px-5"
                >
                  {sttLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" />
                      Transcribing…
                    </>
                  ) : (
                    <>
                      <Mic className="size-4 mr-2" />
                      Transcribe Audio
                    </>
                  )}
                </Button>
              </div>

              {/* Transcript Result */}
              {sttTranscript && (
                <div className="p-4 rounded-lg border bg-background space-y-2 mt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Transcription Result
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(sttTranscript)
                        alert('Transcript copied to clipboard!')
                      }}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="size-3.5" />
                      <span>Copy Text</span>
                    </button>
                  </div>
                  <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                    {sttTranscript}
                  </p>
                  {sttMeta && (
                    <p className="text-[11px] font-mono text-muted-foreground pt-2 border-t">
                      Routed via: {sttMeta.platform}/{sttMeta.model}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ======================= TAB 4: EMBEDDINGS LAB ======================= */}
      {activeTab === 'embeddings' && (
        <div className="flex-1 flex flex-col rounded-lg border bg-card overflow-hidden min-h-0 p-6 space-y-6 overflow-y-auto">
          <div className="flex items-center justify-between border-b pb-4 flex-wrap gap-3">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Binary className="size-4 text-emerald-500" />
                Vector Embeddings & Semantic Similarity
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Generate high-dimensional text embeddings across Google Gemini, Mistral Embed, Cohere Embed, and Cloudflare BAAI BGE.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Model:</span>
              <Select value={embedModel} onValueChange={(v) => setEmbedModel(v ?? 'auto')}>
                <SelectTrigger className="w-[240px] h-8 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto (Smart Failover Router)</SelectItem>
                  <SelectItem value="gemini-embedding-001">gemini-embedding-001 (Google)</SelectItem>
                  <SelectItem value="text-embedding-004">text-embedding-004 (Google Legacy)</SelectItem>
                  <SelectItem value="mistral-embed">mistral-embed (Mistral)</SelectItem>
                  <SelectItem value="embed-english-v3.0">embed-english-v3.0 (Cohere)</SelectItem>
                  <SelectItem value="embed-multilingual-v3.0">embed-multilingual-v3.0 (Cohere)</SelectItem>
                  <SelectItem value="@cf/baai/bge-base-en-v1.5">bge-base-en-v1.5 (Cloudflare)</SelectItem>
                  <SelectItem value="@cf/baai/bge-large-en-v1.5">bge-large-en-v1.5 (Cloudflare)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Text Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground">Text Input 1</Label>
              <textarea
                value={embedText1}
                onChange={(e) => setEmbedText1(e.target.value)}
                placeholder="Enter first text string..."
                rows={4}
                className="w-full text-xs font-mono p-3 rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground">Text Input 2 (Optional - for Cosine Similarity comparison)</Label>
              <textarea
                value={embedText2}
                onChange={(e) => setEmbedText2(e.target.value)}
                placeholder="Enter second text string to compute semantic similarity..."
                rows={4}
                className="w-full text-xs font-mono p-3 rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Button
              onClick={handleGenerateEmbeddings}
              disabled={embedLoading || !embedText1.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm h-9 px-5 gap-2"
            >
              {embedLoading ? <Loader2 className="size-4 animate-spin" /> : <Binary className="size-4" />}
              {embedLoading ? 'Generating Vectors…' : 'Generate Vector Embeddings'}
            </Button>
            {embedMeta && (
              <span className="text-[11px] font-mono text-muted-foreground">
                Routed via: {embedMeta.platform}/{embedMeta.model}
              </span>
            )}
          </div>

          {/* Similarity Score Card */}
          {similarityScore !== null && (
            <div className="p-4 rounded-lg border bg-emerald-500/5 border-emerald-500/20 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <Scale className="size-3.5" /> Cosine Semantic Similarity
                </span>
                <p className="text-[11px] text-muted-foreground">
                  Computed between Vector 1 and Vector 2 (1.00 = identical meaning, 0.00 = orthogonal).
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  {(similarityScore * 100).toFixed(2)}%
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">score: {similarityScore.toFixed(4)}</span>
              </div>
            </div>
          )}

          {/* Embedding Vectors Preview */}
          {embedResult1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border bg-background/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold font-mono text-muted-foreground">
                    Vector 1 ({embedResult1.length} dimensions)
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(embedResult1))
                      alert('Vector copied!')
                    }}
                    className="gap-1 text-xs"
                  >
                    <Copy className="size-3" /> Copy JSON
                  </Button>
                </div>
                <pre className="text-[11px] font-mono bg-muted/40 p-3 rounded-md overflow-x-auto max-h-40 text-muted-foreground">
                  [{embedResult1.slice(0, 10).map(n => n.toFixed(6)).join(', ')}, … {embedResult1.length - 10} more]
                </pre>
              </div>

              {embedResult2 && (
                <div className="p-4 rounded-lg border bg-background/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold font-mono text-muted-foreground">
                      Vector 2 ({embedResult2.length} dimensions)
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(embedResult2))
                        alert('Vector copied!')
                      }}
                      className="gap-1 text-xs"
                    >
                      <Copy className="size-3" /> Copy JSON
                    </Button>
                  </div>
                  <pre className="text-[11px] font-mono bg-muted/40 p-3 rounded-md overflow-x-auto max-h-40 text-muted-foreground">
                    [{embedResult2.slice(0, 10).map(n => n.toFixed(6)).join(', ')}, … {embedResult2.length - 10} more]
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ======================= TAB 5: MODERATION INSPECTOR ======================= */}
      {activeTab === 'moderations' && (
        <div className="flex-1 flex flex-col rounded-lg border bg-card overflow-hidden min-h-0 p-6 space-y-6 overflow-y-auto">
          <div className="flex items-center justify-between border-b pb-4 flex-wrap gap-3">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <ShieldAlert className="size-4 text-amber-500" />
                Content Moderation & Safety Guardrails
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Evaluates prompt text against OpenAI content safety categories (harassment, hate, self-harm, sexual, violence) using multi-provider models.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-foreground">Text to Inspect</Label>
            <textarea
              value={modInput}
              onChange={(e) => setModInput(e.target.value)}
              placeholder="Enter text to analyze for safety..."
              rows={4}
              className="w-full text-xs font-mono p-3 rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <Button
              onClick={handleRunModeration}
              disabled={modLoading || !modInput.trim()}
              className="bg-amber-600 hover:bg-amber-700 text-white shadow-sm h-9 px-5 gap-2"
            >
              {modLoading ? <Loader2 className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />}
              {modLoading ? 'Analyzing Content…' : 'Run Safety Moderation Check'}
            </Button>
            {modMeta && (
              <span className="text-[11px] font-mono text-muted-foreground">
                Evaluated via: {modMeta.platform}/{modMeta.model}
              </span>
            )}
          </div>

          {/* Moderation Results */}
          {modResult && (
            <div className="space-y-4">
              <div className={`p-4 rounded-lg border flex items-center justify-between ${modResult.flagged ? 'bg-rose-500/10 border-rose-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                <div className="flex items-center gap-2">
                  {modResult.flagged ? (
                    <ShieldAlert className="size-5 text-rose-500" />
                  ) : (
                    <ShieldCheck className="size-5 text-emerald-500" />
                  )}
                  <div>
                    <h3 className={`text-sm font-bold ${modResult.flagged ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {modResult.flagged ? 'FLAGGED AS UNSAFE' : 'PASSED CONTENT SAFETY CHECK'}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {modResult.flagged ? 'This text violates content safety guidelines in one or more categories.' : 'No harmful or restricted content detected.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Category Scores Breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(modResult.category_scores || {}).map(([cat, score]) => {
                  const numScore = typeof score === 'number' ? score : 0
                  const isCatFlagged = Boolean(modResult.categories?.[cat])
                  return (
                    <div key={cat} className={`p-3 rounded-lg border bg-background/50 space-y-1.5 ${isCatFlagged ? 'border-rose-500/40 bg-rose-500/5' : ''}`}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-medium text-foreground capitalize">{cat}</span>
                        <span className={`font-mono text-[11px] ${isCatFlagged ? 'text-rose-500 font-bold' : 'text-muted-foreground'}`}>
                          {(numScore * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${isCatFlagged ? 'bg-rose-500' : numScore > 0.3 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.max(4, numScore * 100)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <img src={lightboxImage} alt="Full view" className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl" />
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white"
            >
              <X className="size-6" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
