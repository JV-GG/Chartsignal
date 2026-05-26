export interface OHLCBar {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export interface SignalPoint {
  time: number
  type: 'BUY' | 'SELL'
  price: number
  stopLoss: number
  takeProfit: number
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
