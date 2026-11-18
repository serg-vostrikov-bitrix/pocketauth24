export type LoginLimiter = {
  blocked: (ip: string) => boolean;
  fail: (ip: string) => void;
  reset: (ip: string) => void;
};

// In memory, one instance per app: a restart resets it, and several instances do not share it.
export function createLoginLimiter(options: { max: number; windowMs: number }): LoginLimiter {
  const failures = new Map<string, number[]>();
  const recent = (ip: string, now: number): number[] =>
    (failures.get(ip) ?? []).filter((time) => now - time < options.windowMs);

  return {
    blocked: (ip) => {
      const times = recent(ip, Date.now());
      if (times.length === 0) failures.delete(ip);
      else failures.set(ip, times);
      return times.length >= options.max;
    },
    fail: (ip) => {
      const now = Date.now();
      // The sweep keeps memory bounded by the IPs that failed within the window.
      for (const [key, times] of failures) {
        if (times.every((time) => now - time >= options.windowMs)) failures.delete(key);
      }
      failures.set(ip, [...recent(ip, now), now]);
    },
    reset: (ip) => {
      failures.delete(ip);
    },
  };
}
