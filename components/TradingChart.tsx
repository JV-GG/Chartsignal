'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { OHLCBar, IndicatorSettings, SignalPoint } from '@/lib/types'
import { calcSignals } from '@/lib/indicators'
import { DerivWS } from '@/lib/deriv'
import IndicatorPanel from './IndicatorPanel'

const SYMBOLS = [
  'frxXAUUSD', // Gold
  'frxGBPUSD', // GBP/USD
  'frxUSDJPY', // USD/JPY
  'cryBTCUSD', // BTC/USD
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
  riskReward: 3.0,
  confirmCandle: true,
  showFastEMA: true,
  showSlowEMA: true,
}

export default function TradingChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof import('lightweight-charts').createChart> | null>(null)
  const candleSeriesRef = useRef<ReturnType<ReturnType<typeof import('lightweight-charts')['createChart']>['addCandlestickSeries']> | null>(null)
  const fastEMARef = useRef<ReturnType<ReturnType<typeof import('lightweight-charts')['createChart']>['addLineSeries']> | null>(null)
  const slowEMARef = useRef<ReturnType<ReturnType<typeof import('lightweight-charts')['createChart']>['addLineSeries']> | null>(null)
  const priceLinesRef = useRef<ReturnType<ReturnType<typeof import('lightweight-charts')['createChart']>['addLineSeries']>[]>([])
  const wsRef = useRef<DerivWS | null>(null)
  const barsRef = useRef<OHLCBar[]>([])
  const activeSignalRef = useRef<SignalPoint | null>(null)

  const [symbol, setSymbol] = useState('frxXAUUSD')
  const [timeframe, setTimeframe] = useState(60)
  const [settings, setSettings] = useState<IndicatorSettings>(DEFAULT_SETTINGS)
  const [showPanel, setShowPanel] = useState(false)
  const [connected, setConnected] = useState(false)
  const [activeSignal, setActiveSignal] = useState<SignalPoint | null>(null)

  const TOOLBAR_HEIGHT = 52

  const clearPriceLines = useCallback(() => {
    if (!chartRef.current) return
    priceLinesRef.current.forEach((line) => {
      chartRef.current!.removeSeries(line)
    })
    priceLinesRef.current = []
  }, [])

  const renderIndicators = useCallback((bars: OHLCBar[]) => {
    if (!candleSeriesRef.current) return

    const { emaFast, emaSlow, signals } = calcSignals(bars, settings)

    if (fastEMARef.current) {
      fastEMARef.current.setData(
        emaFast.map((v, i) => ({ time: bars[i].time as import('lightweight-charts').Time, value: v })).filter((p) => p.value !== null) as { time: import('lightweight-charts').Time; value: number }[]
      )
    }

    if (slowEMARef.current) {
      slowEMARef.current.setData(
        emaSlow.map((v, i) => ({ time: bars[i].time as import('lightweight-charts').Time, value: v })).filter((p) => p.value !== null) as { time: import('lightweight-charts').Time; value: number }[]
      )
    }

    candleSeriesRef.current.setMarkers(
      signals.map((s) => ({
        time: s.time as import('lightweight-charts').Time,
        position: s.type === 'BUY' ? ('belowBar' as const) : ('aboveBar' as const),
        color: s.type === 'BUY' ? '#22c55e' : '#ef4444',
        shape: s.type === 'BUY' ? ('arrowUp' as const) : ('arrowDown' as const),
        text: s.type,
      }))
    )

    const lastSignal = signals[signals.length - 1] ?? null
    activeSignalRef.current = lastSignal
    setActiveSignal(lastSignal)

    clearPriceLines()
    if (lastSignal && chartRef.current) {
      const entryLine = chartRef.current.addLineSeries({
        color: '#ffffff',
        lineWidth: 1,
        lineStyle: 2,
        title: 'Entry',
      })
      entryLine.setData([
        { time: lastSignal.time as import('lightweight-charts').Time, value: lastSignal.price },
        { time: (lastSignal.time + 86400 * 30) as import('lightweight-charts').Time, value: lastSignal.price },
      ])

      const slLine = chartRef.current.addLineSeries({
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: 0,
        title: 'SL',
      })
      slLine.setData([
        { time: lastSignal.time as import('lightweight-charts').Time, value: lastSignal.stopLoss },
        { time: (lastSignal.time + 86400 * 30) as import('lightweight-charts').Time, value: lastSignal.stopLoss },
      ])

      const tpLine = chartRef.current.addLineSeries({
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: 0,
        title: 'TP',
      })
      tpLine.setData([
        { time: lastSignal.time as import('lightweight-charts').Time, value: lastSignal.takeProfit },
        { time: (lastSignal.time + 86400 * 30) as import('lightweight-charts').Time, value: lastSignal.takeProfit },
      ])

      priceLinesRef.current = [entryLine, slLine, tpLine]
    }
  }, [settings, clearPriceLines])

  const subscribe = useCallback(async (sym: string, tf: number) => {
    if (wsRef.current) {
      wsRef.current.unsubscribe()
    }

    const ws = new DerivWS()
    wsRef.current = ws

    try {
      await ws.connect()
      setConnected(true)

      const history = await ws.subscribeCandles(sym, tf, (bar) => {
        if (!candleSeriesRef.current) return

        const existing = barsRef.current.findIndex((b) => b.time === bar.time)
        if (existing >= 0) {
          barsRef.current[existing] = bar
          candleSeriesRef.current.update({
            time: bar.time as import('lightweight-charts').Time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
          })
        } else {
          barsRef.current.push(bar)
          barsRef.current = barsRef.current.slice(-2000)
          renderIndicators(barsRef.current)
        }
      })

      if (history.length > 0) {
        barsRef.current = history
        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData(
            history.map((bar) => ({
              time: bar.time as import('lightweight-charts').Time,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
            }))
          )
        }
        renderIndicators(history)
      }
    } catch {
      setConnected(false)
    }
  }, [renderIndicators])

  useEffect(() => {
    if (!chartContainerRef.current) return

    let ro: ResizeObserver
    let chart: ReturnType<typeof import('lightweight-charts').createChart> | null = null
    let mounted = true

    ;(async () => {
      const { createChart, CrosshairMode } = await import('lightweight-charts')
      if (!mounted || !chartContainerRef.current) return

      chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
        layout: {
          background: { color: '#0f0f0f' },
          textColor: '#d1d4dc',
        },
        grid: {
          vertLines: { color: '#1e1e2e' },
          horzLines: { color: '#1e1e2e' },
        },
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: {
          borderColor: '#2a2a3e',
          timeVisible: true,
          secondsVisible: false,
        },
      })

      chartRef.current = chart

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      })
      candleSeriesRef.current = candleSeries

      const fastEMA = chart.addLineSeries({ color: '#22c55e', lineWidth: 1, title: 'EMA Fast' })
      fastEMARef.current = fastEMA

      const slowEMA = chart.addLineSeries({ color: '#f97316', lineWidth: 1, title: 'EMA Slow' })
      slowEMARef.current = slowEMA

      ro = new ResizeObserver(() => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
          })
        }
      })
      if (chartContainerRef.current) ro.observe(chartContainerRef.current)

      if (mounted) subscribe(symbol, timeframe)
    })()

    return () => {
      mounted = false
      if (ro) ro.disconnect()
      if (chart) chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      fastEMARef.current = null
      slowEMARef.current = null
      if (wsRef.current) wsRef.current.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (candleSeriesRef.current && barsRef.current.length > 0) {
      renderIndicators(barsRef.current)
    }
  }, [settings, renderIndicators])

  useEffect(() => {
    barsRef.current = []
    subscribe(symbol, timeframe)
  }, [symbol, timeframe, subscribe])

  return (
    <div className="flex flex-col w-full h-full bg-[#0f0f0f]">
      <div
        className="flex items-center gap-3 px-4 border-b border-[#1e1e2e] shrink-0"
        style={{ height: TOOLBAR_HEIGHT }}
      >
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-400 font-mono">
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        <div className="h-4 w-px bg-[#2a2a3e]" />

        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="bg-[#1a1a2e] border border-[#2a2a3e] text-white text-sm rounded px-2 py-1 focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          {SYMBOLS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.label}
              onClick={() => setTimeframe(tf.seconds)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                timeframe === tf.seconds
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#1a1a2e] text-gray-400 hover:text-white hover:bg-[#2a2a3e]'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowPanel((v) => !v)}
            className="p-2 rounded hover:bg-[#1a1a2e] text-gray-400 hover:text-white transition-colors"
            title="Indicator Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={chartContainerRef} className="w-full h-full" />

        {activeSignal && (
          <div className="absolute top-3 right-3 bg-[#0f0f0f]/90 border border-[#2a2a3e] rounded-lg px-4 py-3 text-xs font-mono space-y-1.5">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-sm font-bold ${activeSignal.type === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>
                {activeSignal.type === 'BUY' ? 'LONG' : 'SHORT'}
              </span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-gray-500">Entry</span>
              <span className="text-white">{activeSignal.price.toFixed(4)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-gray-500">SL</span>
              <span className="text-red-400">{activeSignal.stopLoss.toFixed(4)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-gray-500">TP</span>
              <span className="text-green-400">{activeSignal.takeProfit.toFixed(4)}</span>
            </div>
            <div className="flex justify-between gap-6 border-t border-[#2a2a3e] pt-1.5 mt-1.5">
              <span className="text-gray-500">R:R</span>
              <span className="text-gray-300">{settings.riskReward.toFixed(1)}</span>
            </div>
          </div>
        )}
      </div>

      <IndicatorPanel
        open={showPanel}
        settings={settings}
        onChange={setSettings}
        onClose={() => setShowPanel(false)}
      />
    </div>
  )
}
