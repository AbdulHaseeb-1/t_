/**
 * Minimal consecutive-failure breaker. While open, the provider is skipped in
 * auto mode so a dead upstream does not add its timeout to every request.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get isOpen(): boolean {
    if (this.failures < this.threshold) return false;
    // Half-open after cooldown: let one request probe the provider.
    return this.now() - this.openedAt < this.cooldownMs;
  }

  success(): void {
    this.failures = 0;
  }

  failure(): void {
    this.failures++;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }

  state() {
    return { failures: this.failures, open: this.isOpen };
  }
}
