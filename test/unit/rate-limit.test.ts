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

it('Allows 5 attempts per IP and refuses the sixth, only for that IP', () => {
  const limiter = createLoginLimiter({ max: 5, windowMs: WINDOW_MS });
  for (let i = 0; i < 5; i++) expect(limiter.tryAttempt('10.0.0.1')).toBe(true);
  expect(limiter.tryAttempt('10.0.0.1')).toBe(false);
  expect(limiter.tryAttempt('10.0.0.2')).toBe(true);
});

it('Forgets attempts older than the window', () => {
  const limiter = createLoginLimiter({ max: 5, windowMs: WINDOW_MS });
  for (let i = 0; i < 5; i++) limiter.tryAttempt('10.0.0.1');
  vi.advanceTimersByTime(WINDOW_MS);
  expect(limiter.tryAttempt('10.0.0.1')).toBe(true);
});

it('refund gives back one attempt', () => {
  const limiter = createLoginLimiter({ max: 5, windowMs: WINDOW_MS });
  for (let i = 0; i < 5; i++) limiter.tryAttempt('10.0.0.1');
  limiter.refund('10.0.0.1');
  expect(limiter.tryAttempt('10.0.0.1')).toBe(true);
  expect(limiter.tryAttempt('10.0.0.1')).toBe(false);
});

it('Does not grow without bound: old IPs are dropped', () => {
  const limiter = createLoginLimiter({ max: 5, windowMs: WINDOW_MS });
  for (let i = 0; i < 1000; i++) limiter.tryAttempt(`10.1.${Math.floor(i / 250)}.${i % 250}`);
  expect(limiter.size()).toBe(1000);
  vi.advanceTimersByTime(WINDOW_MS);
  limiter.tryAttempt('10.9.9.9');
  expect(limiter.size()).toBe(1);
});
