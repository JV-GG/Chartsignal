'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { OHLCBar, IndicatorSettings, SignalPoint, ActivePosition } from '@/lib/types'
import { calcIndicators, calcSignalsWithPosition } from '@/lib/indicators'
import { BinanceStream, fetchHistoricalBars } from '@/lib/websocket'
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
  const streamRef = useRef<BinanceStream | null>(null)
  const barsRef = useRef<OHLCBar[]>([])
  const mountedRef = useRef(false)
  const loadIdRef = useRef(0)

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
  const [connected, setConnected] = useState(true)
  const [loading, setLoading] = useState(false)
  const [chartReady, setChartReady] = useState(false)
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

  // ── EFFECT 1: Create chart once ─────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    mountedRef.current = true
    let ro: ResizeObserver

    ;(async () => {
      const { createChart, CrosshairMode } = await import('lightweight-charts')
      if (!containerRef.current || !mountedRef.current) return

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        layout: { background: { color: '#050505' }, textColor: '#d1d4dc' },
        grid: { vertLines: { color: '#1a1a24' }, horzLines: { color: '#1a1a24' } },
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: { borderColor: '#232332', timeVisible: true, secondsVisible: false },
      })

      chartRef.current = chart
      candleRef.current = chart.addCandlestickSeries({
        upColor: '#22c55e', downColor: '#ef4444',
        borderUpColor: '#22c55e', borderDownColor: '#ef4444',
        wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      })
      fastEMARef.current = chart.addLineSeries({ color: '#22c55e', lineWidth: 1, title: 'EMA Fast' })
      slowEMARef.current = chart.addLineSeries({ color: '#f97316', lineWidth: 1, title: 'EMA Slow' })

      ro = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          })
        }
      })
      ro.observe(containerRef.current)

      // Signal that the chart is ready for data
      setChartReady(true)
    })()

    return () => {
      mountedRef.current = false
      if (ro) ro.disconnect()
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }
      candleRef.current = null
      fastEMARef.current = null
      slowEMARef.current = null
      clearPositionLines()
      if (streamRef.current) { streamRef.current.destroy(); streamRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── EFFECT 2: Connect immediately, fetch history in parallel ─────────────
  useEffect(() => {
    if (!chartReady || !candleRef.current) return

    const loadId = ++loadIdRef.current
    setLoading(true)
    // Mark online IMMEDIATELY so the dot turns green before WS even connects
    setConnected(true)

    currentSymbol.current = symbol
    currentTimeframe.current = timeframe
    barsRef.current = []
    positionRef.current = null
    eventsRef.current = []
    setLastClosedTrade(null)
    setActivePosition(null)
    setEvents([])

    let cancelled = false

    // ── Unified Binance stream (klines + ticker in one connection) ───────
    const stream = new BinanceStream()
    streamRef.current = stream

    stream.on('bar', (update) => {
      if (cancelled || loadId !== loadIdRef.current) return
      if (!candleRef.current) return

      const { bar, isClosed } = update
      candleRef.current.update({
        time: bar.time as import('lightweight-charts').Time,
        open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      })
      setPrice(bar.close)

      if (isClosed) {
        const existingIdx = barsRef.current.findIndex((b) => b.time === bar.time)
        if (existingIdx >= 0) {
          barsRef.current[existingIdx] = bar
        } else {
          barsRef.current.push(bar)
          if (barsRef.current.length > 500) barsRef.current = barsRef.current.slice(-500)
        }
        lastBarTimeRef.current = bar.time

        const s2 = currentSettings.current
        const ind2 = calcIndicators(barsRef.current, s2)
        if (ind2) {
          const { events: evts, position: pos } = calcSignalsWithPosition(
            barsRef.current, s2, positionRef.current, ind2
          )
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
          }
        }
      } else {
        const lastIdx = barsRef.current.length - 1
        if (lastIdx >= 0 && barsRef.current[lastIdx].time === bar.time) {
          barsRef.current[lastIdx] = bar
        }
      }
    })

    stream.onPrice((price: number) => {
      if (cancelled || loadId !== loadIdRef.current) return
      setPrice(price)
    })

    stream.onConnect(() => {
      if (cancelled || loadId !== loadIdRef.current) return
      setConnected(true)
    })

    stream.onDisconnect(() => {
      // Don't show offline during auto-reconnect — stream will reconnect automatically
    })

    stream.onError(() => {
      // Don't show offline during transient errors — stream will reconnect automatically
    })

    stream.connect(symbol, timeframe)

    // ── Fetch historical bars in parallel ────────────────────────────
    const loadHistory = async () => {
      if (cancelled) return
      const { bars } = await fetchHistoricalBars(symbol, timeframe)
      if (cancelled || loadId !== loadIdRef.current) return
      if (bars.length === 0 || !candleRef.current) { setLoading(false); return }

      barsRef.current = bars
      lastBarTimeRef.current = bars[bars.length - 1].time
      candleRef.current.setData(
        bars.map((b) => ({
          time: b.time as import('lightweight-charts').Time,
          open: b.open, high: b.high, low: b.low, close: b.close,
        }))
      )

      const s = currentSettings.current
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

      if (cancelled || loadId !== loadIdRef.current) return
      setLoading(false)
    }

    loadHistory()

    return () => {
      cancelled = true
      if (streamRef.current) { streamRef.current.destroy(); streamRef.current = null }
      setLoading(false)
    }
  }, [symbol, timeframe, chartReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── EFFECT 3: Recalculate indicators when settings change ─────────────
  useEffect(() => {
    if (!candleRef.current || barsRef.current.length === 0) return

    currentSettings.current = settings
    const bars = barsRef.current
    const ind = calcIndicators(bars, settings)
    if (!ind) return

    const { events: evts, position: pos } = calcSignalsWithPosition(bars, settings, null, ind)
    positionRef.current = pos
    eventsRef.current = evts
    setActivePosition(pos)
    setEvents(evts)
    entryTimeRef.current = pos ? (evts.find((e) => e.event === 'ENTRY')?.time ?? bars[bars.length - 1].time) : 0
    renderChart(bars, pos, evts, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  const handleSymbolSelect = (symId: string) => {
    setSymbol(symId)
    setShowSymbolSheet(false)
  }

  return (
    <div className="flex flex-col w-full h-full bg-chart-bg select-none">
      {/* ── TOP TOOLBAR ─────────────────────────────────────── */}
      <header
        className="flex items-center gap-2 shrink-0 z-20 px-3 sm:px-4 h-14 sm:h-16 bg-chart-bg/70 backdrop-blur-xl border-b border-white/5"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Live status dot */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-green-500 animate-pulse-dot' : 'bg-red-500'}`}
            aria-label={connected ? 'Live connection active' : 'Connection offline'}
          />
          <span className="hidden xs:inline text-[10px] text-chart-muted font-mono uppercase tracking-widest">
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        {/* Price */}
        {price !== null && (
          <span className="text-sm sm:text-base font-mono font-semibold text-white tabular-nums tracking-tight leading-none">
            {price.toLocaleString('en-US', { minimumFractionDigits: symConfig?.decimals ?? 2, maximumFractionDigits: symConfig?.decimals ?? 2 })}
          </span>
        )}

        {/* Symbol trigger with responsive desktop dropdown */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowSymbolSheet((prev) => !prev)}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs sm:text-sm font-medium transition-all cursor-pointer touch-target flex-shrink-0 ${
              showSymbolSheet
                ? 'bg-chart-blue/20 border-chart-blue/40 text-chart-blue'
                : 'bg-chart-surface border-chart-border text-white hover:bg-white/5 active:scale-95'
            }`}
            aria-label="Select trading pair"
            aria-haspopup="listbox"
            aria-expanded={showSymbolSheet}
          >
            <span className="hidden xs:inline">{symConfig?.label}</span>
            <span className="xs:hidden font-mono font-semibold">{symConfig?.id.replace('frx', '').replace('cry', '')}</span>
            <svg className={`w-3 h-3 text-chart-muted flex-shrink-0 transition-transform duration-200 ${showSymbolSheet ? 'rotate-180 text-chart-blue' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {/* Desktop dropdown box */}
          {showSymbolSheet && (
            <>
              {/* Invisible full-screen backdrop to capture click outsides and close dropdown */}
              <div
                className="hidden sm:block fixed inset-0 z-40 bg-transparent"
                onClick={() => setShowSymbolSheet(false)}
              />
              <div
                className="hidden sm:block absolute left-0 top-[calc(100%+8px)] w-[240px] z-50 bg-[#0a0a0f]/96 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-2 animate-fade-in"
                role="listbox"
              >
                <ul className="space-y-0.5">
                  {SYMBOLS.map((sym) => {
                    const isSelected = sym.id === symbol
                    return (
                      <li key={sym.id}>
                        <button
                          onClick={() => {
                            handleSymbolSelect(sym.id)
                            setShowSymbolSheet(false)
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-chart-blue/20 text-chart-blue font-semibold'
                              : 'text-gray-300 hover:bg-white/5 active:bg-white/10'
                          }`}
                          aria-selected={isSelected}
                          role="option"
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold">{sym.label}</span>
                            <span className="text-[9px] text-chart-muted font-mono">{sym.id}</span>
                          </div>
                          {isSelected && (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="3" aria-hidden="true">
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
          )}
        </div>

        {/* Spacer */}
        <div className="hidden sm:block sm:flex-1" />

        {/* Timeframe buttons */}
        <div
          className="flex gap-0.5 overflow-x-auto hide-scrollbar momentum-scroll flex-1 sm:flex-initial min-w-0 sm:max-w-none mx-1 sm:mx-0"
          role="group"
          aria-label="Select timeframe"
        >
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.label}
              onClick={() => setTimeframe(tf.seconds)}
              className={`px-2 py-1.5 text-[11px] font-mono font-semibold rounded-md flex-shrink-0 transition-all cursor-pointer touch-target min-w-[36px] flex items-center justify-center ${
                timeframe === tf.seconds
                  ? 'bg-chart-blue text-white shadow-glow-blue'
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
          className={`p-2.5 rounded-xl transition-all cursor-pointer touch-target flex-shrink-0 ${
            showPanel
              ? 'bg-chart-blue text-white shadow-glow-blue'
              : 'bg-white/5 hover:bg-white/10 text-chart-muted hover:text-white'
          }`}
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

        {/* Shimmer skeleton */}
        {loading && (
          <div className="absolute inset-0 z-[5] pointer-events-none" aria-hidden="true">
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(90deg, #0f0f0f 0%, rgba(42,42,62,0.5) 50%, #0f0f0f 100%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.8s ease-in-out infinite',
              }}
            />
          </div>
        )}

        {/* Closed trade card */}
        {lastClosedTrade && !activePosition && (
          <div className="absolute z-10 left-3 right-[68px] sm:left-auto sm:right-20 top-3 sm:top-4 sm:w-[240px] pointer-events-auto animate-fade-in">
            <div className="glass rounded-2xl p-3.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-sm font-bold uppercase tracking-wider ${lastClosedTrade.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                  {lastClosedTrade.type === 'BUY' ? 'Long' : 'Short'} Closed
                </span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${lastClosedTrade.event === 'TP' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                  {lastClosedTrade.event === 'TP' ? 'Take Profit' : 'Stop Loss'}
                </span>
              </div>
              <div className="text-sm text-chart-text font-mono tabular-nums">
                @ {lastClosedTrade.price.toLocaleString('en-US', { minimumFractionDigits: symConfig?.decimals ?? 2, maximumFractionDigits: symConfig?.decimals ?? 2 })}
              </div>
            </div>
          </div>
        )}

        {/* Active position card */}
        {activePosition && (
          <div className="absolute z-10 left-3 right-[68px] sm:left-auto sm:right-20 top-3 sm:top-4 sm:w-[240px] pointer-events-auto animate-fade-in">
            <div className="glass rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className={`text-base font-bold uppercase tracking-wider flex items-center gap-1.5 ${activePosition.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${activePosition.type === 'BUY' ? 'bg-green-400' : 'bg-red-400'}`}></span>
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${activePosition.type === 'BUY' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                  </span>
                  {activePosition.type === 'BUY' ? 'Long' : 'Short'}
                </span>
                <span className="text-[10px] bg-chart-surface/50 border border-white/10 px-2 py-0.5 rounded-full text-chart-muted font-mono uppercase tracking-widest">Active</span>
              </div>
              <div className="space-y-1.5">
                <PositionRow label="Entry" value={activePosition.entry} color="text-white" decimals={symConfig?.decimals ?? 2} />
                <PositionRow label="Stop Loss" value={activePosition.sl} color="text-red-400" decimals={symConfig?.decimals ?? 2} />
                <PositionRow label="Take Profit" value={activePosition.tp} color="text-green-400" decimals={symConfig?.decimals ?? 2} />
              </div>
              <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between">
                <span className="text-[11px] text-chart-muted uppercase tracking-widest">R:R</span>
                <span className="text-sm font-bold text-chart-blue">1:{currentSettings.current.riskReward.toFixed(1)}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
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
        className="flex items-center justify-between px-4 h-10 shrink-0 bg-chart-bg/70 backdrop-blur-xl border-t border-white/5 text-[10px] text-chart-muted font-mono"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">{symConfig?.label}</span>
          <span className="sm:hidden">{symConfig?.id.replace('frx', '').replace('cry', '')}</span>
          <span className="text-chart-border">·</span>
          <span>{TIMEFRAMES.find((t) => t.seconds === timeframe)?.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="uppercase tracking-widest">{connected ? 'Live' : 'Offline'}</span>
        </div>
      </footer>

      {/* ── SYMBOL SELECTOR ─────────────────────────────────── */}
      {showSymbolSheet && (
        <SymbolSelectorSheet
          symbols={SYMBOLS}
          selected={symbol}
          onSelect={handleSymbolSelect}
          onClose={() => setShowSymbolSheet(false)}
        />
      )}

      {/* ── INDICATOR PANEL ──────────────────────────────────── */}
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
    <div className="flex items-center justify-between gap-2">
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
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in sm:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="fixed z-50 bg-[#0a0a0f]/96 backdrop-blur-2xl border-t border-white/10 shadow-[0_-8px_32px_rgba(0,0,0,0.5)]
          bottom-0 left-0 right-0 rounded-t-3xl animate-slide-up sm:hidden"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Select trading pair"
      >
        {/* Handle for mobile bottom sheet */}
        <div className="sheet-handle">
          <div className="sheet-handle-bar" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <span className="text-sm font-semibold text-white">Select Trading Pair</span>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-chart-muted hover:text-white transition-colors cursor-pointer focus-visible:outline-none"
            aria-label="Close dialog"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Symbol list */}
        <ul className="px-3 pb-3 pt-2 space-y-1 max-h-[50vh] momentum-scroll overflow-y-auto">
          {symbols.map((sym) => {
            const isSelected = sym.id === selected
            return (
              <li key={sym.id}>
                <button
                  onClick={() => onSelect(sym.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all cursor-pointer min-h-[52px] ${
                    isSelected
                      ? 'bg-chart-blue/20 border border-chart-blue/40'
                      : 'border border-transparent hover:bg-white/5 active:bg-white/10 active:scale-[0.99]'
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
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" aria-hidden="true">
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
