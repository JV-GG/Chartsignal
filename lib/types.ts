export interface OHLCBar {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export type SignalEvent = 'ENTRY' | 'SL' | 'TP'

export interface SignalPoint {
  time: number
  type: 'BUY' | 'SELL'
  event: SignalEvent
  price: number
  stopLoss?: number
  takeProfit?: number
}

export interface ActivePosition {
  type: 'BUY' | 'SELL'
  entry: number
  sl: number
  tp: number
}

export interface IndicatorSettings {
  emaFastLen: number
  emaSlowLen: number
  atrLen: number
  atrMultSL: number
  riskReward: number
  confirmCandle: boolean
  showFastEMA: boolean
  showSlowEMA: boolean
}
