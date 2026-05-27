import { OHLCBar, IndicatorSettings, SignalPoint, ActivePosition } from './types'

export function calcEMA(data: number[], period: number): number[] {
  const result: number[] = []
  const k = 2 / (period + 1)

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(data[0])
    } else if (i < period - 1) {
      let sum = 0
      for (let j = 0; j <= i; j++) sum += data[j]
      result.push(sum / (i + 1))
    } else if (i === period - 1) {
      let sum = 0
      for (let j = 0; j < period; j++) sum += data[j]
      result.push(sum / period)
    } else {
      result.push(data[i] * k + result[i - 1] * (1 - k))
    }
  }
  return result
}

export function calcATR(bars: OHLCBar[], period: number): number[] {
  const trs: number[] = []
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      trs.push(bars[i].high - bars[i].low)
    } else {
      const hl = bars[i].high - bars[i].low
      const hc = Math.abs(bars[i].high - bars[i - 1].close)
      const lc = Math.abs(bars[i].low - bars[i - 1].close)
      trs.push(Math.max(hl, hc, lc))
    }
  }
  return calcEMA(trs, period)
}

export function calcIndicators(bars: OHLCBar[], settings: IndicatorSettings) {
  const minBars = Math.max(settings.emaSlowLen, settings.atrLen)
  if (bars.length < minBars) return null

  const closes = bars.map((b) => b.close)
  const rawFast = calcEMA(closes, settings.emaFastLen)
  const rawSlow = calcEMA(closes, settings.emaSlowLen)
  const atr = calcATR(bars, settings.atrLen)

  const emaFast: (number | null)[] = []
  const emaSlow: (number | null)[] = []

  for (let i = 0; i < bars.length; i++) {
    emaFast.push(i < settings.emaFastLen - 1 ? null : rawFast[i])
    emaSlow.push(i < settings.emaSlowLen - 1 ? null : rawSlow[i])
  }

  return { emaFast, emaSlow, atr }
}

export interface SignalResult {
  events: SignalPoint[]
  position: ActivePosition | null
}

export function calcSignalsWithPosition(
  bars: OHLCBar[],
  settings: IndicatorSettings,
  prevPosition: ActivePosition | null,
  indicators: { emaFast: (number | null)[]; emaSlow: (number | null)[]; atr: number[] }
): SignalResult {
  const { emaFast, emaSlow, atr } = indicators
  const events: SignalPoint[] = []
  let position: ActivePosition | null = prevPosition ? { ...prevPosition } : null

  for (let i = 1; i < bars.length; i++) {
    if (emaFast[i] === null || emaSlow[i] === null) continue

    const bullTrend = emaFast[i]! > emaSlow[i]!
    const prevBullTrend = emaFast[i - 1]! > emaSlow[i - 1]!

    if (position) {
      const hitSl = position.type === 'BUY'
        ? bars[i].low <= position.sl
        : bars[i].high >= position.sl
      const hitTp = position.type === 'BUY'
        ? bars[i].high >= position.tp
        : bars[i].low <= position.tp

      if (hitSl) {
        events.push({ time: bars[i].time, type: position.type, event: 'SL', price: position.sl })
        position = null
      } else if (hitTp) {
        events.push({ time: bars[i].time, type: position.type, event: 'TP', price: position.tp })
        position = null
      }
    }

    if (!position) {
      const trendChange = bullTrend !== prevBullTrend
      const bullCandle = !settings.confirmCandle || bars[i].close > bars[i].open
      const bearCandle = !settings.confirmCandle || bars[i].close < bars[i].open

      if (trendChange && bullTrend && bullCandle) {
        const entry = bars[i].close
        const sl = bars[i].low - atr[i]! * settings.atrMultSL
        const risk = entry - sl
        const tp = entry + risk * settings.riskReward
        events.push({ time: bars[i].time, type: 'BUY', event: 'ENTRY', price: entry, stopLoss: sl, takeProfit: tp })
        position = { type: 'BUY', entry, sl, tp }
      } else if (trendChange && !bullTrend && bearCandle) {
        const entry = bars[i].close
        const sl = bars[i].high + atr[i]! * settings.atrMultSL
        const risk = sl - entry
        const tp = entry - risk * settings.riskReward
        events.push({ time: bars[i].time, type: 'SELL', event: 'ENTRY', price: entry, stopLoss: sl, takeProfit: tp })
        position = { type: 'SELL', entry, sl, tp }
      }
    }
  }

  return { events, position }
}
