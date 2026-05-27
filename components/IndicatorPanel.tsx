'use client'

import { useEffect, useRef } from 'react'
import { IndicatorSettings } from '@/lib/types'

interface Props {
  open: boolean
  settings: IndicatorSettings
  onChange: (settings: IndicatorSettings) => void
  onClose: () => void
}

export default function IndicatorPanel({ open, settings, onChange, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Trap focus inside panel when open
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
      {/* Backdrop — only on mobile (md: hidden), always shows on mobile */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-overlay animate-fade-in md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/*
        Bottom sheet on mobile (below md breakpoint):
        - Slides up from bottom
        - Has safe-area-inset-bottom padding
        - Has handle + close button
        - Scrollable content area

        Side sheet on md+ (hidden on mobile):
        - Slides in from right
        - Full height, no safe area
        - Has close button in header
      */}
      <div
        ref={panelRef}
        className={`
          fixed md:fixed z-50 md:z-40
          flex flex-col
          transform transition-transform duration-300 ease-out
          ${open ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-x-full'}
          md:top-0 md:right-0 md:h-full
          bottom-0 left-0 right-0 md:left-auto
          w-full md:w-72 lg:w-80
          bg-chart-surface md:bg-chart-bg
          border-t md:border-t-0 md:border-l
          border-chart-border
          shadow-2xl shadow-black/80 md:shadow-none
          md:rounded-none rounded-t-2xl
        `}
        style={{
          paddingBottom: open ? 'max(env(safe-area-inset-bottom), 0.75rem)' : undefined,
          maxHeight: open ? '85vh' : undefined,
          height: open ? undefined : undefined,
        }}
        role="dialog"
        aria-modal={open}
        aria-label="Indicator settings"
        aria-hidden={!open}
      >
        {/* ── Handle (mobile only) ── */}
        <div className="flex flex-col items-center pt-2.5 pb-0 md:hidden">
          <div className="w-9 h-1 rounded-full bg-chart-border mb-0" />
        </div>

        {/* ── Header ── */}
        <div className="flex items-center justify-between shrink-0 px-4 py-3 border-b border-chart-border">
          <div className="flex items-center gap-2">
            {/* Settings icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
            </svg>
            <span className="text-sm font-semibold text-white">Indicator Settings</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-chart-border text-chart-muted hover:text-white transition-colors cursor-pointer touch-target"
            aria-label="Close indicator settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto hide-scrollbar px-4 py-4 space-y-6 pb-4">
          <SettingsSection title="EMA Indicators">
            <Toggle
              label="Show Fast EMA (5)"
              description="Short period moving average"
              checked={settings.showFastEMA}
              onChange={(v) => update('showFastEMA', v)}
            />
            <Toggle
              label="Show Slow EMA (13)"
              description="Long period moving average"
              checked={settings.showSlowEMA}
              onChange={(v) => update('showSlowEMA', v)}
            />
            <NumberInput
              label="Fast Period"
              value={settings.emaFastLen}
              min={2}
              max={100}
              onChange={(v) => update('emaFastLen', v)}
            />
            <NumberInput
              label="Slow Period"
              value={settings.emaSlowLen}
              min={2}
              max={200}
              onChange={(v) => update('emaSlowLen', v)}
            />
          </SettingsSection>

          <SettingsSection title="Risk Management">
            <NumberInput
              label="ATR Period"
              description="Average True Range lookback"
              value={settings.atrLen}
              min={1}
              max={100}
              onChange={(v) => update('atrLen', v)}
            />
            <NumberInput
              label="Stop Loss Multiplier"
              description="ATR multiplier for SL distance"
              value={settings.atrMultSL}
              min={0.1}
              max={10}
              step={0.1}
              onChange={(v) => update('atrMultSL', v)}
            />
            <NumberInput
              label="Risk : Reward Ratio"
              description="Target profit per unit of risk"
              value={settings.riskReward}
              min={0.5}
              max={20}
              step={0.5}
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

          {/* Legend / color key */}
          <SettingsSection title="Chart Legend">
            <div className="space-y-2">
              <LegendItem color="#22c55e" label="Fast EMA (bullish)" />
              <LegendItem color="#f97316" label="Slow EMA (bearish)" />
              <LegendItem color="#3b82f6" label="Buy Entry" marker="arrow-up" />
              <LegendItem color="#f97316" label="Sell Entry" marker="arrow-down" />
              <LegendItem color="#ef4444" label="Stop Loss" marker="circle-red" />
              <LegendItem color="#22c55e" label="Take Profit" marker="circle-green" />
            </div>
          </SettingsSection>
        </div>
      </div>
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────

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
    <label className="flex items-start justify-between gap-3 cursor-pointer group py-0.5">
      <div className="flex flex-col gap-0.5">
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
        className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 mt-0.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
          checked ? 'bg-chart-blue' : 'bg-chart-border'
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ease-out ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}

function NumberInput({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  description?: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-sm text-gray-200">{label}</label>
        <span className="text-xs font-mono font-semibold text-chart-blue tabular-nums">{value}</span>
      </div>
      {description && (
        <span className="text-[11px] text-chart-muted -mt-0.5">{description}</span>
      )}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          if (e.target.value === '') return
          const v = parseFloat(e.target.value)
          if (!isNaN(v) && v >= min && v <= max) onChange(v)
        }}
        onBlur={() => {
          if (value < min) onChange(min)
          else if (value > max) onChange(max)
        }}
        className="w-full bg-chart-bg border border-chart-border text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30 transition-colors cursor-pointer"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
      />
    </div>
  )
}

function LegendItem({ color, label, marker }: { color: string; label: string; marker?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-1 w-6">
        {marker === 'arrow-up' && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill={color} aria-hidden="true">
            <path d="M12 4l8 12H4z"/>
          </svg>
        )}
        {marker === 'arrow-down' && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill={color} aria-hidden="true">
            <path d="M12 20l-8-12h16z"/>
          </svg>
        )}
        {marker === 'circle-red' && (
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
        )}
        {marker === 'circle-green' && (
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        )}
        {!marker && (
          <div className="w-5 h-0.5 rounded-full" style={{ backgroundColor: color }} />
        )}
      </div>
      <span className="text-xs text-gray-300">{label}</span>
    </div>
  )
}
