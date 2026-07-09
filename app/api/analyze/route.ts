import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { analyzeWeekly, StockAnalysis } from "@/lib/analyzer";
import { WeeklyCandle } from "@/lib/indicators";
import { toYahooSymbol, shortSymbol } from "@/lib/symbols";

const yf = new YahooFinance({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
});

// In-memory cache per server instance (weekly data moves slowly)
const histCache = new Map<string, { data: any[]; ts: number }>();
const quoteCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

function getCached<T>(
  map: Map<string, { data: T; ts: number }>,
  key: string
): T | null {
  const hit = map.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
  return null;
}

function setCached<T>(
  map: Map<string, { data: T; ts: number }>,
  key: string,
  data: T
) {
  map.set(key, { data, ts: Date.now() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { symbol, volStrong = 2.5, volMild = 1.5 } = body;

    if (!symbol || typeof symbol !== "string") {
      return NextResponse.json(
        { error: "symbol is required" },
        { status: 400 }
      );
    }

    const ySymbol = toYahooSymbol(symbol);
    const displaySym = shortSymbol(ySymbol);

    // 1. Quote for LTP + daily change + name
    let quote: any = getCached(quoteCache, ySymbol);
    if (!quote) {
      try {
        quote = await yf.quote(ySymbol);
        setCached(quoteCache, ySymbol, quote);
      } catch {
        // Continue without live quote — weekly close still usable
        quote = null;
      }
    }

    const ltp =
      quote?.regularMarketPrice ??
      quote?.postMarketPrice ??
      0;
    const changePct = quote?.regularMarketChangePercent ?? 0;
    const displayName =
      quote?.shortName ||
      quote?.longName ||
      quote?.displayName ||
      displaySym;

    // 2. Weekly history via chart() (~3 years for stable BB50 + MACD)
    let hist: any[] = getCached(histCache, ySymbol) || [];
    if (hist.length === 0) {
      try {
        const start = new Date();
        start.setFullYear(start.getFullYear() - 3);

        const chartResult = await yf.chart(ySymbol, {
          period1: start,
          interval: "1wk",
        });

        hist = chartResult.quotes || [];
        setCached(histCache, ySymbol, hist);
      } catch (e) {
        console.error("Chart fetch failed for", ySymbol, e);
        return NextResponse.json(
          { error: `Failed to fetch weekly history for ${displaySym}` },
          { status: 502 }
        );
      }
    }

    if (!hist || hist.length === 0) {
      return NextResponse.json(
        { error: `No historical weekly data for ${displaySym}` },
        { status: 404 }
      );
    }

    const candles: WeeklyCandle[] = hist
      .filter((h: any) => h.close != null && h.volume != null)
      .map((h: any) => ({
        date: new Date(h.date).toISOString().split("T")[0],
        timestamp: new Date(h.date).getTime(),
        open: Number(h.open ?? h.close),
        high: Number(h.high ?? h.close),
        low: Number(h.low ?? h.close),
        close: Number(h.close),
        volume: Number(h.volume),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    const effectiveLtp = ltp || candles[candles.length - 1]?.close || 0;

    const analysis: StockAnalysis = analyzeWeekly(
      displaySym,
      displayName,
      effectiveLtp,
      changePct,
      candles,
      volStrong,
      volMild
    );

    // Attach recent candles for optional detail view
    const recentCandles = candles.slice(-52);

    return NextResponse.json({
      ...analysis,
      recentCandles,
    });
  } catch (err: any) {
    console.error("Analyze error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}
