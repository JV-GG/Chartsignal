import { OHLCBar, IndicatorSettings, SignalPoint } from './types'

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

export function calcSignals(
  bars: OHLCBar[],
  settings: IndicatorSettings
): {
  emaFast: (number | null)[]
  emaSlow: (number | null)[]
  signals: SignalPoint[]
} {
  if (bars.length < Math.max(settings.emaSlowLen, settings.atrLen)) {
    return {
      emaFast: new Array(bars.length).fill(null),
      emaSlow: new Array(bars.length).fill(null),
      signals: [],
    }
  }

  const closes = bars.map((b) => b.close)
  const rawFast = calcEMA(closes, settings.emaFastLen)
  const rawSlow = calcEMA(closes, settings.emaSlowLen)
  const atr = calcATR(bars, settings.atrLen)

  const emaFast: (number | null)[] = []
  const emaSlow: (number | null)[] = []

  for (let i = 0; i < bars.length; i++) {
    if (i < settings.emaFastLen - 1) {
      emaFast.push(null)
    } else {
      emaFast.push(rawFast[i])
    }

    if (i < settings.emaSlowLen - 1) {
      emaSlow.push(null)
    } else {
      emaSlow.push(rawSlow[i])
    }
  }

  const signals: SignalPoint[] = []
  let positionOpen: 'BUY' | 'SELL' | null = null

  for (let i = 1; i < bars.length; i++) {
    if (emaFast[i] === null || emaSlow[i] === null) continue
    if (emaFast[i - 1] === null || emaSlow[i - 1] === null) continue

    const fastVal = emaFast[i]!
    const slowVal = emaSlow[i]!
    const prevFastVal = emaFast[i - 1]!
    const prevSlowVal = emaSlow[i - 1]!
    const bullTrend = fastVal > slowVal
    const prevBullTrend = prevFastVal > prevSlowVal
    const trendChange = bullTrend !== prevBullTrend

    const buyCondition =
      bullTrend &&
      trendChange &&
      (!settings.confirmCandle || bars[i].close > bars[i].open)

    const sellCondition =
      !bullTrend &&
      trendChange &&
      (!settings.confirmCandle || bars[i].close < bars[i].open)

    if (buyCondition && positionOpen !== 'BUY') {
      const entry = bars[i].close
      const sl = bars[i].low - atr[i]! * settings.atrMultSL
      const risk = entry - sl
      const tp = entry + risk * settings.riskReward
      signals.push({
        time: bars[i].time,
        type: 'BUY',
        price: entry,
        stopLoss: sl,
        takeProfit: tp,
      })
      positionOpen = 'BUY'
    } else if (sellCondition && positionOpen !== 'SELL') {
      const entry = bars[i].close
      const sl = bars[i].high + atr[i]! * settings.atrMultSL
      const risk = sl - entry
      const tp = entry - risk * settings.riskReward
      signals.push({
        time: bars[i].time,
        type: 'SELL',
        price: entry,
        stopLoss: sl,
        takeProfit: tp,
      })
      positionOpen = 'SELL'
    }
  }

  return { emaFast, emaSlow, signals }
}
