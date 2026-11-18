import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLoginLimiter } from '../../src/admin/rateLimit.js';

const WINDOW_MS = 15 * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

it('Blocks an IP after 5 failures and only that IP', () => {
  const limiter = createLoginLimiter({ max: 5, windowMs: WINDOW_MS });
  for (let i = 0; i < 4; i++) limiter.fail('10.0.0.1');
  expect(limiter.blocked('10.0.0.1')).toBe(false);
  limiter.fail('10.0.0.1');
  expect(limiter.blocked('10.0.0.1')).toBe(true);
  expect(limiter.blocked('10.0.0.2')).toBe(false);
});

it('Forgets failures older than the window', () => {
  const limiter = createLoginLimiter({ max: 5, windowMs: WINDOW_MS });
  for (let i = 0; i < 5; i++) limiter.fail('10.0.0.1');
  vi.advanceTimersByTime(WINDOW_MS);
  expect(limiter.blocked('10.0.0.1')).toBe(false);
});

it('reset clears the failures of an IP', () => {
  const limiter = createLoginLimiter({ max: 5, windowMs: WINDOW_MS });
  for (let i = 0; i < 5; i++) limiter.fail('10.0.0.1');
  limiter.reset('10.0.0.1');
  expect(limiter.blocked('10.0.0.1')).toBe(false);
});
