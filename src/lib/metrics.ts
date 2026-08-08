export interface RouteCount {
  route: string;
  hits: number;
  lastHitAt: number;
}

export class Metrics {
  private readonly byRoute = new Map<string, { hits: number; lastHitAt: number }>();
  private total = 0;
  private readonly startedAt = Date.now();

  tick(method: string, path: string, now = Date.now()): void {
    const route = `${method} ${path}`;
    const current = this.byRoute.get(route);
    if (current) {
      current.hits += 1;
      current.lastHitAt = now;
    } else {
      this.byRoute.set(route, { hits: 1, lastHitAt: now });
    }
    this.total += 1;
  }

  get totalHits(): number {
    return this.total;
  }

  get uptimeMs(): number {
    return Date.now() - this.startedAt;
  }

  getRoutes(): RouteCount[] {
    return [...this.byRoute.entries()]
      .map(([route, v]) => ({ route, hits: v.hits, lastHitAt: v.lastHitAt }))
      .sort((a, b) => b.hits - a.hits);
  }

  ratePerSecond(windowMs = 10_000): number {
    const since = Date.now() - windowMs;
    let recent = 0;
    for (const v of this.byRoute.values()) {
      if (v.lastHitAt >= since) recent += v.hits;
    }
    if (recent === 0) return 0;
    const elapsed = Math.min(windowMs, Date.now() - this.startedAt) / 1000;
    return elapsed > 0 ? recent / elapsed : 0;
  }
}