'use client'

import { useEffect, useRef, useCallback } from 'react'
import { IndicatorSettings } from '@/lib/types'

interface Props {
  open: boolean
  settings: IndicatorSettings
  onChange: (settings: IndicatorSettings) => void
  onClose: () => void
}

export default function IndicatorPanel({ open, settings, onChange, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  // Lock body scroll when open on mobile
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Focus trap + Escape key
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return

    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      if (focusable.length === 0) return

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    panel.addEventListener('keydown', handleKeyDown)
    first?.focus()

    return () => panel.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const update = (key: keyof IndicatorSettings, value: unknown) => {
    onChange({ ...settings, [key]: value })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        ref={backdropRef}
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        } hidden sm:block`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet — mobile: bottom sheet, desktop: right side panel */}
      <div
        ref={panelRef}
        className={`
          fixed sm:fixed z-50 flex flex-col
          transform transition-transform duration-300 ease-spring
          ${open ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-x-full'}
          sm:top-0 sm:right-0 sm:h-full
          bottom-0 left-0 right-0 sm:left-auto
          w-full sm:w-[340px]
          bg-[#0a0a0f]/96 backdrop-blur-2xl
          border-t sm:border-t-0 sm:border-l
          border-white/10
          shadow-[0_-8px_32px_rgba(0,0,0,0.5)] sm:shadow-[-8px_0_32px_rgba(0,0,0,0.5)]
          rounded-t-3xl sm:rounded-none
        `}
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)',
          maxHeight: open ? '90vh' : undefined,
        }}
        role="dialog"
        aria-modal={open}
        aria-label="Indicator settings"
        aria-hidden={!open}
      >
        {/* Handle */}
        <div className="sm:hidden sheet-handle">
          <div className="sheet-handle-bar" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between shrink-0 px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
            </svg>
            <span className="text-sm font-semibold text-white">Indicator Settings</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-chart-muted hover:text-white transition-colors cursor-pointer focus-visible:outline-none"
            aria-label="Close indicator settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto momentum-scroll hide-scrollbar px-5 py-5 pb-8 space-y-7">
          <SettingsSection title="EMA Indicators">
            <Toggle
              label="Show Fast EMA"
              description={`Period ${settings.emaFastLen}`}
              checked={settings.showFastEMA}
              onChange={(v) => update('showFastEMA', v)}
            />
            <Toggle
              label="Show Slow EMA"
              description={`Period ${settings.emaSlowLen}`}
              checked={settings.showSlowEMA}
              onChange={(v) => update('showSlowEMA', v)}
            />
            <StepperInput
              label="Fast Period"
              value={settings.emaFastLen}
              min={2}
              max={100}
              onChange={(v) => update('emaFastLen', v)}
            />
            <StepperInput
              label="Slow Period"
              value={settings.emaSlowLen}
              min={2}
              max={200}
              onChange={(v) => update('emaSlowLen', v)}
            />
          </SettingsSection>

          <SettingsSection title="Risk Management">
            <StepperInput
              label="ATR Period"
              value={settings.atrLen}
              min={1}
              max={100}
              onChange={(v) => update('atrLen', v)}
            />
            <StepperInput
              label="SL Multiplier"
              value={settings.atrMultSL}
              min={0.1}
              max={10}
              step={0.1}
              decimals={1}
              onChange={(v) => update('atrMultSL', v)}
            />
            <StepperInput
              label="Risk : Reward"
              value={settings.riskReward}
              min={0.5}
              max={20}
              step={0.5}
              decimals={1}
              onChange={(v) => update('riskReward', v)}
            />
          </SettingsSection>

          <SettingsSection title="Signal">
            <Toggle
              label="Candle Confirmation"
              description="Require close above/below EMAs"
              checked={settings.confirmCandle}
              onChange={(v) => update('confirmCandle', v)}
            />
          </SettingsSection>

          <SettingsSection title="Chart Legend">
            <div className="space-y-2">
              <LegendItem color="#22c55e" label="Fast EMA" line />
              <LegendItem color="#f97316" label="Slow EMA" line />
              <LegendItem color="#3b82f6" label="Buy Entry" marker="arrowUp" />
              <LegendItem color="#f97316" label="Sell Entry" marker="arrowDown" />
              <LegendItem color="#ef4444" label="Stop Loss" dot="red" />
              <LegendItem color="#22c55e" label="Take Profit" dot="green" />
            </div>
          </SettingsSection>
        </div>
      </div>
    </>
  )
}

// ── Sub-components ───────────────────────────────────────────────

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-[11px] font-semibold text-chart-muted uppercase tracking-widest">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer group py-1 min-h-[48px]">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm text-gray-200 group-hover:text-white transition-colors">{label}</span>
        {description && (
          <span className="text-[11px] text-chart-muted leading-tight">{description}</span>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative w-[48px] h-[28px] rounded-full transition-colors flex-shrink-0 cursor-pointer focus-visible:outline-none ${
          checked ? 'bg-chart-blue' : 'bg-white/10'
        }`}
      >
        <span
          className={`absolute top-[3px] left-[3px] w-[22px] h-[22px] bg-white rounded-full shadow-md transition-transform duration-200 ease-spring ${
            checked ? 'translate-x-[20px]' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  )
}

function StepperInput({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  decimals = 0,
  onChange,
}: {
  label: string
  description?: string
  value: number
  min: number
  max: number
  step?: number
  decimals?: number
  onChange: (v: number) => void
}) {
  const fmt = (v: number) => v.toFixed(decimals)

  const nudge = (dir: 1 | -1) => {
    const next = Math.min(max, Math.max(min, value + dir * step))
    onChange(Math.round(next * Math.pow(10, decimals)) / Math.pow(10, decimals))
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-sm text-gray-200">{label}</label>
        <span className="text-xs font-mono font-semibold text-chart-blue tabular-nums tabular-nums">{fmt(value)}</span>
      </div>
      {description && (
        <span className="text-[11px] text-chart-muted -mt-0.5">{description}</span>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => nudge(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-black/20 border border-white/10 text-chart-muted hover:text-white hover:border-white/20 active:scale-95 transition-all cursor-pointer touch-target"
          aria-label={`Decrease ${label}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M5 12h14"/>
          </svg>
        </button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            if (e.target.value === '') return
            const v = parseFloat(e.target.value)
            if (isNaN(v)) return
            const clamped = Math.min(max, Math.max(min, v))
            onChange(Math.round(clamped * Math.pow(10, decimals)) / Math.pow(10, decimals))
          }}
          onBlur={() => {
            const clamped = Math.min(max, Math.max(min, value))
            if (clamped !== value) onChange(clamped)
          }}
          className="flex-1 bg-black/20 border border-white/10 text-white text-sm font-mono text-center rounded-lg px-2 py-2 focus:outline-none focus:border-chart-blue focus:ring-1 focus:ring-chart-blue/30 transition-colors cursor-pointer"
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
        />
        <button
          onClick={() => nudge(1)}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-black/20 border border-white/10 text-chart-muted hover:text-white hover:border-white/20 active:scale-95 transition-all cursor-pointer touch-target"
          aria-label={`Increase ${label}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

function LegendItem({ color, label, line, marker, dot }: { color: string; label: string; line?: boolean; marker?: string; dot?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center w-6 flex-shrink-0">
        {line && <div className="w-5 h-0.5 rounded-full" style={{ backgroundColor: color }} />}
        {marker === 'arrowUp' && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill={color} aria-hidden="true">
            <path d="M12 4l8 12H4z"/>
          </svg>
        )}
        {marker === 'arrowDown' && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill={color} aria-hidden="true">
            <path d="M12 20l-8-12h16z"/>
          </svg>
        )}
        {dot === 'red' && <div className="w-2.5 h-2.5 rounded-full bg-red-400" />}
        {dot === 'green' && <div className="w-2.5 h-2.5 rounded-full bg-green-400" />}
      </div>
      <span className="text-xs text-gray-300">{label}</span>
    </div>
  )
}
