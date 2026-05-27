'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { OHLCBar, IndicatorSettings, SignalPoint, ActivePosition } from '@/lib/types'
import { calcIndicators, calcSignalsWithPosition } from '@/lib/indicators'
import { LivePriceService } from '@/lib/livePrices'
import IndicatorPanel from './IndicatorPanel'

const SYMBOLS = [
  { id: 'frxXAUUSD', label: 'Gold (XAU/USD)', decimals: 2 },
  { id: 'frxGBPUSD', label: 'GBP/USD',         decimals: 4 },
  { id: 'frxUSDJPY', label: 'USD/JPY',         decimals: 3 },
  { id: 'cryBTCUSD', label: 'BTC/USD',          decimals: 2 },
]

const TIMEFRAMES = [
  { label: '1m',  seconds: 60    },
  { label: '5m',  seconds: 300   },
  { label: '15m', seconds: 900   },
  { label: '1h',  seconds: 3600  },
  { label: '4h',  seconds: 14400 },
  { label: '1d',  seconds: 86400 },
]

const DEFAULT_SETTINGS: IndicatorSettings = {
  emaFastLen: 5,
  emaSlowLen: 13,
  atrLen: 14,
  atrMultSL: 0.5,
  riskReward: 1.5,
  confirmCandle: true,
  showFastEMA: true,
  showSlowEMA: true,
}

