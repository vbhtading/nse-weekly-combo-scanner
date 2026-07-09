/**
 * Weekly multi-signal analyzer:
 *   1. Fresh upper Bollinger Band (50,2) cross
 *   2. RSI(14) just crossed above 60
 *   3. MACD(12,26,9) line just crossed above zero
 *   4. Volume spurts
 *   5. EMA13 > EMA30 (weekly trend)
 *   6. Up ≥10% vs last week close with volume
 *   7. Average weekly range > 5%
 */

import {
  WeeklyCandle,
  BollingerResult,
  VolumeStats,
  EmaTrendResult,
  WeeklyRangeResult,
  detectFreshUpperBandCross,
  detectRsiCrossAbove,
  detectMacdCrossAboveZero,
  calculateVolumeStats,
  calculateBollinger,
  calculateEmaTrend,
  calculateAvgWeeklyRange,
  detectBigMoveWithVolume,
  rsiSeries,
} from "./indicators";

export type SignalFlag =
  | "BB"
  | "RSI"
  | "MACD"
  | "VOL"
  | "EMA"
  | "MOVE"
  | "RANGE";

export interface StockAnalysis {
  symbol: string;
  name: string;
  ltp: number;
  changePct: number;
  currency: string;

  // Price context
  lastWeeklyClose: number;
  previousWeeklyClose: number | null;
  weeklyChangePct: number;
  lastWeeklyDate: string;
  weeksAnalyzed: number;

  // Bollinger Bands (50, 2)
  bb: BollingerResult | null;
  previousUpperBand: number | null;
  pctAboveUpper: number | null;
  bbCross: boolean;

  // RSI(14)
  rsi: number | null;
  previousRsi: number | null;
  rsiCross: boolean;

  // MACD(12,26,9) line vs zero
  macd: number | null;
  previousMacd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  macdCross: boolean;

  // Volume
  volume: VolumeStats;

  // EMA 13 / 30
  ema13: number | null;
  ema30: number | null;
  ema13Above30: boolean;
  emaSpreadPct: number | null;
  emaJustCrossedAbove: boolean;

  // Big weekly move + volume
  up10Pct: boolean;
  bigMoveWithVolume: boolean;

  // Average weekly range
  avgRangePct: number | null;
  lastRangePct: number | null;
  avgRangeAbove5: boolean;

  // Confluence
  signalCount: number; // 0–3 from BB/RSI/MACD
  signals: SignalFlag[];
  tripleConfluence: boolean; // all three true

  // Chart payload
  recentCandles?: WeeklyCandle[];

  error?: string;
}

function emptyVolume(): VolumeStats {
  return {
    lastVolume: 0,
    avgVolume: 0,
    ratio: 0,
    isSpike: false,
    isMildSpike: false,
    usedPriorWeek: false,
    priorWeekVolume: 0,
    priorWeekRatio: 0,
  };
}

export function emptyAnalysis(
  symbol: string,
  name: string,
  reason: string
): StockAnalysis {
  return {
    symbol,
    name,
    ltp: 0,
    changePct: 0,
    currency: "INR",
    lastWeeklyClose: 0,
    previousWeeklyClose: null,
    weeklyChangePct: 0,
    lastWeeklyDate: "",
    weeksAnalyzed: 0,
    bb: null,
    previousUpperBand: null,
    pctAboveUpper: null,
    bbCross: false,
    rsi: null,
    previousRsi: null,
    rsiCross: false,
    macd: null,
    previousMacd: null,
    macdSignal: null,
    macdHist: null,
    macdCross: false,
    volume: emptyVolume(),
    ema13: null,
    ema30: null,
    ema13Above30: false,
    emaSpreadPct: null,
    emaJustCrossedAbove: false,
    up10Pct: false,
    bigMoveWithVolume: false,
    avgRangePct: null,
    lastRangePct: null,
    avgRangeAbove5: false,
    signalCount: 0,
    signals: [],
    tripleConfluence: false,
    error: reason,
  };
}

