'use client'

import { IndicatorSettings } from '@/lib/types'

interface Props {
  open: boolean
  settings: IndicatorSettings
  onChange: (settings: IndicatorSettings) => void
  onClose: () => void
}

export default function IndicatorPanel({ open, settings, onChange, onClose }: Props) {
  const update = (key: keyof IndicatorSettings, value: unknown) => {
    onChange({ ...settings, [key]: value })
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed top-0 right-0 h-full w-72 bg-[#0f0f0f] border-l border-[#2a2a3e] z-40 transform transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a3e]">
          <span className="text-sm font-medium text-white">Indicator Settings</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#1a1a2e] text-gray-400 hover:text-white transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-5 overflow-y-auto h-full pb-8">
          <Section title="EMA">
            <Toggle label="Show Fast EMA" checked={settings.showFastEMA} onChange={(v) => update('showFastEMA', v)} />
            <Toggle label="Show Slow EMA" checked={settings.showSlowEMA} onChange={(v) => update('showSlowEMA', v)} />
            <NumberInput label="Fast Period" value={settings.emaFastLen} min={2} max={100} onChange={(v) => update('emaFastLen', v)} />
            <NumberInput label="Slow Period" value={settings.emaSlowLen} min={2} max={200} onChange={(v) => update('emaSlowLen', v)} />
          </Section>

          <Section title="Risk Management">
            <NumberInput label="ATR Period" value={settings.atrLen} min={1} max={100} onChange={(v) => update('atrLen', v)} />
            <NumberInput label="SL Multiplier" value={settings.atrMultSL} min={0.1} max={10} step={0.1} onChange={(v) => update('atrMultSL', v)} />
            <NumberInput label="Risk : Reward" value={settings.riskReward} min={0.5} max={20} step={0.5} onChange={(v) => update('riskReward', v)} />
          </Section>

          <Section title="Signal">
            <Toggle label="Require Candle Confirmation" checked={settings.confirmCandle} onChange={(v) => update('confirmCandle', v)} />
          </Section>
        </div>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-sm text-gray-300 group-hover:text-white transition-colors">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-[#2a2a3e]'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}

function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
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
        className="w-full bg-[#1a1a2e] border border-[#2a2a3e] text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
      />
    </div>
  )
}
