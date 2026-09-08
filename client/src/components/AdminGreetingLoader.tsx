import { useRef, useState, useEffect } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { ShieldCheck, Terminal, Cpu, KeyRound } from 'lucide-react'

gsap.registerPlugin(useGSAP)

interface AdminGreetingLoaderProps {
  email?: string
  onComplete: () => void
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'Good morning, Administrator'
  if (hour >= 12 && hour < 17) return 'Good afternoon, Administrator'
  if (hour >= 17 && hour < 22) return 'Good evening, Administrator'
  return 'Welcome back, Administrator'
}

export default function AdminGreetingLoader({ email, onComplete }: AdminGreetingLoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const ring2Ref = useRef<HTMLDivElement>(null)
  const greetingRef = useRef<HTMLHeadingElement>(null)
  const emailBadgeRef = useRef<HTMLDivElement>(null)
  const telemetryRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef<HTMLSpanElement>(null)
  const statusLabelRef = useRef<HTMLSpanElement>(null)

  const [greetingText] = useState(getGreeting)
  const [displayEmail] = useState(() => email?.trim() || 'admin@freellmapi.local')

  useGSAP(
    () => {
      const tl = gsap.timeline({
        defaults: { ease: 'power2.out' },
      })

      // 1. Initial setup
      gsap.set(backdropRef.current, { opacity: 0 })
      gsap.set(cardRef.current, { opacity: 0, scale: 0.92, y: 24 })
      gsap.set(badgeRef.current, { scale: 0, rotation: -40 })
      gsap.set(greetingRef.current, { opacity: 0, y: 16 })
      gsap.set(emailBadgeRef.current, { opacity: 0, y: 12 })
      gsap.set(progressBarRef.current, { width: '0%' })

      // Ambient radar pulsing loop
      gsap.to(ringRef.current, {
        scale: 1.75,
        opacity: 0,
        duration: 1.4,
        repeat: -1,
        ease: 'power1.out',
      })
      gsap.to(ring2Ref.current, {
        rotation: 360,
        duration: 8,
        repeat: -1,
        ease: 'none',
      })

      // 2. Entrance sequence
      tl.to(backdropRef.current, {
        opacity: 1,
        duration: 0.3,
        ease: 'power1.out',
      })
      tl.to(
        cardRef.current,
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.55,
          ease: 'back.out(1.4)',
        },
        '-=0.15'
      )

      // 3. Shield Badge pop
      tl.to(
        badgeRef.current,
        {
          scale: 1,
          rotation: 0,
          duration: 0.6,
          ease: 'back.out(2)',
        },
        '-=0.3'
      )

      // 4. Greeting & User identity
      tl.to(
        greetingRef.current,
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
        },
        '-=0.25'
      )
      tl.to(
        emailBadgeRef.current,
        {
          opacity: 1,
          y: 0,
          duration: 0.35,
        },
        '-=0.2'
      )

      // 5. Sequential Telemetry Stagger
      if (telemetryRef.current?.children) {
        const items = Array.from(telemetryRef.current.children)
        gsap.set(items, { opacity: 0, x: -14 })
        tl.to(
          items,
          {
            opacity: 1,
            x: 0,
            stagger: 0.18,
            duration: 0.35,
            ease: 'power2.out',
          },
          '-=0.1'
        )
      }

      // 6. Charging Progress Bar & Counter (0% -> 100%)
      const counter = { val: 0 }
      tl.to(
        progressBarRef.current,
        {
          width: '100%',
          duration: 1.15,
          ease: 'power2.inOut',
        },
        '-=0.35'
      )
      tl.to(
        counter,
        {
          val: 100,
          duration: 1.15,
          ease: 'power2.inOut',
          onUpdate: () => {
            if (counterRef.current) {
              counterRef.current.textContent = `${Math.round(counter.val)}%`
            }
          },
        },
        '<'
      )

      // 7. Access Granted state change
      tl.call(() => {
        if (statusLabelRef.current) {
          statusLabelRef.current.textContent = 'ACCESS GRANTED • ROOT'
          statusLabelRef.current.classList.add('text-emerald-400')
        }
      })
      tl.to(
        badgeRef.current,
        {
          scale: 1.12,
          duration: 0.15,
          yoyo: true,
          repeat: 1,
          ease: 'power1.inOut',
        },
        '+=0.05'
      )

      // 8. Smooth Outro Transition
      tl.to(
        cardRef.current,
        {
          opacity: 0,
          scale: 1.05,
          filter: 'blur(8px)',
          duration: 0.45,
          ease: 'power2.in',
        },
        '+=0.25'
      )
      tl.to(
        backdropRef.current,
        {
          opacity: 0,
          duration: 0.35,
          ease: 'power2.in',
          onComplete,
        },
        '-=0.15'
      )
    },
    { scope: containerRef }
  )

  // Keyboard shortcut to skip
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        onComplete()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onComplete])

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none cursor-pointer"
      onClick={onComplete}
      title="Click anywhere to skip"
    >
      {/* Backdrop with high-tech radial mesh */}
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-background/90 backdrop-blur-2xl transition-colors"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(16,185,129,0.18),rgba(255,255,255,0))]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_50%_120%,rgba(6,182,212,0.12),rgba(255,255,255,0))]" />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
          style={{
            backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
            backgroundSize: '32px 32px',
          }}
        />
      </div>

      {/* Main Console Card */}
      <div
        ref={cardRef}
        className="relative w-full max-w-md rounded-2xl border border-border/80 bg-card/95 p-7 shadow-2xl backdrop-blur-md overflow-hidden text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top luminous highlight */}
        <div className="absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent" />

        {/* Shield & Radar scanner */}
        <div className="relative mx-auto size-20 mb-5 flex items-center justify-center">
          {/* Radar pulse ring */}
          <div
            ref={ringRef}
            className="absolute inset-0 rounded-full border-2 border-emerald-500/40 pointer-events-none"
          />
          {/* Rotating dashed ring */}
          <div
            ref={ring2Ref}
            className="absolute -inset-1 rounded-full border border-dashed border-emerald-500/30 pointer-events-none"
          />
          {/* Shield Badge */}
          <div
            ref={badgeRef}
            className="size-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-primary/20 border border-emerald-500/40 flex items-center justify-center shadow-[0_0_24px_rgba(16,185,129,0.25)]"
          >
            <ShieldCheck className="size-8 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
          </div>
        </div>

        {/* Greetings Typography */}
        <h2
          ref={greetingRef}
          className="text-xl font-bold tracking-tight text-foreground sm:text-2xl"
        >
          {greetingText}
        </h2>

        {/* Admin Email / Identity Badge */}
        <div ref={emailBadgeRef} className="mt-2 flex items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-3 py-0.5 text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400 shadow-xs">
            <KeyRound className="size-3" />
            {displayEmail}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
            Root Admin
          </span>
        </div>

        {/* Telemetry initialization terminal */}
        <div
          ref={telemetryRef}
          className="mt-6 rounded-xl border border-border/70 bg-background/60 p-3.5 text-left text-xs font-mono text-muted-foreground space-y-2 shadow-inner"
        >
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-emerald-500 shrink-0 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
            <span className="text-foreground/90 font-medium">AUTH:</span>
            <span className="truncate">Cryptographic session verified</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-teal-400 shrink-0 shadow-[0_0_6px_rgba(45,212,191,0.8)]" />
            <span className="text-foreground/90 font-medium">MATRIX:</span>
            <span className="truncate">12 Upstream AI providers online</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-cyan-400 shrink-0 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
            <span className="text-foreground/90 font-medium">STORAGE:</span>
            <span className="truncate">AES-256 encrypted SQLite vault ready</span>
          </div>
        </div>

        {/* Progress bar track */}
        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
            <span ref={statusLabelRef} className="flex items-center gap-1.5 font-medium transition-colors">
              <Cpu className="size-3.5 animate-pulse text-emerald-400" />
              INITIALIZING DASHBOARD...
            </span>
            <span ref={counterRef} className="font-bold tabular-nums text-foreground">
              0%
            </span>
          </div>

          <div className="h-1.5 w-full rounded-full bg-muted/80 overflow-hidden border border-border/40 p-[1px]">
            <div
              ref={progressBarRef}
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]"
            />
          </div>
        </div>

        <p className="mt-4 text-[11px] text-muted-foreground/60 flex items-center justify-center gap-1">
          <Terminal className="size-3" />
          Press <kbd className="font-mono bg-muted/60 px-1 rounded text-[10px]">Esc</kbd> or click to skip
        </p>
      </div>
    </div>
  )
}
