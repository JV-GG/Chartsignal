import { OHLCBar } from './types'

const BINANCE_KLINE = 'https://api.binance.com/api/v3/klines'
const CRYPTOCOMPARE_PRICE = 'https://min-api.cryptocompare.com/data/price'
const POLL_INTERVAL = 1000
const FETCH_LIMIT = 300

interface CacheEntry {
  bars: OHLCBar[]
  fetchedAt: number
}

function binanceKlineToOHLC(k: string[]): OHLCBar {
  return {
    time: Math.floor(Number(k[0]) / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
  }
}

function getBinanceSymbol(symbol: string): string | null {
  switch (symbol) {
    case 'frxXAUUSD': return 'XAUTUSDT'
    case 'cryBTCUSD': return 'BTCUSDT'
    case 'frxGBPUSD': return 'GBPUSDT'
    default: return null
  }
}

function getBinanceInterval(timeframeSeconds: number): string {
  const map: Record<number, string> = {
    60: '1m', 300: '5m', 900: '15m',
    3600: '1h', 14400: '4h', 86400: '1d',
  }
  return map[timeframeSeconds] ?? '1m'
}

export class LivePriceService {
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private callbacks: Map<string, (bars: OHLCBar[]) => void> = new Map()
  private updateCallbacks: Map<string, (bar: OHLCBar) => void> = new Map()
  private currentSymbol = ''
  private currentTimeframe = 60
  private currentBars: OHLCBar[] = []
  private lastCandleTime = 0

  private cache: Map<string, CacheEntry> = new Map()
  private cacheTTL = 60_000

  private cacheKey(symbol: string, tf: number) {
    return `${symbol}:${tf}`
  }

  private getCached(symbol: string, tf: number): OHLCBar[] | null {
    const entry = this.cache.get(this.cacheKey(symbol, tf))
    if (!entry) return null
    if (Date.now() - entry.fetchedAt > this.cacheTTL) {
      this.cache.delete(this.cacheKey(symbol, tf))
      return null
    }
    return entry.bars
  }

  private setCached(symbol: string, tf: number, bars: OHLCBar[]) {
    this.cache.set(this.cacheKey(symbol, tf), { bars, fetchedAt: Date.now() })
  }

  async fetchBars(symbol: string, timeframe: number): Promise<OHLCBar[]> {
    this.currentSymbol = symbol
    this.currentTimeframe = timeframe
    this.currentBars = []
    this.lastCandleTime = 0

    const cached = this.getCached(symbol, timeframe)
    if (cached && cached.length > 0) {
      this.currentBars = cached
      this.lastCandleTime = cached[cached.length - 1].time
      return cached
    }

    const binSymbol = getBinanceSymbol(symbol)
    if (binSymbol) {
      try {
        const url = `${BINANCE_KLINE}?symbol=${binSymbol}&interval=${getBinanceInterval(timeframe)}&limit=${FETCH_LIMIT}`
        const r = await fetch(url)
        if (!r.ok) return []
        const data: string[][] = await r.json()
        const bars = data.map(binanceKlineToOHLC)
        this.currentBars = bars
        if (bars.length > 0) this.lastCandleTime = bars[bars.length - 1].time
        this.setCached(symbol, timeframe, bars)
        return bars
      } catch {
        return []
      }
    }

    if (symbol === 'frxUSDJPY') {
      try {
        const r = await fetch(`${CRYPTOCOMPARE_PRICE}?fsym=USD&tsyms=JPY`)
        if (!r.ok) return []
        const data: Record<string, number> = await r.json()
        const price = data['JPY']
        if (!price) return []

        const now = Math.floor(Date.now() / 1000)
        const bars: OHLCBar[] = []
        for (let i = FETCH_LIMIT - 1; i >= 0; i--) {
          const t = Math.floor((now - i * timeframe) / timeframe) * timeframe
          bars.push({ time: t, open: price, high: price, low: price, close: price })
        }
        this.currentBars = bars
        if (bars.length > 0) this.lastCandleTime = bars[bars.length - 1].time
        this.setCached(symbol, timeframe, bars)
        return bars
      } catch {
        return []
      }
    }

    return []
  }

  refreshBars(symbol: string, timeframe: number): Promise<OHLCBar[]> {
    const binSymbol = getBinanceSymbol(symbol)
    if (!binSymbol) return Promise.resolve([])

    return (async () => {
      try {
        const url = `${BINANCE_KLINE}?symbol=${binSymbol}&interval=${getBinanceInterval(timeframe)}&limit=${FETCH_LIMIT}`
        const r = await fetch(url)
        if (!r.ok) return []
        const data: string[][] = await r.json()
        const bars = data.map(binanceKlineToOHLC)
        this.setCached(symbol, timeframe, bars)
        return bars
      } catch {
        return []
      }
    })()
  }

  private async pollTick(): Promise<void> {
    const binSymbol = getBinanceSymbol(this.currentSymbol)

    if (binSymbol) {
      await this.pollBinance(binSymbol)
    } else if (this.currentSymbol === 'frxUSDJPY') {
      await this.pollCryptoCompare()
    }

    if (this.pollTimer !== null) {
      this.pollTimer = setTimeout(() => this.pollTick(), POLL_INTERVAL)
    }
  }

  private async pollBinance(binSymbol: string): Promise<void> {
    try {
      const url = `${BINANCE_KLINE}?symbol=${binSymbol}&interval=${getBinanceInterval(this.currentTimeframe)}&limit=2`
      const r = await fetch(url)
      if (!r.ok) return
      const data: string[][] = await r.json()
      if (data.length === 0) return

      const latest = binanceKlineToOHLC(data[data.length - 1])
      const prev = data.length > 1 ? binanceKlineToOHLC(data[data.length - 2]) : null

      if (this.lastCandleTime === 0) {
        if (this.currentBars.length > 0) {
          this.lastCandleTime = this.currentBars[this.currentBars.length - 1].time
        }
      }

      if (prev && this.lastCandleTime > 0 && prev.time >= this.lastCandleTime) {
        const idx = this.currentBars.findIndex((b) => b.time === prev.time)
        if (idx >= 0) {
          this.currentBars[idx] = prev
        } else {
          this.currentBars.push(prev)
          this.currentBars = this.currentBars.slice(-FETCH_LIMIT)
        }
        const cb = this.callbacks.get(this.currentSymbol)
        if (cb) cb([...this.currentBars])
      }

      if (latest.time === this.lastCandleTime) {
        const lastBar = this.currentBars[this.currentBars.length - 1]
        if (lastBar) {
          lastBar.close = latest.close
          lastBar.high = Math.max(lastBar.high, latest.high)
          lastBar.low = Math.min(lastBar.low, latest.low)
          const cb = this.updateCallbacks.get(this.currentSymbol)
          if (cb) cb({ ...lastBar })
        }
      } else if (latest.time > this.lastCandleTime) {
        this.currentBars.push(latest)
        this.currentBars = this.currentBars.slice(-FETCH_LIMIT)
        this.lastCandleTime = latest.time
        const cb = this.callbacks.get(this.currentSymbol)
        if (cb) cb([...this.currentBars])
      }
    } catch {
      // silent
    }
  }

  private async pollCryptoCompare(): Promise<void> {
    try {
      const r = await fetch(`${CRYPTOCOMPARE_PRICE}?fsym=USD&tsyms=JPY`)
      if (!r.ok) return
      const data: Record<string, number> = await r.json()
      const price = data['JPY']
      if (!price) return

      const now = Math.floor(Date.now() / 1000)
      const tf = this.currentTimeframe
      const candleTime = Math.floor(now / tf) * tf

      if (this.lastCandleTime === 0 && this.currentBars.length > 0) {
        this.lastCandleTime = this.currentBars[this.currentBars.length - 1].time
      }

      if (candleTime === this.lastCandleTime) {
        const lastBar = this.currentBars[this.currentBars.length - 1]
        if (lastBar) {
          lastBar.close = price
          lastBar.high = Math.max(lastBar.high, price)
          lastBar.low = Math.min(lastBar.low, price)
          const cb = this.updateCallbacks.get(this.currentSymbol)
          if (cb) cb({ ...lastBar })
        }
      } else if (candleTime > this.lastCandleTime) {
        this.currentBars.push({ time: candleTime, open: price, high: price, low: price, close: price })
        this.currentBars = this.currentBars.slice(-FETCH_LIMIT)
        this.lastCandleTime = candleTime
        const cb = this.callbacks.get(this.currentSymbol)
        if (cb) cb([...this.currentBars])
      }
    } catch {
      // silent
    }
  }

  subscribe(
    symbol: string,
    timeframe: number,
    onBars: (bars: OHLCBar[]) => void,
    onUpdate?: (bar: OHLCBar) => void
  ): () => void {
    this.currentSymbol = symbol
    this.currentTimeframe = timeframe
    this.callbacks.set(symbol, onBars)
    if (onUpdate) this.updateCallbacks.set(symbol, onUpdate)

    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
    }
    this.pollTimer = setTimeout(() => this.pollTick(), POLL_INTERVAL)

    return () => {
      this.callbacks.delete(symbol)
      this.updateCallbacks.delete(symbol)
      if (this.pollTimer) {
        clearTimeout(this.pollTimer)
        this.pollTimer = null
      }
    }
  }

  destroy(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    this.callbacks.clear()
    this.updateCallbacks.clear()
    this.currentBars = []
  }
}
