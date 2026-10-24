import { performance } from 'node:perf_hooks'

export function measuredPingLatencyMs(receivedAt, now = performance.now()) {
  const start = Number(receivedAt)
  const end = Number(now)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.round(end - start))
}