export function analyzeWeekly(
  symbol: string,
  name: string,
  ltp: number,
  changePct: number,
  candles: WeeklyCandle[],
  volStrong = 2.5,
  volMild = 1.5
): StockAnalysis {
  // Need enough history for BB(50) + 1 prior bar
  if (!candles || candles.length < 55) {
    return emptyAnalysis(
      symbol,
      name,
      `Insufficient weekly data (${candles?.length ?? 0} weeks, need ≥55)`
    );
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const lastClose = last.close;
  const prevClose = prev?.close ?? null;
  const weeklyChangePct =
    prevClose && prevClose !== 0
      ? Number((((lastClose - prevClose) / prevClose) * 100).toFixed(2))
      : 0;

  // 1) Bollinger Band fresh upper cross
  const bbCross = detectFreshUpperBandCross(closes, 50, 2);
  const bb = bbCross.currentBB ?? calculateBollinger(closes, 50, 2);
  let pctAboveUpper: number | null = null;
  if (bb) {
    pctAboveUpper = Number(
      (((lastClose - bb.upper) / bb.upper) * 100).toFixed(2)
    );
  }

  // 2) RSI cross above 60
  const rsiCross = detectRsiCrossAbove(closes, 14, 60);

  // 3) MACD line cross above zero
  const macdCross = detectMacdCrossAboveZero(closes, 12, 26, 9);

  // 4) Volume spurts
  const volume = calculateVolumeStats(volumes, 20, volStrong, volMild);

  // 5) EMA 13 above EMA 30
  const emaTrend: EmaTrendResult = calculateEmaTrend(closes, 13, 30);

  // 6) Up ≥10% with volume
  const bigMove = detectBigMoveWithVolume(candles, volume, 10, 1.0);

  // 7) Average weekly range > 5% (10-week lookback)
  const rangeStats: WeeklyRangeResult = calculateAvgWeeklyRange(
    candles,
    10,
    5
  );

  // Assemble signal flags
  const signals: SignalFlag[] = [];
  if (bbCross.hasJustCrossed) signals.push("BB");
  if (rsiCross.hasJustCrossed) signals.push("RSI");
  if (macdCross.hasJustCrossed) signals.push("MACD");
  if (volume.isSpike) signals.push("VOL");
  if (emaTrend.ema13Above30) signals.push("EMA");
  if (bigMove.bigMoveWithVolume) signals.push("MOVE");
  if (rangeStats.avgRangeAbove5) signals.push("RANGE");

  const coreSignals = signals.filter(
    (s) => s === "BB" || s === "RSI" || s === "MACD"
  );
  const signalCount = coreSignals.length;
  const tripleConfluence =
    bbCross.hasJustCrossed &&
    rsiCross.hasJustCrossed &&
    macdCross.hasJustCrossed;

  // Ensure RSI value even if no cross (for display)
  let rsi = rsiCross.currentRsi;
  if (rsi == null) {
    const series = rsiSeries(closes, 14);
    const lastRsi = series[series.length - 1];
    if (!isNaN(lastRsi)) rsi = Number(lastRsi.toFixed(2));
  }

  return {
    symbol,
    name,
    ltp: Number(ltp.toFixed(2)),
    changePct: Number(changePct.toFixed(2)),
    currency: "INR",
    lastWeeklyClose: Number(lastClose.toFixed(2)),
    previousWeeklyClose:
      prevClose != null ? Number(prevClose.toFixed(2)) : null,
    weeklyChangePct,
    lastWeeklyDate: last.date,
    weeksAnalyzed: candles.length,
    bb,
    previousUpperBand: bbCross.previousUpper,
    pctAboveUpper,
    bbCross: bbCross.hasJustCrossed,
    rsi,
    previousRsi: rsiCross.previousRsi,
    rsiCross: rsiCross.hasJustCrossed,
    macd: macdCross.currentMacd,
    previousMacd: macdCross.previousMacd,
    macdSignal: macdCross.currentSignal,
    macdHist: macdCross.currentHist,
    macdCross: macdCross.hasJustCrossed,
    volume,
    ema13: emaTrend.ema13,
    ema30: emaTrend.ema30,
    ema13Above30: emaTrend.ema13Above30,
    emaSpreadPct: emaTrend.emaSpreadPct,
    emaJustCrossedAbove: emaTrend.emaJustCrossedAbove,
    up10Pct: bigMove.up10Pct,
    bigMoveWithVolume: bigMove.bigMoveWithVolume,
    avgRangePct: rangeStats.avgRangePct,
    lastRangePct: rangeStats.lastRangePct,
    avgRangeAbove5: rangeStats.avgRangeAbove5,
    signalCount,
    signals,
    tripleConfluence,
  };
}
