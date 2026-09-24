import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('opens after the threshold and half-opens after cooldown', () => {
    let now = 0;
    const b = new CircuitBreaker(2, 1000, () => now);
    b.failure();
    expect(b.isOpen).toBe(false);
    b.failure();
    expect(b.isOpen).toBe(true);
    now = 1001;
    expect(b.isOpen).toBe(false);
    b.success();
    expect(b.state()).toEqual({ failures: 0, open: false });
  });
});
