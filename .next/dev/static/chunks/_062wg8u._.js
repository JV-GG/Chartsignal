(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/lib/indicators.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "calcATR",
    ()=>calcATR,
    "calcEMA",
    ()=>calcEMA,
    "calcSignals",
    ()=>calcSignals
]);
function calcEMA(data, period) {
    const result = [];
    const k = 2 / (period + 1);
    for(let i = 0; i < data.length; i++){
        if (i === 0) {
            result.push(data[0]);
        } else if (i < period - 1) {
            let sum = 0;
            for(let j = 0; j <= i; j++)sum += data[j];
            result.push(sum / (i + 1));
        } else if (i === period - 1) {
            let sum = 0;
            for(let j = 0; j < period; j++)sum += data[j];
            result.push(sum / period);
        } else {
            result.push(data[i] * k + result[i - 1] * (1 - k));
        }
    }
    return result;
}
function calcATR(bars, period) {
    const trs = [];
    for(let i = 0; i < bars.length; i++){
        if (i === 0) {
            trs.push(bars[i].high - bars[i].low);
        } else {
            const hl = bars[i].high - bars[i].low;
            const hc = Math.abs(bars[i].high - bars[i - 1].close);
            const lc = Math.abs(bars[i].low - bars[i - 1].close);
            trs.push(Math.max(hl, hc, lc));
        }
    }
    return calcEMA(trs, period);
}
function calcSignals(bars, settings) {
    if (bars.length < Math.max(settings.emaSlowLen, settings.atrLen)) {
        return {
            emaFast: new Array(bars.length).fill(null),
            emaSlow: new Array(bars.length).fill(null),
            signals: []
        };
    }
    const closes = bars.map((b)=>b.close);
    const rawFast = calcEMA(closes, settings.emaFastLen);
    const rawSlow = calcEMA(closes, settings.emaSlowLen);
    const atr = calcATR(bars, settings.atrLen);
    const emaFast = [];
    const emaSlow = [];
    for(let i = 0; i < bars.length; i++){
        if (i < settings.emaFastLen - 1) {
            emaFast.push(null);
        } else {
            emaFast.push(rawFast[i]);
        }
        if (i < settings.emaSlowLen - 1) {
            emaSlow.push(null);
        } else {
            emaSlow.push(rawSlow[i]);
        }
    }
    const signals = [];
    let positionOpen = null;
    for(let i = 1; i < bars.length; i++){
        if (emaFast[i] === null || emaSlow[i] === null) continue;
        if (emaFast[i - 1] === null || emaSlow[i - 1] === null) continue;
        const fastVal = emaFast[i];
        const slowVal = emaSlow[i];
        const prevFastVal = emaFast[i - 1];
        const prevSlowVal = emaSlow[i - 1];
        const bullTrend = fastVal > slowVal;
        const prevBullTrend = prevFastVal > prevSlowVal;
        const trendChange = bullTrend !== prevBullTrend;
        const buyCondition = bullTrend && trendChange && (!settings.confirmCandle || bars[i].close > bars[i].open);
        const sellCondition = !bullTrend && trendChange && (!settings.confirmCandle || bars[i].close < bars[i].open);
        if (buyCondition && positionOpen !== 'BUY') {
            const entry = bars[i].close;
            const sl = bars[i].low - atr[i] * settings.atrMultSL;
            const risk = entry - sl;
            const tp = entry + risk * settings.riskReward;
            signals.push({
                time: bars[i].time,
                type: 'BUY',
                price: entry,
                stopLoss: sl,
                takeProfit: tp
            });
            positionOpen = 'BUY';
        } else if (sellCondition && positionOpen !== 'SELL') {
            const entry = bars[i].close;
            const sl = bars[i].high + atr[i] * settings.atrMultSL;
            const risk = sl - entry;
            const tp = entry - risk * settings.riskReward;
            signals.push({
                time: bars[i].time,
                type: 'SELL',
                price: entry,
                stopLoss: sl,
                takeProfit: tp
            });
            positionOpen = 'SELL';
        }
    }
    return {
        emaFast,
        emaSlow,
        signals
    };
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/deriv.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DerivWS",
    ()=>DerivWS
]);
const WS_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=1089';
const MAX_RETRIES = 5;
class DerivWS {
    ws = null;
    retryCount = 0;
    retryTimeout = null;
    pendingRequests = new Map();
    liveSubscriptions = new Map();
    connect() {
        return new Promise((resolve, reject)=>{
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }
            try {
                this.ws = new WebSocket(WS_URL);
                this.ws.onopen = ()=>{
                    this.retryCount = 0;
                    resolve();
                };
                this.ws.onmessage = (event)=>{
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.req_id && this.pendingRequests.has(msg.req_id)) {
                            const resolver = this.pendingRequests.get(msg.req_id);
                            this.pendingRequests.delete(msg.req_id);
                            resolver(msg);
                        } else if (msg.ohlc) {
                            this.liveSubscriptions.forEach((cb)=>{
                                const bar = this.parseOHLC(msg.ohlc);
                                if (bar) cb(bar);
                            });
                        }
                    } catch  {
                    // ignore parse errors
                    }
                };
                this.ws.onclose = ()=>{
                    this.handleDisconnect();
                };
                this.ws.onerror = ()=>{
                    if (this.retryCount === 0) {
                        reject(new Error('WebSocket connection failed'));
                    }
                };
            } catch (err) {
                reject(err);
            }
        });
    }
    handleDisconnect() {
        if (this.retryCount < MAX_RETRIES) {
            const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
            this.retryCount++;
            this.retryTimeout = setTimeout(()=>{
                this.connect().catch(()=>{
                // reconnect attempt logged internally
                });
            }, delay);
        }
    }
    send(data) {
        return new Promise((resolve, reject)=>{
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not connected'));
                return;
            }
            const reqId = Date.now().toString();
            const payload = {
                ...data,
                req_id: reqId
            };
            this.pendingRequests.set(reqId, resolve);
            this.ws.send(JSON.stringify(payload));
        });
    }
    subscribeCandles(symbol, granularity, onBar) {
        this.liveSubscriptions.set(symbol, onBar);
        return this.send({
            ticks_history: symbol,
            style: 'candles',
            granularity,
            count: 500,
            subscribe: 1
        }).then((msg)=>{
            const data = msg;
            if (data.candles && Array.isArray(data.candles)) {
                return this.parseHistory(data.candles);
            }
            return [];
        });
    }
    unsubscribe() {
        this.liveSubscriptions.clear();
        if (this.ws) {
            this.ws.onmessage = null;
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }
    }
    parseOHLC(ohlc) {
        const open = parseFloat(String(ohlc.open));
        const high = parseFloat(String(ohlc.high));
        const low = parseFloat(String(ohlc.low));
        const close = parseFloat(String(ohlc.close));
        const time = Number(ohlc.epoch);
        if ([
            open,
            high,
            low,
            close,
            time
        ].some(isNaN)) return null;
        return {
            time,
            open,
            high,
            low,
            close
        };
    }
    parseHistory(candles) {
        return candles.map((c)=>this.parseOHLC(c)).filter((bar)=>bar !== null).sort((a, b)=>a.time - b.time);
    }
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/components/IndicatorPanel.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>IndicatorPanel
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
'use client';
;
function IndicatorPanel({ open, settings, onChange, onClose }) {
    const update = (key, value)=>{
        onChange({
            ...settings,
            [key]: value
        });
    };
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
        children: [
            open && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "fixed inset-0 z-30 bg-black/40",
                onClick: onClose
            }, void 0, false, {
                fileName: "[project]/components/IndicatorPanel.tsx",
                lineNumber: 20,
                columnNumber: 9
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: `fixed top-0 right-0 h-full w-72 bg-[#0f0f0f] border-l border-[#2a2a3e] z-40 transform transition-transform duration-200 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-center justify-between px-4 py-3 border-b border-[#2a2a3e]",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "text-sm font-medium text-white",
                                children: "Indicator Settings"
                            }, void 0, false, {
                                fileName: "[project]/components/IndicatorPanel.tsx",
                                lineNumber: 32,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                onClick: onClose,
                                className: "p-1 rounded hover:bg-[#1a1a2e] text-gray-400 hover:text-white transition-colors",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("svg", {
                                    width: "16",
                                    height: "16",
                                    viewBox: "0 0 24 24",
                                    fill: "none",
                                    stroke: "currentColor",
                                    strokeWidth: "2",
                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                        d: "M18 6L6 18M6 6l12 12"
                                    }, void 0, false, {
                                        fileName: "[project]/components/IndicatorPanel.tsx",
                                        lineNumber: 38,
                                        columnNumber: 15
                                    }, this)
                                }, void 0, false, {
                                    fileName: "[project]/components/IndicatorPanel.tsx",
                                    lineNumber: 37,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/components/IndicatorPanel.tsx",
                                lineNumber: 33,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/IndicatorPanel.tsx",
                        lineNumber: 31,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "p-4 space-y-5 overflow-y-auto h-full pb-8",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Section, {
                                title: "EMA",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Toggle, {
                                        label: "Show Fast EMA",
                                        checked: settings.showFastEMA,
                                        onChange: (v)=>update('showFastEMA', v)
                                    }, void 0, false, {
                                        fileName: "[project]/components/IndicatorPanel.tsx",
                                        lineNumber: 45,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Toggle, {
                                        label: "Show Slow EMA",
                                        checked: settings.showSlowEMA,
                                        onChange: (v)=>update('showSlowEMA', v)
                                    }, void 0, false, {
                                        fileName: "[project]/components/IndicatorPanel.tsx",
                                        lineNumber: 46,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(NumberInput, {
                                        label: "Fast Period",
                                        value: settings.emaFastLen,
                                        min: 2,
                                        max: 100,
                                        onChange: (v)=>update('emaFastLen', v)
                                    }, void 0, false, {
                                        fileName: "[project]/components/IndicatorPanel.tsx",
                                        lineNumber: 47,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(NumberInput, {
                                        label: "Slow Period",
                                        value: settings.emaSlowLen,
                                        min: 2,
                                        max: 200,
                                        onChange: (v)=>update('emaSlowLen', v)
                                    }, void 0, false, {
                                        fileName: "[project]/components/IndicatorPanel.tsx",
                                        lineNumber: 48,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/IndicatorPanel.tsx",
                                lineNumber: 44,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Section, {
                                title: "Risk Management",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(NumberInput, {
                                        label: "ATR Period",
                                        value: settings.atrLen,
                                        min: 1,
                                        max: 100,
                                        onChange: (v)=>update('atrLen', v)
                                    }, void 0, false, {
                                        fileName: "[project]/components/IndicatorPanel.tsx",
                                        lineNumber: 52,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(NumberInput, {
                                        label: "SL Multiplier",
                                        value: settings.atrMultSL,
                                        min: 0.1,
                                        max: 10,
                                        step: 0.1,
                                        onChange: (v)=>update('atrMultSL', v)
                                    }, void 0, false, {
                                        fileName: "[project]/components/IndicatorPanel.tsx",
                                        lineNumber: 53,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(NumberInput, {
                                        label: "Risk : Reward",
                                        value: settings.riskReward,
                                        min: 0.5,
                                        max: 20,
                                        step: 0.5,
                                        onChange: (v)=>update('riskReward', v)
                                    }, void 0, false, {
                                        fileName: "[project]/components/IndicatorPanel.tsx",
                                        lineNumber: 54,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/IndicatorPanel.tsx",
                                lineNumber: 51,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Section, {
                                title: "Signal",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Toggle, {
                                    label: "Require Candle Confirmation",
                                    checked: settings.confirmCandle,
                                    onChange: (v)=>update('confirmCandle', v)
                                }, void 0, false, {
                                    fileName: "[project]/components/IndicatorPanel.tsx",
                                    lineNumber: 58,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/components/IndicatorPanel.tsx",
                                lineNumber: 57,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/IndicatorPanel.tsx",
                        lineNumber: 43,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/IndicatorPanel.tsx",
                lineNumber: 26,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true);
}
_c = IndicatorPanel;
function Section({ title, children }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "space-y-3",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h3", {
                className: "text-xs font-semibold text-gray-500 uppercase tracking-wider",
                children: title
            }, void 0, false, {
                fileName: "[project]/components/IndicatorPanel.tsx",
                lineNumber: 69,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "space-y-3",
                children: children
            }, void 0, false, {
                fileName: "[project]/components/IndicatorPanel.tsx",
                lineNumber: 70,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/IndicatorPanel.tsx",
        lineNumber: 68,
        columnNumber: 5
    }, this);
}
_c1 = Section;
function Toggle({ label, checked, onChange }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
        className: "flex items-center justify-between cursor-pointer group",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "text-sm text-gray-300 group-hover:text-white transition-colors",
                children: label
            }, void 0, false, {
                fileName: "[project]/components/IndicatorPanel.tsx",
                lineNumber: 78,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                role: "switch",
                "aria-checked": checked,
                onClick: ()=>onChange(!checked),
                className: `relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-[#2a2a3e]'}`,
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                    className: `absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`
                }, void 0, false, {
                    fileName: "[project]/components/IndicatorPanel.tsx",
                    lineNumber: 87,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/components/IndicatorPanel.tsx",
                lineNumber: 79,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/IndicatorPanel.tsx",
        lineNumber: 77,
        columnNumber: 5
    }, this);
}
_c2 = Toggle;
function NumberInput({ label, value, min, max, step = 1, onChange }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex flex-col gap-1",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                className: "text-xs text-gray-500",
                children: label
            }, void 0, false, {
                fileName: "[project]/components/IndicatorPanel.tsx",
                lineNumber: 114,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                type: "number",
                value: value,
                min: min,
                max: max,
                step: step,
                onChange: (e)=>{
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v >= min && v <= max) onChange(v);
                },
                className: "w-full bg-[#1a1a2e] border border-[#2a2a3e] text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
            }, void 0, false, {
                fileName: "[project]/components/IndicatorPanel.tsx",
                lineNumber: 115,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/IndicatorPanel.tsx",
        lineNumber: 113,
        columnNumber: 5
    }, this);
}
_c3 = NumberInput;
var _c, _c1, _c2, _c3;
__turbopack_context__.k.register(_c, "IndicatorPanel");
__turbopack_context__.k.register(_c1, "Section");
__turbopack_context__.k.register(_c2, "Toggle");
__turbopack_context__.k.register(_c3, "NumberInput");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/components/TradingChart.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>TradingChart
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$indicators$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/indicators.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$deriv$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/deriv.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$IndicatorPanel$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/IndicatorPanel.tsx [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
'use client';
;
;
;
;
const SYMBOLS = [
    'frxXAUUSD',
    'frxGBPUSD',
    'frxUSDJPY',
    'cryBTCUSD'
];
const TIMEFRAMES = [
    {
        label: '1m',
        seconds: 60
    },
    {
        label: '5m',
        seconds: 300
    },
    {
        label: '15m',
        seconds: 900
    },
    {
        label: '1h',
        seconds: 3600
    },
    {
        label: '4h',
        seconds: 14400
    },
    {
        label: '1d',
        seconds: 86400
    }
];
const DEFAULT_SETTINGS = {
    emaFastLen: 5,
    emaSlowLen: 13,
    atrLen: 14,
    atrMultSL: 0.5,
    riskReward: 3.0,
    confirmCandle: true,
    showFastEMA: true,
    showSlowEMA: true
};
function TradingChart() {
    _s();
    const chartContainerRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const chartRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const candleSeriesRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const fastEMARef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const slowEMARef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const priceLinesRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])([]);
    const wsRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const barsRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])([]);
    const activeSignalRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const [symbol, setSymbol] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])('frxXAUUSD');
    const [timeframe, setTimeframe] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(60);
    const [settings, setSettings] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(DEFAULT_SETTINGS);
    const [showPanel, setShowPanel] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [connected, setConnected] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [activeSignal, setActiveSignal] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const TOOLBAR_HEIGHT = 52;
    const clearPriceLines = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TradingChart.useCallback[clearPriceLines]": ()=>{
            if (!chartRef.current) return;
            priceLinesRef.current.forEach({
                "TradingChart.useCallback[clearPriceLines]": (line)=>{
                    chartRef.current.removeSeries(line);
                }
            }["TradingChart.useCallback[clearPriceLines]"]);
            priceLinesRef.current = [];
        }
    }["TradingChart.useCallback[clearPriceLines]"], []);
    const renderIndicators = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TradingChart.useCallback[renderIndicators]": (bars)=>{
            if (!candleSeriesRef.current) return;
            const { emaFast, emaSlow, signals } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$indicators$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["calcSignals"])(bars, settings);
            if (fastEMARef.current) {
                fastEMARef.current.setData(emaFast.map({
                    "TradingChart.useCallback[renderIndicators]": (v, i)=>({
                            time: bars[i].time,
                            value: v
                        })
                }["TradingChart.useCallback[renderIndicators]"]).filter({
                    "TradingChart.useCallback[renderIndicators]": (p)=>p.value !== null
                }["TradingChart.useCallback[renderIndicators]"]));
            }
            if (slowEMARef.current) {
                slowEMARef.current.setData(emaSlow.map({
                    "TradingChart.useCallback[renderIndicators]": (v, i)=>({
                            time: bars[i].time,
                            value: v
                        })
                }["TradingChart.useCallback[renderIndicators]"]).filter({
                    "TradingChart.useCallback[renderIndicators]": (p)=>p.value !== null
                }["TradingChart.useCallback[renderIndicators]"]));
            }
            candleSeriesRef.current.setMarkers(signals.map({
                "TradingChart.useCallback[renderIndicators]": (s)=>({
                        time: s.time,
                        position: s.type === 'BUY' ? 'belowBar' : 'aboveBar',
                        color: s.type === 'BUY' ? '#22c55e' : '#ef4444',
                        shape: s.type === 'BUY' ? 'arrowUp' : 'arrowDown',
                        text: s.type
                    })
            }["TradingChart.useCallback[renderIndicators]"]));
            const lastSignal = signals[signals.length - 1] ?? null;
            activeSignalRef.current = lastSignal;
            setActiveSignal(lastSignal);
            clearPriceLines();
            if (lastSignal && chartRef.current) {
                const entryLine = chartRef.current.addLineSeries({
                    color: '#ffffff',
                    lineWidth: 1,
                    lineStyle: 2,
                    title: 'Entry'
                });
                entryLine.setData([
                    {
                        time: lastSignal.time,
                        value: lastSignal.price
                    },
                    {
                        time: lastSignal.time + 86400 * 30,
                        value: lastSignal.price
                    }
                ]);
                const slLine = chartRef.current.addLineSeries({
                    color: '#ef4444',
                    lineWidth: 1,
                    lineStyle: 0,
                    title: 'SL'
                });
                slLine.setData([
                    {
                        time: lastSignal.time,
                        value: lastSignal.stopLoss
                    },
                    {
                        time: lastSignal.time + 86400 * 30,
                        value: lastSignal.stopLoss
                    }
                ]);
                const tpLine = chartRef.current.addLineSeries({
                    color: '#22c55e',
                    lineWidth: 1,
                    lineStyle: 0,
                    title: 'TP'
                });
                tpLine.setData([
                    {
                        time: lastSignal.time,
                        value: lastSignal.takeProfit
                    },
                    {
                        time: lastSignal.time + 86400 * 30,
                        value: lastSignal.takeProfit
                    }
                ]);
                priceLinesRef.current = [
                    entryLine,
                    slLine,
                    tpLine
                ];
            }
        }
    }["TradingChart.useCallback[renderIndicators]"], [
        settings,
        clearPriceLines
    ]);
    const subscribe = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TradingChart.useCallback[subscribe]": async (sym, tf)=>{
            if (wsRef.current) {
                wsRef.current.unsubscribe();
            }
            const ws = new __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$deriv$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DerivWS"]();
            wsRef.current = ws;
            try {
                await ws.connect();
                setConnected(true);
                const history = await ws.subscribeCandles(sym, tf, {
                    "TradingChart.useCallback[subscribe]": (bar)=>{
                        if (!candleSeriesRef.current) return;
                        const existing = barsRef.current.findIndex({
                            "TradingChart.useCallback[subscribe].existing": (b)=>b.time === bar.time
                        }["TradingChart.useCallback[subscribe].existing"]);
                        if (existing >= 0) {
                            barsRef.current[existing] = bar;
                            candleSeriesRef.current.update({
                                time: bar.time,
                                open: bar.open,
                                high: bar.high,
                                low: bar.low,
                                close: bar.close
                            });
                        } else {
                            barsRef.current.push(bar);
                            barsRef.current = barsRef.current.slice(-2000);
                            renderIndicators(barsRef.current);
                        }
                    }
                }["TradingChart.useCallback[subscribe]"]);
                if (history.length > 0) {
                    barsRef.current = history;
                    if (candleSeriesRef.current) {
                        candleSeriesRef.current.setData(history.map({
                            "TradingChart.useCallback[subscribe]": (bar)=>({
                                    time: bar.time,
                                    open: bar.open,
                                    high: bar.high,
                                    low: bar.low,
                                    close: bar.close
                                })
                        }["TradingChart.useCallback[subscribe]"]));
                    }
                    renderIndicators(history);
                }
            } catch  {
                setConnected(false);
            }
        }
    }["TradingChart.useCallback[subscribe]"], [
        renderIndicators
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TradingChart.useEffect": ()=>{
            if (!chartContainerRef.current) return;
            let ro;
            let chart = null;
            let mounted = true;
            ({
                "TradingChart.useEffect": async ()=>{
                    const { createChart, CrosshairMode } = await __turbopack_context__.A("[project]/node_modules/lightweight-charts/dist/lightweight-charts.development.mjs [app-client] (ecmascript, async loader)");
                    if (!mounted || !chartContainerRef.current) return;
                    chart = createChart(chartContainerRef.current, {
                        width: chartContainerRef.current.clientWidth,
                        height: chartContainerRef.current.clientHeight,
                        layout: {
                            background: {
                                color: '#0f0f0f'
                            },
                            textColor: '#d1d4dc'
                        },
                        grid: {
                            vertLines: {
                                color: '#1e1e2e'
                            },
                            horzLines: {
                                color: '#1e1e2e'
                            }
                        },
                        crosshair: {
                            mode: CrosshairMode.Normal
                        },
                        timeScale: {
                            borderColor: '#2a2a3e',
                            timeVisible: true,
                            secondsVisible: false
                        }
                    });
                    chartRef.current = chart;
                    const candleSeries = chart.addCandlestickSeries({
                        upColor: '#22c55e',
                        downColor: '#ef4444',
                        borderUpColor: '#22c55e',
                        borderDownColor: '#ef4444',
                        wickUpColor: '#22c55e',
                        wickDownColor: '#ef4444'
                    });
                    candleSeriesRef.current = candleSeries;
                    const fastEMA = chart.addLineSeries({
                        color: '#22c55e',
                        lineWidth: 1,
                        title: 'EMA Fast'
                    });
                    fastEMARef.current = fastEMA;
                    const slowEMA = chart.addLineSeries({
                        color: '#f97316',
                        lineWidth: 1,
                        title: 'EMA Slow'
                    });
                    slowEMARef.current = slowEMA;
                    ro = new ResizeObserver({
                        "TradingChart.useEffect": ()=>{
                            if (chartContainerRef.current && chartRef.current) {
                                chartRef.current.applyOptions({
                                    width: chartContainerRef.current.clientWidth,
                                    height: chartContainerRef.current.clientHeight
                                });
                            }
                        }
                    }["TradingChart.useEffect"]);
                    if (chartContainerRef.current) ro.observe(chartContainerRef.current);
                    if (mounted) subscribe(symbol, timeframe);
                }
            })["TradingChart.useEffect"]();
            return ({
                "TradingChart.useEffect": ()=>{
                    mounted = false;
                    if (ro) ro.disconnect();
                    if (chart) chart.remove();
                    chartRef.current = null;
                    candleSeriesRef.current = null;
                    fastEMARef.current = null;
                    slowEMARef.current = null;
                    if (wsRef.current) wsRef.current.unsubscribe();
                }
            })["TradingChart.useEffect"];
        }
    }["TradingChart.useEffect"], []);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TradingChart.useEffect": ()=>{
            if (candleSeriesRef.current && barsRef.current.length > 0) {
                renderIndicators(barsRef.current);
            }
        }
    }["TradingChart.useEffect"], [
        settings,
        renderIndicators
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TradingChart.useEffect": ()=>{
            barsRef.current = [];
            subscribe(symbol, timeframe);
        }
    }["TradingChart.useEffect"], [
        symbol,
        timeframe,
        subscribe
    ]);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex flex-col w-full h-full bg-[#0f0f0f]",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center gap-3 px-4 border-b border-[#1e1e2e] shrink-0",
                style: {
                    height: TOOLBAR_HEIGHT
                },
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-center gap-1.5",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: `w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`
                            }, void 0, false, {
                                fileName: "[project]/components/TradingChart.tsx",
                                lineNumber: 277,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "text-xs text-gray-400 font-mono",
                                children: connected ? 'LIVE' : 'OFFLINE'
                            }, void 0, false, {
                                fileName: "[project]/components/TradingChart.tsx",
                                lineNumber: 278,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/TradingChart.tsx",
                        lineNumber: 276,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "h-4 w-px bg-[#2a2a3e]"
                    }, void 0, false, {
                        fileName: "[project]/components/TradingChart.tsx",
                        lineNumber: 283,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("select", {
                        value: symbol,
                        onChange: (e)=>setSymbol(e.target.value),
                        className: "bg-[#1a1a2e] border border-[#2a2a3e] text-white text-sm rounded px-2 py-1 focus:outline-none focus:border-blue-500 cursor-pointer",
                        children: SYMBOLS.map((s)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                value: s,
                                children: s
                            }, s, false, {
                                fileName: "[project]/components/TradingChart.tsx",
                                lineNumber: 291,
                                columnNumber: 13
                            }, this))
                    }, void 0, false, {
                        fileName: "[project]/components/TradingChart.tsx",
                        lineNumber: 285,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex gap-1",
                        children: TIMEFRAMES.map((tf)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                onClick: ()=>setTimeframe(tf.seconds),
                                className: `px-2 py-0.5 text-xs rounded transition-colors ${timeframe === tf.seconds ? 'bg-blue-600 text-white' : 'bg-[#1a1a2e] text-gray-400 hover:text-white hover:bg-[#2a2a3e]'}`,
                                children: tf.label
                            }, tf.label, false, {
                                fileName: "[project]/components/TradingChart.tsx",
                                lineNumber: 297,
                                columnNumber: 13
                            }, this))
                    }, void 0, false, {
                        fileName: "[project]/components/TradingChart.tsx",
                        lineNumber: 295,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "ml-auto flex items-center gap-2",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                            onClick: ()=>setShowPanel((v)=>!v),
                            className: "p-2 rounded hover:bg-[#1a1a2e] text-gray-400 hover:text-white transition-colors",
                            title: "Indicator Settings",
                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("svg", {
                                width: "18",
                                height: "18",
                                viewBox: "0 0 24 24",
                                fill: "none",
                                stroke: "currentColor",
                                strokeWidth: "2",
                                strokeLinecap: "round",
                                strokeLinejoin: "round",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                                        cx: "12",
                                        cy: "12",
                                        r: "3"
                                    }, void 0, false, {
                                        fileName: "[project]/components/TradingChart.tsx",
                                        lineNumber: 318,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                        d: "M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"
                                    }, void 0, false, {
                                        fileName: "[project]/components/TradingChart.tsx",
                                        lineNumber: 319,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/TradingChart.tsx",
                                lineNumber: 317,
                                columnNumber: 13
                            }, this)
                        }, void 0, false, {
                            fileName: "[project]/components/TradingChart.tsx",
                            lineNumber: 312,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/components/TradingChart.tsx",
                        lineNumber: 311,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/TradingChart.tsx",
                lineNumber: 272,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "relative flex-1 min-h-0",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        ref: chartContainerRef,
                        className: "w-full h-full"
                    }, void 0, false, {
                        fileName: "[project]/components/TradingChart.tsx",
                        lineNumber: 326,
                        columnNumber: 9
                    }, this),
                    activeSignal && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "absolute top-3 right-3 bg-[#0f0f0f]/90 border border-[#2a2a3e] rounded-lg px-4 py-3 text-xs font-mono space-y-1.5",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "flex items-center gap-2 mb-2",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: `text-sm font-bold ${activeSignal.type === 'BUY' ? 'text-green-500' : 'text-red-500'}`,
                                    children: activeSignal.type === 'BUY' ? 'LONG' : 'SHORT'
                                }, void 0, false, {
                                    fileName: "[project]/components/TradingChart.tsx",
                                    lineNumber: 331,
                                    columnNumber: 15
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/components/TradingChart.tsx",
                                lineNumber: 330,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "flex justify-between gap-6",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "text-gray-500",
                                        children: "Entry"
                                    }, void 0, false, {
                                        fileName: "[project]/components/TradingChart.tsx",
                                        lineNumber: 336,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "text-white",
                                        children: activeSignal.price.toFixed(4)
                                    }, void 0, false, {
                                        fileName: "[project]/components/TradingChart.tsx",
                                        lineNumber: 337,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/TradingChart.tsx",
                                lineNumber: 335,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "flex justify-between gap-6",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "text-gray-500",
                                        children: "SL"
                                    }, void 0, false, {
                                        fileName: "[project]/components/TradingChart.tsx",
                                        lineNumber: 340,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "text-red-400",
                                        children: activeSignal.stopLoss.toFixed(4)
                                    }, void 0, false, {
                                        fileName: "[project]/components/TradingChart.tsx",
                                        lineNumber: 341,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/TradingChart.tsx",
                                lineNumber: 339,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "flex justify-between gap-6",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "text-gray-500",
                                        children: "TP"
                                    }, void 0, false, {
                                        fileName: "[project]/components/TradingChart.tsx",
                                        lineNumber: 344,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "text-green-400",
                                        children: activeSignal.takeProfit.toFixed(4)
                                    }, void 0, false, {
                                        fileName: "[project]/components/TradingChart.tsx",
                                        lineNumber: 345,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/TradingChart.tsx",
                                lineNumber: 343,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "flex justify-between gap-6 border-t border-[#2a2a3e] pt-1.5 mt-1.5",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "text-gray-500",
                                        children: "R:R"
                                    }, void 0, false, {
                                        fileName: "[project]/components/TradingChart.tsx",
                                        lineNumber: 348,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "text-gray-300",
                                        children: settings.riskReward.toFixed(1)
                                    }, void 0, false, {
                                        fileName: "[project]/components/TradingChart.tsx",
                                        lineNumber: 349,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/TradingChart.tsx",
                                lineNumber: 347,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/TradingChart.tsx",
                        lineNumber: 329,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/TradingChart.tsx",
                lineNumber: 325,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$IndicatorPanel$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                open: showPanel,
                settings: settings,
                onChange: setSettings,
                onClose: ()=>setShowPanel(false)
            }, void 0, false, {
                fileName: "[project]/components/TradingChart.tsx",
                lineNumber: 355,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/TradingChart.tsx",
        lineNumber: 271,
        columnNumber: 5
    }, this);
}
_s(TradingChart, "mdNcPMLYZDGDw13Jcjb6jNsZMx4=");
_c = TradingChart;
var _c;
__turbopack_context__.k.register(_c, "TradingChart");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/node_modules/next/dist/compiled/react/cjs/react-jsx-dev-runtime.development.js [app-client] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
/**
 * @license React
 * react-jsx-dev-runtime.development.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ "use strict";
"production" !== ("TURBOPACK compile-time value", "development") && function() {
    function getComponentNameFromType(type) {
        if (null == type) return null;
        if ("function" === typeof type) return type.$$typeof === REACT_CLIENT_REFERENCE ? null : type.displayName || type.name || null;
        if ("string" === typeof type) return type;
        switch(type){
            case REACT_FRAGMENT_TYPE:
                return "Fragment";
            case REACT_PROFILER_TYPE:
                return "Profiler";
            case REACT_STRICT_MODE_TYPE:
                return "StrictMode";
            case REACT_SUSPENSE_TYPE:
                return "Suspense";
            case REACT_SUSPENSE_LIST_TYPE:
                return "SuspenseList";
            case REACT_ACTIVITY_TYPE:
                return "Activity";
            case REACT_VIEW_TRANSITION_TYPE:
                return "ViewTransition";
        }
        if ("object" === typeof type) switch("number" === typeof type.tag && console.error("Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."), type.$$typeof){
            case REACT_PORTAL_TYPE:
                return "Portal";
            case REACT_CONTEXT_TYPE:
                return type.displayName || "Context";
            case REACT_CONSUMER_TYPE:
                return (type._context.displayName || "Context") + ".Consumer";
            case REACT_FORWARD_REF_TYPE:
                var innerType = type.render;
                type = type.displayName;
                type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
                return type;
            case REACT_MEMO_TYPE:
                return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
            case REACT_LAZY_TYPE:
                innerType = type._payload;
                type = type._init;
                try {
                    return getComponentNameFromType(type(innerType));
                } catch (x) {}
        }
        return null;
    }
    function testStringCoercion(value) {
        return "" + value;
    }
    function checkKeyStringCoercion(value) {
        try {
            testStringCoercion(value);
            var JSCompiler_inline_result = !1;
        } catch (e) {
            JSCompiler_inline_result = !0;
        }
        if (JSCompiler_inline_result) {
            JSCompiler_inline_result = console;
            var JSCompiler_temp_const = JSCompiler_inline_result.error;
            var JSCompiler_inline_result$jscomp$0 = "function" === typeof Symbol && Symbol.toStringTag && value[Symbol.toStringTag] || value.constructor.name || "Object";
            JSCompiler_temp_const.call(JSCompiler_inline_result, "The provided key is an unsupported type %s. This value must be coerced to a string before using it here.", JSCompiler_inline_result$jscomp$0);
            return testStringCoercion(value);
        }
    }
    function getTaskName(type) {
        if (type === REACT_FRAGMENT_TYPE) return "<>";
        if ("object" === typeof type && null !== type && type.$$typeof === REACT_LAZY_TYPE) return "<...>";
        try {
            var name = getComponentNameFromType(type);
            return name ? "<" + name + ">" : "<...>";
        } catch (x) {
            return "<...>";
        }
    }
    function getOwner() {
        var dispatcher = ReactSharedInternals.A;
        return null === dispatcher ? null : dispatcher.getOwner();
    }
    function UnknownOwner() {
        return Error("react-stack-top-frame");
    }
    function hasValidKey(config) {
        if (hasOwnProperty.call(config, "key")) {
            var getter = Object.getOwnPropertyDescriptor(config, "key").get;
            if (getter && getter.isReactWarning) return !1;
        }
        return void 0 !== config.key;
    }
    function defineKeyPropWarningGetter(props, displayName) {
        function warnAboutAccessingKey() {
            specialPropKeyWarningShown || (specialPropKeyWarningShown = !0, console.error("%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://react.dev/link/special-props)", displayName));
        }
        warnAboutAccessingKey.isReactWarning = !0;
        Object.defineProperty(props, "key", {
            get: warnAboutAccessingKey,
            configurable: !0
        });
    }
    function elementRefGetterWithDeprecationWarning() {
        var componentName = getComponentNameFromType(this.type);
        didWarnAboutElementRef[componentName] || (didWarnAboutElementRef[componentName] = !0, console.error("Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release."));
        componentName = this.props.ref;
        return void 0 !== componentName ? componentName : null;
    }
    function ReactElement(type, key, props, owner, debugStack, debugTask) {
        var refProp = props.ref;
        type = {
            $$typeof: REACT_ELEMENT_TYPE,
            type: type,
            key: key,
            props: props,
            _owner: owner
        };
        null !== (void 0 !== refProp ? refProp : null) ? Object.defineProperty(type, "ref", {
            enumerable: !1,
            get: elementRefGetterWithDeprecationWarning
        }) : Object.defineProperty(type, "ref", {
            enumerable: !1,
            value: null
        });
        type._store = {};
        Object.defineProperty(type._store, "validated", {
            configurable: !1,
            enumerable: !1,
            writable: !0,
            value: 0
        });
        Object.defineProperty(type, "_debugInfo", {
            configurable: !1,
            enumerable: !1,
            writable: !0,
            value: null
        });
        Object.defineProperty(type, "_debugStack", {
            configurable: !1,
            enumerable: !1,
            writable: !0,
            value: debugStack
        });
        Object.defineProperty(type, "_debugTask", {
            configurable: !1,
            enumerable: !1,
            writable: !0,
            value: debugTask
        });
        Object.freeze && (Object.freeze(type.props), Object.freeze(type));
        return type;
    }
    function jsxDEVImpl(type, config, maybeKey, isStaticChildren, debugStack, debugTask) {
        var children = config.children;
        if (void 0 !== children) if (isStaticChildren) if (isArrayImpl(children)) {
            for(isStaticChildren = 0; isStaticChildren < children.length; isStaticChildren++)validateChildKeys(children[isStaticChildren]);
            Object.freeze && Object.freeze(children);
        } else console.error("React.jsx: Static children should always be an array. You are likely explicitly calling React.jsxs or React.jsxDEV. Use the Babel transform instead.");
        else validateChildKeys(children);
        if (hasOwnProperty.call(config, "key")) {
            children = getComponentNameFromType(type);
            var keys = Object.keys(config).filter(function(k) {
                return "key" !== k;
            });
            isStaticChildren = 0 < keys.length ? "{key: someKey, " + keys.join(": ..., ") + ": ...}" : "{key: someKey}";
            didWarnAboutKeySpread[children + isStaticChildren] || (keys = 0 < keys.length ? "{" + keys.join(": ..., ") + ": ...}" : "{}", console.error('A props object containing a "key" prop is being spread into JSX:\n  let props = %s;\n  <%s {...props} />\nReact keys must be passed directly to JSX without using spread:\n  let props = %s;\n  <%s key={someKey} {...props} />', isStaticChildren, children, keys, children), didWarnAboutKeySpread[children + isStaticChildren] = !0);
        }
        children = null;
        void 0 !== maybeKey && (checkKeyStringCoercion(maybeKey), children = "" + maybeKey);
        hasValidKey(config) && (checkKeyStringCoercion(config.key), children = "" + config.key);
        if ("key" in config) {
            maybeKey = {};
            for(var propName in config)"key" !== propName && (maybeKey[propName] = config[propName]);
        } else maybeKey = config;
        children && defineKeyPropWarningGetter(maybeKey, "function" === typeof type ? type.displayName || type.name || "Unknown" : type);
        return ReactElement(type, children, maybeKey, getOwner(), debugStack, debugTask);
    }
    function validateChildKeys(node) {
        isValidElement(node) ? node._store && (node._store.validated = 1) : "object" === typeof node && null !== node && node.$$typeof === REACT_LAZY_TYPE && ("fulfilled" === node._payload.status ? isValidElement(node._payload.value) && node._payload.value._store && (node._payload.value._store.validated = 1) : node._store && (node._store.validated = 1));
    }
    function isValidElement(object) {
        return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
    }
    var React = __turbopack_context__.r("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)"), REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"), REACT_PORTAL_TYPE = Symbol.for("react.portal"), REACT_FRAGMENT_TYPE = Symbol.for("react.fragment"), REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode"), REACT_PROFILER_TYPE = Symbol.for("react.profiler"), REACT_CONSUMER_TYPE = Symbol.for("react.consumer"), REACT_CONTEXT_TYPE = Symbol.for("react.context"), REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref"), REACT_SUSPENSE_TYPE = Symbol.for("react.suspense"), REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list"), REACT_MEMO_TYPE = Symbol.for("react.memo"), REACT_LAZY_TYPE = Symbol.for("react.lazy"), REACT_ACTIVITY_TYPE = Symbol.for("react.activity"), REACT_VIEW_TRANSITION_TYPE = Symbol.for("react.view_transition"), REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference"), ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, hasOwnProperty = Object.prototype.hasOwnProperty, isArrayImpl = Array.isArray, createTask = console.createTask ? console.createTask : function() {
        return null;
    };
    React = {
        react_stack_bottom_frame: function(callStackForError) {
            return callStackForError();
        }
    };
    var specialPropKeyWarningShown;
    var didWarnAboutElementRef = {};
    var unknownOwnerDebugStack = React.react_stack_bottom_frame.bind(React, UnknownOwner)();
    var unknownOwnerDebugTask = createTask(getTaskName(UnknownOwner));
    var didWarnAboutKeySpread = {};
    exports.Fragment = REACT_FRAGMENT_TYPE;
    exports.jsxDEV = function(type, config, maybeKey, isStaticChildren) {
        var trackActualOwner = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
        if (trackActualOwner) {
            var previousStackTraceLimit = Error.stackTraceLimit;
            Error.stackTraceLimit = 10;
            var debugStackDEV = Error("react-stack-top-frame");
            Error.stackTraceLimit = previousStackTraceLimit;
        } else debugStackDEV = unknownOwnerDebugStack;
        return jsxDEVImpl(type, config, maybeKey, isStaticChildren, debugStackDEV, trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask);
    };
}();
}),
"[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
'use strict';
if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
;
else {
    module.exports = __turbopack_context__.r("[project]/node_modules/next/dist/compiled/react/cjs/react-jsx-dev-runtime.development.js [app-client] (ecmascript)");
}
}),
]);

//# sourceMappingURL=_062wg8u._.js.map