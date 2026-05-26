import { OHLCBar } from './types'

const WS_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=1089'
const MAX_RETRIES = 5

export class DerivWS {
  private ws: WebSocket | null = null
  private retryCount = 0
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  private pendingRequests: Map<string, (data: unknown) => void> = new Map()
  private liveSubscriptions: Map<string, (bar: OHLCBar) => void> = new Map()

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      try {
        this.ws = new WebSocket(WS_URL)

        this.ws.onopen = () => {
          this.retryCount = 0
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            if (msg.req_id && this.pendingRequests.has(msg.req_id)) {
              const resolver = this.pendingRequests.get(msg.req_id)!
              this.pendingRequests.delete(msg.req_id)
              resolver(msg)
            } else if (msg.ohlc) {
              this.liveSubscriptions.forEach((cb) => {
                const bar = this.parseOHLC(msg.ohlc)
                if (bar) cb(bar)
              })
            }
          } catch {
            // ignore parse errors
          }
        }

        this.ws.onclose = () => {
          this.handleDisconnect()
        }

        this.ws.onerror = () => {
          if (this.retryCount === 0) {
            reject(new Error('WebSocket connection failed'))
          }
        }
      } catch (err) {
        reject(err)
      }
    })
  }

  private handleDisconnect(): void {
    if (this.retryCount < MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000)
      this.retryCount++
      this.retryTimeout = setTimeout(() => {
        this.connect().catch(() => {
          // reconnect attempt logged internally
        })
      }, delay)
    }
  }

  private send(data: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'))
        return
      }
      const reqId = Date.now().toString()
      const payload = { ...data, req_id: reqId }
      this.pendingRequests.set(reqId, resolve as (data: unknown) => void)
      this.ws.send(JSON.stringify(payload))
    })
  }

  subscribeCandles(
    symbol: string,
    granularity: number,
    onBar: (bar: OHLCBar) => void
  ): Promise<OHLCBar[]> {
    this.liveSubscriptions.set(symbol, onBar)

    return this.send({
      ticks_history: symbol,
      style: 'candles',
      granularity,
      count: 500,
      subscribe: 1,
    }).then((msg) => {
      const data = msg as { candles?: Record<string, string | number>[] }
      if (data.candles && Array.isArray(data.candles)) {
        return this.parseHistory(data.candles)
      }
      return []
    }) as Promise<OHLCBar[]>
  }

  unsubscribe(): void {
    this.liveSubscriptions.clear()
    if (this.ws) {
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }
  }

  private parseOHLC(ohlc: Record<string, string | number>): OHLCBar | null {
    const open = parseFloat(String(ohlc.open))
    const high = parseFloat(String(ohlc.high))
    const low = parseFloat(String(ohlc.low))
    const close = parseFloat(String(ohlc.close))
    const time = Number(ohlc.epoch)

    if ([open, high, low, close, time].some(isNaN)) return null

    return { time, open, high, low, close }
  }

  parseHistory(candles: Record<string, string | number>[]): OHLCBar[] {
    return candles
      .map((c) => this.parseOHLC(c))
      .filter((bar): bar is OHLCBar => bar !== null)
      .sort((a, b) => a.time - b.time)
  }
}
