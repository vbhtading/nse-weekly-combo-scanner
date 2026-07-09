// Shared formatting and concurrency helpers

export function formatINR(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatNumber(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN").format(Math.round(n));
}

export function formatPercent(n: number): string {
  if (!isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatCompact(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} K`;
  return String(Math.round(n));
}

/** Run async workers with a concurrency limit (Yahoo-friendly). */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runNext(): Promise<void> {
    const i = next++;
    if (i >= items.length) return;
    try {
      results[i] = await worker(items[i], i);
    } catch (e) {
      results[i] = { error: String(e) } as unknown as R;
    }
    await runNext();
  }

  const starters = Array.from(
    { length: Math.min(limit, items.length) },
    runNext
  );
  await Promise.all(starters);
  return results;
}

export function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
