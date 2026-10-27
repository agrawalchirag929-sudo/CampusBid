export interface AntiSnipingConfig {
  windowMs: number;
  extensionMs: number;
  maxExtensions: number;
}

export const DEFAULT_ANTI_SNIPING: Readonly<AntiSnipingConfig> = Object.freeze({
  windowMs: 60_000,
  extensionMs: 60_000,
  maxExtensions: 10,
});

export function resolveAntiSnipingConfig(
  config: Partial<AntiSnipingConfig> | undefined,
): AntiSnipingConfig {
  const resolved = { ...DEFAULT_ANTI_SNIPING, ...config };
  if (
    !Number.isSafeInteger(resolved.windowMs) ||
    resolved.windowMs < 0 ||
    !Number.isSafeInteger(resolved.extensionMs) ||
    resolved.extensionMs <= 0 ||
    !Number.isSafeInteger(resolved.maxExtensions) ||
    resolved.maxExtensions < 0
  ) {
    throw new RangeError('Invalid anti-sniping configuration');
  }
  return resolved;
}
