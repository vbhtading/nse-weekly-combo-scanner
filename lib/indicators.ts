/**
 * Pure weekly technical indicators:
 * - Bollinger Bands (50, 2)
 * - RSI (14, Wilder)
 * - MACD (12, 26, 9) — line vs zero
 * - Volume spurt vs trailing average
 * - EMA 13 vs EMA 30 trend
 * - Avg weekly range %
 * - Big weekly move (+10%) with volume
 */

export interface WeeklyCandle {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BollingerResult {
  middle: number;
  upper: number;
  lower: number;
}

export interface MacdPoint {
  macd: number;
  signal: number;
  histogram: number;
}

// ── helpers ──────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** EMA series — seed with SMA of first `period` values. */
export function emaSeries(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let ema = sum / period;
  out[period - 1] = ema;

  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// ── Bollinger Bands ──────────────────────────────────────────────────

/** Population std-dev Bollinger (common charting convention). */
export function calculateBollinger(
  closes: number[],
  period = 50,
  stdDev = 2
): BollingerResult | null {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const m = mean(slice);
  const variance =
    slice.reduce((acc, v) => acc + Math.pow(v - m, 2), 0) / period;
  const std = Math.sqrt(variance);

  return {
    middle: Number(m.toFixed(2)),
    upper: Number((m + stdDev * std).toFixed(2)),
    lower: Number((m - stdDev * std).toFixed(2)),
  };
}

/**
 * Fresh upper-band cross this week:
 *   previous close ≤ previous upper band
 *   current  close  > current  upper band
 */
export function detectFreshUpperBandCross(
  closes: number[],
  period = 50,
  stdDev = 2
): {
  hasJustCrossed: boolean;
  currentUpper: number | null;
  previousUpper: number | null;
  previousClose: number | null;
  currentClose: number | null;
  currentBB: BollingerResult | null;
} {
  if (closes.length < period + 1) {
    return {
      hasJustCrossed: false,
      currentUpper: null,
      previousUpper: null,
      previousClose: null,
      currentClose: null,
      currentBB: null,
    };
  }

  const currentBB = calculateBollinger(closes, period, stdDev);
  const previousWindow = closes.slice(-period - 1, -1);
  const previousBB = calculateBollinger(previousWindow, period, stdDev);

  const currentClose = closes[closes.length - 1];
  const previousClose = closes[closes.length - 2];

  const hasJustCrossed =
    currentBB !== null &&
    previousBB !== null &&
    previousClose <= previousBB.upper &&
    currentClose > currentBB.upper;

  return {
    hasJustCrossed,
    currentUpper: currentBB?.upper ?? null,
    previousUpper: previousBB?.upper ?? null,
    previousClose: Number(previousClose.toFixed(2)),
    currentClose: Number(currentClose.toFixed(2)),
    currentBB,
  };
}

// ── RSI (Wilder / RMA) ───────────────────────────────────────────────

/** Full RSI series (NaN until warm-up). Period default 14. */
export function rsiSeries(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  out[period] = 100 - 100 / (1 + rs0);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

/**
 * RSI just crossed above threshold (default 60):
 *   previous RSI ≤ threshold, current RSI > threshold
 */
export function detectRsiCrossAbove(
  closes: number[],
  period = 14,
  threshold = 60
): {
  hasJustCrossed: boolean;
  currentRsi: number | null;
  previousRsi: number | null;
} {
  const series = rsiSeries(closes, period);
  if (series.length < 2) {
    return { hasJustCrossed: false, currentRsi: null, previousRsi: null };
  }

  const curr = series[series.length - 1];
  const prev = series[series.length - 2];

  if (isNaN(curr) || isNaN(prev)) {
    return { hasJustCrossed: false, currentRsi: null, previousRsi: null };
  }

  return {
    hasJustCrossed: prev <= threshold && curr > threshold,
    currentRsi: Number(curr.toFixed(2)),
    previousRsi: Number(prev.toFixed(2)),
  };
}

// ── MACD (12, 26, 9) ─────────────────────────────────────────────────

/** MACD line / signal / histogram series. */
export function macdSeries(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): {
  macd: number[];
  signal: number[];
  histogram: number[];
} {
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const macdLine: number[] = closes.map((_, i) => {
    if (isNaN(fastEma[i]) || isNaN(slowEma[i])) return NaN;
    return fastEma[i] - slowEma[i];
  });

  // Signal is EMA of MACD line — only use valid MACD points
  // Seed after slow period is ready
  const signal: number[] = new Array(closes.length).fill(NaN);
  const validStart = slow - 1;
  const macdValid = macdLine.slice(validStart);
  if (macdValid.length >= signalPeriod) {
    const sigEma = emaSeries(macdValid, signalPeriod);
    for (let i = 0; i < sigEma.length; i++) {
      signal[validStart + i] = sigEma[i];
    }
  }

  const histogram = macdLine.map((m, i) => {
    if (isNaN(m) || isNaN(signal[i])) return NaN;
    return m - signal[i];
  });

  return { macd: macdLine, signal, histogram };
}

/**
 * MACD line just crossed above zero:
 *   previous MACD ≤ 0, current MACD > 0
 */
export function detectMacdCrossAboveZero(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): {
  hasJustCrossed: boolean;
  currentMacd: number | null;
  previousMacd: number | null;
  currentSignal: number | null;
  currentHist: number | null;
} {
  const { macd, signal, histogram } = macdSeries(
    closes,
    fast,
    slow,
    signalPeriod
  );
  if (macd.length < 2) {
    return {
      hasJustCrossed: false,
      currentMacd: null,
      previousMacd: null,
      currentSignal: null,
      currentHist: null,
    };
  }

  const curr = macd[macd.length - 1];
  const prev = macd[macd.length - 2];
  const sig = signal[signal.length - 1];
  const hist = histogram[histogram.length - 1];

  if (isNaN(curr) || isNaN(prev)) {
    return {
      hasJustCrossed: false,
      currentMacd: null,
      previousMacd: null,
      currentSignal: isNaN(sig) ? null : Number(sig.toFixed(4)),
      currentHist: isNaN(hist) ? null : Number(hist.toFixed(4)),
    };
  }

  return {
    hasJustCrossed: prev <= 0 && curr > 0,
    currentMacd: Number(curr.toFixed(4)),
    previousMacd: Number(prev.toFixed(4)),
    currentSignal: isNaN(sig) ? null : Number(sig.toFixed(4)),
    currentHist: isNaN(hist) ? null : Number(hist.toFixed(4)),
  };
}

// ── Volume spurts ────────────────────────────────────────────────────

export interface VolumeStats {
  lastVolume: number;
  avgVolume: number;
  ratio: number;
  isSpike: boolean;
  isMildSpike: boolean;
  /** True when the latest Yahoo weekly bar looks incomplete (mid-week). */
  usedPriorWeek: boolean;
  priorWeekVolume: number;
  priorWeekRatio: number;
}

/**
 * Volume spurt vs trailing N-week average.
 *
 * Yahoo's current weekly bar is incomplete until the week ends, so volume
 * mid-week is artificially low. If the latest bar is < 45% of the baseline
 * average, we evaluate the *previous complete week* for spike detection while
 * still reporting both ratios.
 *
 * isSpike  ≥ strongThreshold (default 2.5×)
 * isMildSpike ≥ mildThreshold (default 1.5×)
 */
export function calculateVolumeStats(
  volumes: number[],
  lookback = 20,
  strongThreshold = 2.5,
  mildThreshold = 1.5
): VolumeStats {
  if (volumes.length === 0) {
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

  const lastVolume = volumes[volumes.length - 1];
  const priorWeekVolume =
    volumes.length >= 2 ? volumes[volumes.length - 2] : 0;

  // Baseline: up to `lookback` weeks ending before the most recent bar
  const n = Math.min(lookback, Math.max(0, volumes.length - 1));
  let avgVolume = lastVolume;
  if (n > 0) {
    const prior = volumes.slice(-n - 1, -1);
    avgVolume = mean(prior);
  }

  // If latest bar looks incomplete, recompute baseline excluding last 2 bars
  // so the completed prior week is compared fairly
  let usedPriorWeek = false;
  let evalVolume = lastVolume;
  let evalAvg = avgVolume;

  const lastRatio = avgVolume > 0 ? lastVolume / avgVolume : 0;
  if (lastRatio < 0.45 && volumes.length >= 3) {
    usedPriorWeek = true;
    evalVolume = priorWeekVolume;
    const n2 = Math.min(lookback, volumes.length - 2);
    if (n2 > 0) {
      const baseline = volumes.slice(-n2 - 2, -2);
      evalAvg = mean(baseline);
      avgVolume = evalAvg;
    }
  }

  const ratio = evalAvg > 0 ? evalVolume / evalAvg : 0;
  const priorWeekRatio =
    avgVolume > 0 && priorWeekVolume
      ? priorWeekVolume / avgVolume
      : 0;

  return {
    lastVolume: Math.round(usedPriorWeek ? evalVolume : lastVolume),
    avgVolume: Math.round(avgVolume),
    ratio: Number(ratio.toFixed(2)),
    isSpike: ratio >= strongThreshold,
    isMildSpike: ratio >= mildThreshold,
    usedPriorWeek,
    priorWeekVolume: Math.round(priorWeekVolume),
    priorWeekRatio: Number(priorWeekRatio.toFixed(2)),
  };
}

// ── EMA 13 / 30 trend ────────────────────────────────────────────────

export interface EmaTrendResult {
  ema13: number | null;
  ema30: number | null;
  /** True when 13-week EMA is strictly above 30-week EMA */
  ema13Above30: boolean;
  /** (ema13 - ema30) / ema30 * 100 — positive when 13 above 30 */
  emaSpreadPct: number | null;
  /** Fresh cross: previous 13 was ≤ 30, now 13 > 30 */
  emaJustCrossedAbove: boolean;
}

/**
 * Weekly trend stack: 13-EMA above 30-EMA.
 */
export function calculateEmaTrend(
  closes: number[],
  fast = 13,
  slow = 30
): EmaTrendResult {
  if (closes.length < slow) {
    return {
      ema13: null,
      ema30: null,
      ema13Above30: false,
      emaSpreadPct: null,
      emaJustCrossedAbove: false,
    };
  }

  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const i = closes.length - 1;
  const f = fastEma[i];
  const s = slowEma[i];

  if (isNaN(f) || isNaN(s) || s === 0) {
    return {
      ema13: null,
      ema30: null,
      ema13Above30: false,
      emaSpreadPct: null,
      emaJustCrossedAbove: false,
    };
  }

  let emaJustCrossedAbove = false;
  if (i >= 1) {
    const pf = fastEma[i - 1];
    const ps = slowEma[i - 1];
    if (!isNaN(pf) && !isNaN(ps)) {
      emaJustCrossedAbove = pf <= ps && f > s;
    }
  }

  return {
    ema13: Number(f.toFixed(2)),
    ema30: Number(s.toFixed(2)),
    ema13Above30: f > s,
    emaSpreadPct: Number((((f - s) / s) * 100).toFixed(2)),
    emaJustCrossedAbove,
  };
}

// ── Average weekly range ─────────────────────────────────────────────

export interface WeeklyRangeResult {
  /** Average of (high-low)/close * 100 over lookback weeks */
  avgRangePct: number | null;
  /** Latest week (high-low)/close * 100 */
  lastRangePct: number | null;
  /** True when avg weekly range > threshold (default 5%) */
  avgRangeAbove5: boolean;
  weeksUsed: number;
}

/**
 * Average weekly range as % of close.
 * Uses completed weeks when the latest bar looks incomplete (low volume).
 */
export function calculateAvgWeeklyRange(
  candles: WeeklyCandle[],
  lookback = 10,
  thresholdPct = 5
): WeeklyRangeResult {
  if (!candles || candles.length < 3) {
    return {
      avgRangePct: null,
      lastRangePct: null,
      avgRangeAbove5: false,
      weeksUsed: 0,
    };
  }

  // Prefer completed weeks: drop latest if volume is thin vs prior
  let slice = candles;
  if (candles.length >= 3) {
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    if (prev.volume > 0 && last.volume < prev.volume * 0.45) {
      slice = candles.slice(0, -1);
    }
  }

  const window = slice.slice(-lookback);
  const ranges: number[] = [];
  for (const c of window) {
    if (c.close > 0 && c.high >= c.low) {
      ranges.push(((c.high - c.low) / c.close) * 100);
    }
  }

  if (!ranges.length) {
    return {
      avgRangePct: null,
      lastRangePct: null,
      avgRangeAbove5: false,
      weeksUsed: 0,
    };
  }

  const avg = mean(ranges);
  const lastRange = ranges[ranges.length - 1];

  return {
    avgRangePct: Number(avg.toFixed(2)),
    lastRangePct: Number(lastRange.toFixed(2)),
    avgRangeAbove5: avg > thresholdPct,
    weeksUsed: ranges.length,
  };
}

// ── Big weekly move (+10%) with volume ───────────────────────────────

export interface BigMoveResult {
  /** Close change vs previous week close % */
  weeklyChangePct: number;
  /** True if weeklyChangePct ≥ 10 */
  up10Pct: boolean;
  /** True if move is accompanied by elevated volume */
  withVolume: boolean;
  /** up10Pct && withVolume */
  bigMoveWithVolume: boolean;
  volumeRatio: number;
}

/**
 * Up ≥10% from last week's close with volume confirmation
 * (volume ≥ 1.0× trailing average, or current week vol > prior week).
 */
export function detectBigMoveWithVolume(
  candles: WeeklyCandle[],
  volume: VolumeStats,
  moveThresholdPct = 10,
  volMinRatio = 1.0
): BigMoveResult {
  if (!candles || candles.length < 2) {
    return {
      weeklyChangePct: 0,
      up10Pct: false,
      withVolume: false,
      bigMoveWithVolume: false,
      volumeRatio: 0,
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const weeklyChangePct =
    prev.close > 0
      ? Number((((last.close - prev.close) / prev.close) * 100).toFixed(2))
      : 0;

  const up10Pct = weeklyChangePct >= moveThresholdPct;

  // Volume confirmation: above trailing avg OR week-over-week volume up
  const volAboveAvg = volume.ratio >= volMinRatio;
  const volUpVsPrior =
    prev.volume > 0 && last.volume >= prev.volume * 1.05;
  // If we fell back to prior week for volume stats, treat mild/spike as confirmation
  const volConfirmed =
    volAboveAvg ||
    volUpVsPrior ||
    volume.isMildSpike ||
    volume.isSpike;

  return {
    weeklyChangePct,
    up10Pct,
    withVolume: volConfirmed,
    bigMoveWithVolume: up10Pct && volConfirmed,
    volumeRatio: volume.ratio,
  };
}
