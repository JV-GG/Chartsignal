import { OHLCBar } from './types'

const BINANCE_WS = 'wss://stream.binance.com:9443/ws'
const BINANCE_COMBINED = 'wss://stream.binance.com:9443/stream'
const BINANCE_REST = 'https://api.binance.com/api/v3'
const FETCH_LIMIT = 300

// ── Symbol mapping ────────────────────────────────────────────────
type BinancePair = 'XAUTUSDT' | 'BTCUSDT' | 'GBPUSDT' | 'USDJPY'

function toBinancePair(symbol: string): BinancePair | null {
  switch (symbol) {
    case 'frxXAUUSD': return 'XAUTUSDT'
    case 'cryBTCUSD': return 'BTCUSDT'
    case 'frxGBPUSD': return 'GBPUSDT'
    case 'frxUSDJPY': return 'USDJPY'
    default: return null
  }
}

function getBinanceInterval(tf: number): string {
  return { 60: '1m', 300: '5m', 900: '15m', 3600: '1h', 14400: '4h', 86400: '1d' }[tf] ?? '1m'
}

// ── LiveUpdate payload ────────────────────────────────────────────
export interface LiveUpdate {
  symbol: string
  timeframe: number
  bar: OHLCBar
  isClosed: boolean
}

// ── Unified Binance Stream ──────────────────────────────────────────
// Uses combined stream endpoint for reliability: streams can be
// subscribed/unsubscribed without reconnecting, and Binance
// guarantees message ordering.
export class BinanceStream {
  private ws: WebSocket | null = null
  private pair: BinancePair | null = null
  private timeframe = 60
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private isDestroyed = false
  private shouldReconnect = true
  private connectionTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private subscribedStreams = new Set<string>()

  // Event callbacks
  private onBarCb: ((u: LiveUpdate) => void) | null = null
  private onPriceCb: ((price: number) => void) | null = null
  private onConnectCb: (() => void) | null = null
  private onDisconnectCb: (() => void) | null = null
  private onErrorCb: ((msg: string) => void) | null = null
  private onDataCb: (() => void) | null = null

  // Track when we last received data
  private lastDataAt = 0
  private lastDataTimer: ReturnType<typeof setInterval> | null = null

  // ── Event registration ───────────────────────────────────────
  on(event: 'bar', cb: (u: LiveUpdate) => void): void { this.onBarCb = cb }
  onPrice(cb: (price: number) => void): void { this.onPriceCb = cb }
  onConnect(cb: () => void): void { this.onConnectCb = cb }
  onDisconnect(cb: () => void): void { this.onDisconnectCb = cb }
  onError(cb: (msg: string) => void): void { this.onErrorCb = cb }
  onData(cb: () => void): void { this.onDataCb = cb }

  // ── Connect ──────────────────────────────────────────────────
  connect(symbol: string, timeframe: number): void {
    const pair = toBinancePair(symbol)
    if (!pair) {
      this.onErrorCb?.(`Unknown symbol: ${symbol}`)
      return
    }

    this.pair = pair
    this.timeframe = timeframe
    this.shouldReconnect = true
    this.reconnectDelay = 1000
    this.openSocket()
    this.startDataMonitor()
  }

  // ── Switch symbol/timeframe ────────────────────────────────────
  switchSymbol(symbol: string, timeframe: number): void {
    const pair = toBinancePair(symbol)
    if (!pair) return

    const pairChanged = this.pair !== pair
    const tfChanged = this.timeframe !== timeframe
    this.pair = pair
    this.timeframe = timeframe

    if (pairChanged || tfChanged) {
      this.safeClose()
      this.openSocket()
    }
  }

  // ── Monitor data flow ─────────────────────────────────────────
  private startDataMonitor(): void {
    this.lastDataTimer = setInterval(() => {
      const now = Date.now()
      // If no data received in 60 seconds and we should be connected, reconnect
      if (this.lastDataAt > 0 && this.ws?.readyState === WebSocket.OPEN) {
        if (now - this.lastDataAt > 60_000) {
          // Data seems stale — reconnect
          this.onErrorCb?.('No data received for 60s, reconnecting...')
          this.safeClose()
          this.scheduleReconnect()
        }
      }
    }, 30_000)
  }

  private recordData(): void {
    this.lastDataAt = Date.now()
    this.onDataCb?.()
    // Reset reconnect delay on successful data
    this.reconnectDelay = 1000
  }

