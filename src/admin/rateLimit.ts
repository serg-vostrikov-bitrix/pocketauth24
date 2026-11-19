export type LoginLimiter = {
  // Reserves one attempt for the IP. It returns false, and reserves nothing, at the limit.
  tryAttempt: (ip: string) => boolean;
  // Gives back the latest reserved attempt of the IP.
  refund: (ip: string) => void;
  // The number of tracked IPs.
  size: () => number;
};

// In memory, one instance per app: a restart resets it, and several instances do not share it.
// tryAttempt has no await, so parallel requests cannot pass the limit together.
export function createLoginLimiter(options: { max: number; windowMs: number }): LoginLimiter {
  const attempts = new Map<string, number[]>();
  let lastSweep = Date.now();

  return {
    tryAttempt: (ip) => {
      const now = Date.now();
      // One sweep per window keeps memory bounded by the IPs seen in the last two windows.
      if (now - lastSweep >= options.windowMs) {
        lastSweep = now;
        for (const [key, times] of attempts) {
          if (times.every((time) => now - time >= options.windowMs)) attempts.delete(key);
        }
      }
      const times = (attempts.get(ip) ?? []).filter((time) => now - time < options.windowMs);
      if (times.length >= options.max) {
        attempts.set(ip, times);
        return false;
      }
      times.push(now);
      attempts.set(ip, times);
      return true;
    },
    refund: (ip) => {
      const times = attempts.get(ip);
      times?.pop();
      if (times?.length === 0) attempts.delete(ip);
    },
    size: () => attempts.size,
  };
}
