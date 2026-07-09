# Weekly Triple Scanner

NSE stock scanner on **weekly candles** (Yahoo Finance) that flags:

| Signal | Condition |
|--------|-----------|
| **BB** | Close just crossed **above** upper Bollinger Band **(50, 2)**; previous close was at/below the prior upper band |
| **RSI** | Weekly RSI(14) just crossed **above 60** (previous ≤ 60) |
| **MACD** | MACD line **(12, 26, 9)** just crossed **above zero** (previous ≤ 0) |
| **VOL** | Latest week volume ≥ **N×** trailing 20-week average (default strong = 2.5×) |
| **EMA** | 13-week EMA **above** 30-week EMA |
| **MOVE** | Up **≥10%** vs last week close **with volume** confirmation |
| **RANGE** | Average weekly range (H−L)/C over **10 weeks** **> 5%** |

**Triple Confluence** = BB + RSI + MACD all true on the same week.

Tabs in the UI:

1. **Triple Confluence** (default) — highest conviction
2. Individual: BB / RSI / MACD / Volume
3. **EMA 13>30** · **Up 10%+ Vol** · **Range >5%**
4. Any signal / Full universe

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- `yahoo-finance2` for quotes + weekly charts
- Ready for **Vercel** deploy

## Run locally

```bash
cd nse-weekly-combo-scanner
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → **Scan**.

## Deploy to Vercel

```bash
npx vercel
# or
npx vercel --prod
```

No env vars required. Yahoo is called from API routes (server-side).

## Project layout

```
app/
  page.tsx              # Scanner dashboard
  api/analyze/route.ts  # Per-symbol weekly analysis
lib/
  symbols.ts            # NSE universe
  indicators.ts         # BB / RSI / MACD / volume
  analyzer.ts           # Signal assembly
  utils.ts              # Format + concurrency
```

## Notes

- Symbols are requested as `SYMBOL.NS` on Yahoo.
- Needs ≥ ~55 weekly bars for BB(50) + prior-week comparison.
- Scan uses concurrency 6 to stay polite with Yahoo rate limits.
- Not financial advice.