  // ── Open WebSocket ────────────────────────────────────────────
  private openSocket(): void {
    if (this.isDestroyed || !this.shouldReconnect || !this.pair) return

    const klineInterval = getBinanceInterval(this.timeframe)
    const streams: string[] = [
      `${this.pair.toLowerCase()}@kline_${klineInterval}`,
      `${this.pair.toLowerCase()}@ticker`,
    ]
    const url = `${BINANCE_COMBINED}?streams=${streams.join('/')}`

    if (this.connectionTimer) clearTimeout(this.connectionTimer)
    this.connectionTimer = setTimeout(() => {
      if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
        this.onErrorCb?.('Connection timeout')
        this.safeClose()
        this.scheduleReconnect()
      }
    }, 8000)

    try {
      this.ws = new WebSocket(url)
    } catch (e) {
      this.onErrorCb?.('Failed to create WebSocket')
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      if (this.connectionTimer) { clearTimeout(this.connectionTimer); this.connectionTimer = null }
      this.onConnectCb?.()
      this.startPing()
    }

    this.ws.onmessage = (event) => {
      this.recordData()
      try {
        const msg = JSON.parse(event.data as string)
        const streams = msg.stream as string | undefined
        const data = msg.data

        if (!data) return

        // Kline (candlestick) stream
        if (data.e === 'kline' && data.k) {
          const k = data.k
          const barTime = Math.floor(Number(k.t) / 1000)
          this.onBarCb?.({
            symbol: this.pair ?? '',
            timeframe: this.timeframe,
            bar: {
              time: barTime,
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
            },
            isClosed: k.x,
          })
        }

        // Ticker stream (for USDJPY fallback and live price)
        if (data.e === '24hrTicker' && data.c) {
          this.onPriceCb?.(parseFloat(data.c))
        }
      } catch {
        // ignore parse errors
      }
    }

    this.ws.onerror = () => {
      this.onErrorCb?.('WebSocket error')
    }

    this.ws.onclose = () => {
      if (this.connectionTimer) { clearTimeout(this.connectionTimer); this.connectionTimer = null }
      this.stopPing()
      this.onDisconnectCb?.()
      // Always reconnect unless explicitly destroyed
      if (this.shouldReconnect && !this.isDestroyed) {
        this.scheduleReconnect()
      }
    }
  }

  private safeClose(): void {
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onclose = null
      try { this.ws.close(1000, 'Normal closure') } catch { /* noop */ }
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed || !this.shouldReconnect) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    // Exponential backoff, capped at 30s
    const delay = Math.min(this.reconnectDelay, 30_000)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay)
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Binance combined stream doesn't require ping frames;
        // sending a pong keeps the connection alive through proxies
        try { this.ws.send(JSON.stringify({ method: 'PING' })) } catch { /* noop */ }
      }
    }, 25_000)
  }

  private stopPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
  }

  destroy(): void {
    this.isDestroyed = true
    this.shouldReconnect = false
    if (this.connectionTimer) { clearTimeout(this.connectionTimer); this.connectionTimer = null }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.lastDataTimer) { clearInterval(this.lastDataTimer); this.lastDataTimer = null }
    this.safeClose()
    this.stopPing()
  }
}

// ── REST historical bars ──────────────────────────────────────────
export async function fetchHistoricalBars(symbol: string, timeframe: number): Promise<{ bars: OHLCBar[]; fetchAt: number }> {
  const pair = toBinancePair(symbol)
  if (!pair) return { bars: [], fetchAt: 0 }

  const targetDuration = 15 * 24 * 60 * 60 // 15 days in seconds
  const maxBars = 25000 // safe absolute limit for lightweight-charts and memory
  let allBars: OHLCBar[] = []
  let endTime: number | null = null
  const interval = getBinanceInterval(timeframe)

  try {
    while (true) {
      const limit = 1000
      let url = `${BINANCE_REST}/klines?symbol=${pair}&interval=${interval}&limit=${limit}`
      if (endTime !== null) {
        url += `&endTime=${endTime}`
      }

      const r = await fetch(url)
      if (!r.ok) break
      const data: string[][] = await r.json()
      if (data.length === 0) break

      const fetchedBars = data.map((k) => ({
        time: Math.floor(Number(k[0]) / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
      }))

      allBars = [...fetchedBars, ...allBars]

      const firstBar = allBars[0]
      const lastBar = allBars[allBars.length - 1]
      const durationCovered = lastBar.time - firstBar.time

      if (durationCovered >= targetDuration || allBars.length >= maxBars || data.length < limit) {
        break
      }

      endTime = Number(data[0][0]) - 1
    }

    // De-duplicate just in case
    const seen = new Set<number>()
    const uniqueBars = allBars.filter((b) => {
      if (seen.has(b.time)) return false
      seen.add(b.time)
      return true
    })

    return { bars: uniqueBars, fetchAt: Date.now() }
  } catch {
    return { bars: [], fetchAt: 0 }
  }
}