export default function TradingChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof import('lightweight-charts').createChart> | null>(null)
  const candleRef = useRef<ReturnType<ReturnType<typeof import('lightweight-charts')['createChart']>['addCandlestickSeries']> | null>(null)
  const fastEMARef = useRef<ReturnType<ReturnType<typeof import('lightweight-charts')['createChart']>['addLineSeries']> | null>(null)
  const slowEMARef = useRef<ReturnType<ReturnType<typeof import('lightweight-charts')['createChart']>['addLineSeries']> | null>(null)
  const priceService = useRef<LivePriceService | null>(null)
  const unsubPrice = useRef<(() => void) | null>(null)
  const barsRef = useRef<OHLCBar[]>([])
  const chartReady = useRef(false)
  const mountedRef = useRef(false)

  const currentSymbol = useRef('frxXAUUSD')
  const currentTimeframe = useRef(60)
  const currentSettings = useRef<IndicatorSettings>(DEFAULT_SETTINGS)

  const entryLineRef = useRef<ReturnType<ReturnType<typeof import('lightweight-charts')['createChart']>['addLineSeries']> | null>(null)
  const slLineRef = useRef<ReturnType<ReturnType<typeof import('lightweight-charts')['createChart']>['addLineSeries']> | null>(null)
  const tpLineRef = useRef<ReturnType<ReturnType<typeof import('lightweight-charts')['createChart']>['addLineSeries']> | null>(null)

  const positionRef = useRef<ActivePosition | null>(null)
  const eventsRef = useRef<SignalPoint[]>([])
  const lastBarTimeRef = useRef<number>(0)
  const entryTimeRef = useRef<number>(0)

  const [symbol, setSymbol] = useState('frxXAUUSD')
  const [timeframe, setTimeframe] = useState(60)
  const [settings, setSettings] = useState<IndicatorSettings>(DEFAULT_SETTINGS)
  const [showPanel, setShowPanel] = useState(false)
  const [showSymbolSheet, setShowSymbolSheet] = useState(false)
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activePosition, setActivePosition] = useState<ActivePosition | null>(null)
  const [lastClosedTrade, setLastClosedTrade] = useState<SignalPoint | null>(null)
  const [events, setEvents] = useState<SignalPoint[]>([])
  const [price, setPrice] = useState<number | null>(null)

  const symConfig = SYMBOLS.find((s) => s.id === symbol)

  const isDisposed = useCallback(() => {
    return !chartRef.current || (chartRef.current as unknown as { _disposed?: boolean })._disposed
  }, [])

  const clearPositionLines = useCallback(() => {
    if (isDisposed()) return
    const remove = (ref: typeof entryLineRef) => {
      if (ref.current) { try { chartRef.current!.removeSeries(ref.current) } catch { /* noop */ } ref.current = null }
    }
    remove(entryLineRef)
    remove(slLineRef)
    remove(tpLineRef)
  }, [isDisposed])

  const syncPositionLines = useCallback((pos: ActivePosition | null, latestTime: number, entryTime: number) => {
    if (isDisposed()) return
    const effectiveEntryTime = entryTime > 0 ? entryTime : latestTime
    const setOrUpdate = (ref: typeof entryLineRef, price: number, color: string) => {
      if (!ref.current) {
        ref.current = chartRef.current!.addLineSeries({
          color, lineWidth: 2, lineStyle: 0,
          priceLineVisible: false, lastValueVisible: true,
        })
      }
      ref.current.setData([
        { time: effectiveEntryTime as import('lightweight-charts').Time, value: price },
        { time: latestTime as import('lightweight-charts').Time, value: price },
      ])
    }
    if (pos) {
      setOrUpdate(entryLineRef, pos.entry, '#9ca3af')
      setOrUpdate(slLineRef, pos.sl, '#ef4444')
      setOrUpdate(tpLineRef, pos.tp, '#22c55e')
    } else {
      clearPositionLines()
    }
  }, [isDisposed, clearPositionLines])

  const renderChart = useCallback((bars: OHLCBar[], pos: ActivePosition | null, evts: SignalPoint[], isInitial = false) => {
    if (!candleRef.current || isDisposed() || bars.length === 0) return
    const latestTime = bars[bars.length - 1].time
    const ind = calcIndicators(bars, currentSettings.current)
    if (!ind) return
    const { emaFast, emaSlow } = ind

    if (fastEMARef.current) {
      fastEMARef.current.applyOptions({ visible: currentSettings.current.showFastEMA })
      fastEMARef.current.setData(
        emaFast.map((v, i) => ({ time: bars[i].time as import('lightweight-charts').Time, value: v })).filter((p) => p.value !== null) as { time: import('lightweight-charts').Time; value: number }[]
      )
    }
    if (slowEMARef.current) {
      slowEMARef.current.applyOptions({ visible: currentSettings.current.showSlowEMA })
      slowEMARef.current.setData(
        emaSlow.map((v, i) => ({ time: bars[i].time as import('lightweight-charts').Time, value: v })).filter((p) => p.value !== null) as { time: import('lightweight-charts').Time; value: number }[]
      )
    }

    syncPositionLines(pos, latestTime, entryTimeRef.current)

    if (isInitial) {
      setTimeout(() => {
        if (!candleRef.current) return
        candleRef.current.setMarkers(
          evts.map((s) => ({
            time: s.time as import('lightweight-charts').Time,
            position: s.type === 'BUY' ? ('belowBar' as const) : ('aboveBar' as const),
            color: s.event === 'ENTRY' ? (s.type === 'BUY' ? '#3b82f6' : '#f97316') : (s.event === 'SL' ? '#ef4444' : '#22c55e'),
            shape: s.event === 'ENTRY' ? (s.type === 'BUY' ? ('arrowUp' as const) : ('arrowDown' as const)) : ('circle' as const),
            text: s.event === 'ENTRY' ? s.type : s.event,
          }))
        )
      }, 100)
    } else {
      candleRef.current.setMarkers(
        evts.map((s) => ({
          time: s.time as import('lightweight-charts').Time,
          position: s.type === 'BUY' ? ('belowBar' as const) : ('aboveBar' as const),
          color: s.event === 'ENTRY' ? (s.type === 'BUY' ? '#3b82f6' : '#f97316') : (s.event === 'SL' ? '#ef4444' : '#22c55e'),
          shape: s.event === 'ENTRY' ? (s.type === 'BUY' ? ('arrowUp' as const) : ('arrowDown' as const)) : ('circle' as const),
          text: s.event === 'ENTRY' ? s.type : s.event,
        }))
      )
    }

    setPrice(bars[bars.length - 1].close)
  }, [isDisposed, syncPositionLines])

  const updateLive = useCallback((bar: OHLCBar, pos: ActivePosition | null) => {
    if (isDisposed()) return
    syncPositionLines(pos, bar.time, entryTimeRef.current)
    setPrice(bar.close)
  }, [isDisposed, syncPositionLines])

  // EFFECT 1: Create chart once on mount (no deps — runs once)
  useEffect(() => {
    if (!containerRef.current) return
    mountedRef.current = true
    let ro: ResizeObserver

    ;(async () => {
      const { createChart, CrosshairMode } = await import('lightweight-charts')
      await new Promise((r) => setTimeout(r, 50))
      if (!containerRef.current || !mountedRef.current) return

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        layout: { background: { color: '#0f0f0f' }, textColor: '#d1d4dc' },
        grid: { vertLines: { color: '#1e1e2e' }, horzLines: { color: '#1e1e2e' } },
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: { borderColor: '#2a2a3e', timeVisible: true, secondsVisible: false },
      })

      chartRef.current = chart
      chartReady.current = true

      const candle = chart.addCandlestickSeries({
        upColor: '#22c55e', downColor: '#ef4444',
        borderUpColor: '#22c55e', borderDownColor: '#ef4444',
        wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      })
      candleRef.current = candle

      const fastEMA = chart.addLineSeries({ color: '#22c55e', lineWidth: 1, title: 'EMA Fast' })
      fastEMARef.current = fastEMA
      const slowEMA = chart.addLineSeries({ color: '#f97316', lineWidth: 1, title: 'EMA Slow' })
      slowEMARef.current = slowEMA

      priceService.current = new LivePriceService()
      setConnected(true)

      ro = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          })
        }
      })
      ro.observe(containerRef.current)
    })()

    return () => {
      mountedRef.current = false
      if (ro) ro.disconnect()
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }
      candleRef.current = null
      fastEMARef.current = null
      slowEMARef.current = null
      clearPositionLines()
      if (unsubPrice.current) { unsubPrice.current(); unsubPrice.current = null }
      if (priceService.current) { priceService.current.destroy(); priceService.current = null }
      chartReady.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // EFFECT 2: Load data when symbol/timeframe/settings change
  useEffect(() => {
    if (!chartReady.current || !priceService.current) return

    currentSymbol.current = symbol
    currentTimeframe.current = timeframe
    currentSettings.current = settings

    let cancelled = false

    const loadData = async () => {
      if (cancelled || !priceService.current) return

      if (unsubPrice.current) { unsubPrice.current(); unsubPrice.current = null }
      setLoading(true)
      barsRef.current = []
      positionRef.current = null
      eventsRef.current = []
      setLastClosedTrade(null)

      const svc = priceService.current
      const sym = currentSymbol.current
      const tf = currentTimeframe.current
      const s = currentSettings.current

      const bars = await svc.fetchBars(sym, tf)
      if (cancelled || bars.length === 0 || !candleRef.current) { setLoading(false); return }

      barsRef.current = bars
      lastBarTimeRef.current = bars[bars.length - 1].time
      candleRef.current.setData(
        bars.map((b) => ({ time: b.time as import('lightweight-charts').Time, open: b.open, high: b.high, low: b.low, close: b.close }))
      )

      const ind = calcIndicators(bars, s)
      if (ind) {
        const { events: evts, position: pos } = calcSignalsWithPosition(bars, s, null, ind)
        positionRef.current = pos
        eventsRef.current = evts
        setActivePosition(pos)
        setEvents(evts)
        entryTimeRef.current = pos ? (evts.find((e) => e.event === 'ENTRY')?.time ?? bars[bars.length - 1].time) : 0
        renderChart(bars, pos, evts, true)
      }

      setLoading(false)
      if (cancelled) return

      unsubPrice.current = svc.subscribe(
        sym, tf,
        (newBars) => {
          if (isDisposed()) return
          barsRef.current = newBars
          lastBarTimeRef.current = newBars[newBars.length - 1].time
          const s2 = currentSettings.current
          const ind = calcIndicators(newBars, s2)
          if (ind) {
            const { events: evts, position: pos } = calcSignalsWithPosition(newBars, s2, positionRef.current, ind)
            if (evts.length > eventsRef.current.length) {
              eventsRef.current = evts
              setEvents(evts)
            }
            if (pos !== positionRef.current) {
              if (!pos && positionRef.current) {
                const closed = evts[evts.length - 1]
                if (closed && closed.event !== 'ENTRY') setLastClosedTrade(closed)
              }
              positionRef.current = pos
              setActivePosition(pos)
              entryTimeRef.current = pos ? (evts.find((e) => e.event === 'ENTRY')?.time ?? newBars[newBars.length - 1].time) : 0
              renderChart(newBars, pos, eventsRef.current)
            } else {
              updateLive(newBars[newBars.length - 1], pos)
            }
          }
        },
        (bar) => {
          if (isDisposed()) return
          if (!candleRef.current) return
          candleRef.current.update({ time: bar.time as import('lightweight-charts').Time, open: bar.open, high: bar.high, low: bar.low, close: bar.close })
          barsRef.current = [...barsRef.current, bar]
          lastBarTimeRef.current = bar.time
          const s2 = currentSettings.current
          const ind = calcIndicators(barsRef.current, s2)
          if (ind) {
            const { events: evts, position: pos } = calcSignalsWithPosition(barsRef.current, s2, positionRef.current, ind)
            if (evts.length > eventsRef.current.length) {
              eventsRef.current = evts
              setEvents(evts)
            }
            if (pos !== positionRef.current) {
              if (!pos && positionRef.current) {
                const closed = evts[evts.length - 1]
                if (closed && closed.event !== 'ENTRY') setLastClosedTrade(closed)
              }
              positionRef.current = pos
              setActivePosition(pos)
              entryTimeRef.current = pos ? (evts.find((e) => e.event === 'ENTRY')?.time ?? bar.time) : 0
              renderChart(barsRef.current, pos, eventsRef.current)
            } else {
              updateLive(bar, pos)
            }
          }
          setPrice(bar.close)
        }
      )
    }

    loadData()

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, settings])

  // Handle symbol sheet close on backdrop click
  const handleSymbolSelect = (symId: string) => {
    setSymbol(symId)
    setShowSymbolSheet(false)
  }

  return (
    <div className="flex flex-col w-full h-full bg-chart-bg select-none">
      {/* ── TOP TOOLBAR ─────────────────────────────────────── */}
      <header
        className="flex items-center gap-2 shrink-0 z-20 px-3 h-14 bg-chart-bg/95 border-b border-chart-border"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Live status + price */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'animate-pulse bg-green-500' : 'bg-red-500'}`}
            aria-label={connected ? 'Live connection active' : 'Connection offline'}
          />
          <span className="hidden xs:inline text-[10px] text-chart-muted font-mono uppercase tracking-widest">
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        {price !== null && (
          <span className="text-sm sm:text-base font-mono font-semibold text-white tabular-nums tracking-tight">
            {price.toLocaleString('en-US', { minimumFractionDigits: symConfig?.decimals ?? 2, maximumFractionDigits: symConfig?.decimals ?? 2 })}
          </span>
        )}

        {/* Symbol trigger — opens bottom sheet on mobile, inline on desktop */}
        <div className="ml-1 flex-shrink-0">
          <button
            onClick={() => setShowSymbolSheet(true)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-chart-surface border border-chart-border text-white text-xs sm:text-sm font-medium hover:bg-chart-border active:scale-95 transition-all cursor-pointer touch-target"
            aria-label="Select trading pair"
            aria-haspopup="listbox"
          >
            <span className="hidden xs:inline">{symConfig?.label}</span>
            <span className="xs:hidden font-mono">{symConfig?.id.replace('frx', '').replace('cry', '')}</span>
            <svg className="w-3 h-3 text-chart-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1 min-w-0" />

        {/* Timeframe buttons — horizontal scroll on mobile */}
        <div
          className="flex gap-0.5 overflow-x-auto hide-scrollbar flex-shrink-0"
          role="group"
          aria-label="Select timeframe"
        >
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.label}
              onClick={() => setTimeframe(tf.seconds)}
              className={`px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-xs font-mono font-semibold rounded-md flex-shrink-0 transition-all cursor-pointer touch-target min-w-[36px] sm:min-w-[40px] flex items-center justify-center ${
                timeframe === tf.seconds
                  ? 'bg-chart-blue text-white'
                  : 'text-chart-muted hover:text-white hover:bg-chart-border active:scale-95'
              }`}
              aria-pressed={timeframe === tf.seconds}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Settings button */}
        <button
          onClick={() => setShowPanel((v) => !v)}
          className="p-2 rounded-lg hover:bg-chart-surface text-chart-muted hover:text-white active:scale-95 transition-all cursor-pointer touch-target flex-shrink-0"
          aria-label="Open indicator settings"
          aria-expanded={showPanel}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
          </svg>
        </button>
      </header>

      {/* ── CHART AREA ───────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="w-full h-full" />

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-chart-bg/90 backdrop-blur-sm z-10" aria-live="polite" aria-label="Loading market data">
            <div className="w-8 h-8 border-2 border-chart-border border-t-chart-blue rounded-full animate-spin" />
            <span className="text-sm text-chart-muted">Loading market data...</span>
          </div>
        )}

        {/* Closed trade card — desktop: floating top-right, mobile: bottom */}
        {lastClosedTrade && !activePosition && (
          <div className="absolute z-10 w-[calc(100%-1rem)] sm:w-auto sm:min-w-[210px] sm:max-w-[240px] left-1/2 sm:left-auto sm:right-3 top-3 sm:top-3 -translate-x-1/2 sm:translate-x-0 bottom-3 sm:bottom-auto sm:static">
            <div className="bg-chart-surface/95 backdrop-blur border border-chart-border rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-sm font-bold uppercase tracking-wider ${lastClosedTrade.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                  {lastClosedTrade.type === 'BUY' ? 'LONG' : 'SHORT'}
                </span>
                <span className="text-[10px] text-chart-muted font-mono uppercase tracking-widest">Closed</span>
              </div>
              <div className={`text-sm font-semibold ${lastClosedTrade.event === 'TP' ? 'text-green-400' : 'text-red-400'}`}>
                {lastClosedTrade.event === 'TP' ? 'Take Profit Hit' : 'Stop Loss Hit'}
              </div>
              <div className="mt-1 text-xs text-chart-muted font-mono tabular-nums">
                @ {lastClosedTrade.price.toFixed(symConfig?.decimals ?? 2)}
              </div>
            </div>
          </div>
        )}

        {/* Active position card — desktop: floating top-right, mobile: collapsible bottom */}
        {activePosition && (
          <div className="absolute z-10 w-[calc(100%-1rem)] sm:w-auto sm:min-w-[210px] sm:max-w-[240px] left-1/2 sm:left-auto sm:right-3 top-3 sm:top-3 -translate-x-1/2 sm:translate-x-0 bottom-3 sm:bottom-auto sm:static">
            <div className="bg-chart-surface/95 backdrop-blur border border-chart-border rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
              <div className="flex items-center justify-between mb-2.5">
                <span className={`text-base font-bold uppercase tracking-wider ${activePosition.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                  {activePosition.type === 'BUY' ? 'LONG' : 'SHORT'}
                </span>
                <span className="text-[10px] text-chart-muted font-mono uppercase tracking-widest">Active</span>
              </div>
              <div className="space-y-1.5">
                <PositionRow label="Entry" value={activePosition.entry} color="text-white" decimals={symConfig?.decimals ?? 2} />
                <PositionRow label="Stop Loss" value={activePosition.sl} color="text-red-400" decimals={symConfig?.decimals ?? 2} />
                <PositionRow label="Take Profit" value={activePosition.tp} color="text-green-400" decimals={symConfig?.decimals ?? 2} />
              </div>
              <div className="mt-2.5 pt-2 border-t border-chart-border flex items-center justify-between">
                <span className="text-[10px] text-chart-muted uppercase tracking-widest">Risk : Reward</span>
                <span className="text-sm font-bold text-chart-blue">1:{currentSettings.current.riskReward.toFixed(1)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${activePosition.type === 'BUY' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                  <div className={`h-full rounded-full transition-all ${activePosition.type === 'BUY' ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: '50%' }} />
                </div>
                <span className="text-[10px] text-chart-muted font-mono tabular-nums flex-shrink-0">
                  {(Math.abs(activePosition.entry - activePosition.sl) / Math.abs(activePosition.tp - activePosition.entry)).toFixed(1)}p
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── BOTTOM STATUS BAR ───────────────────────────────── */}
      <footer
        className="flex items-center justify-between px-3 h-9 shrink-0 bg-chart-bg/95 border-t border-chart-border text-[10px] sm:text-xs text-chart-muted font-mono"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center gap-2">
          <span>{symConfig?.label}</span>
          <span className="text-chart-border">|</span>
          <span>{TIMEFRAMES.find((t) => t.seconds === timeframe)?.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="uppercase tracking-widest">{connected ? 'Live' : 'Offline'}</span>
        </div>
      </footer>

      {/* ── SYMBOL SELECTOR BOTTOM SHEET (mobile) ──────────── */}
      {showSymbolSheet && (
        <SymbolSelectorSheet
          symbols={SYMBOLS}
          selected={symbol}
          onSelect={handleSymbolSelect}
          onClose={() => setShowSymbolSheet(false)}
        />
      )}

      {/* ── INDICATOR PANEL (side on md+, bottom sheet on mobile) ── */}
      <IndicatorPanel
        open={showPanel}
        settings={settings}
        onChange={setSettings}
        onClose={() => setShowPanel(false)}
      />
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function PositionRow({ label, value, color, decimals }: { label: string; value: number; color: string; decimals: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[11px] text-chart-muted uppercase tracking-wider flex-shrink-0">{label}</span>
      <span className={`text-xs sm:text-sm font-semibold font-mono tabular-nums ${color}`}>
        {value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      </span>
    </div>
  )
}

function SymbolSelectorSheet({
  symbols,
  selected,
  onSelect,
  onClose,
}: {
  symbols: typeof SYMBOLS
  selected: string
  onSelect: (id: string) => void
  onClose: () => void
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-overlay animate-fade-in sm:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Bottom sheet */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 sm:hidden animate-slide-up rounded-t-2xl bg-chart-surface border-t border-chart-border shadow-2xl shadow-black/80"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Select trading pair"
      >
        {/* Handle */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="w-9 h-1 rounded-full bg-chart-border" />
        </div>

        {/* Title */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-chart-border">
          <span className="text-sm font-semibold text-white">Select Pair</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-chart-border text-chart-muted hover:text-white transition-colors cursor-pointer touch-target"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* List */}
        <ul className="px-2 pb-2 pt-1 space-y-0.5 max-h-[60vh] overflow-y-auto">
          {symbols.map((sym) => {
            const isSelected = sym.id === selected
            return (
              <li key={sym.id}>
                <button
                  onClick={() => onSelect(sym.id)}
                  className={`w-full flex items-center justify-between px-3 py-3.5 rounded-xl transition-all cursor-pointer touch-target min-h-[52px] ${
                    isSelected
                      ? 'bg-chart-blue/20 border border-chart-blue/40'
                      : 'hover:bg-chart-border active:scale-[0.98]'
                  }`}
                  aria-selected={isSelected}
                  role="option"
                >
                  <div className="flex flex-col items-start gap-0.5">
                    <span className={`text-sm font-semibold ${isSelected ? 'text-chart-blue' : 'text-white'}`}>
                      {sym.label}
                    </span>
                    <span className="text-[11px] text-chart-muted font-mono">{sym.id}</span>
                  </div>
                  {isSelected && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" aria-hidden="true">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}
