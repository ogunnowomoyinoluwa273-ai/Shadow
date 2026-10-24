import { errorLogDetails } from './errors.js'

export function createFatalProcessErrorHandler({
  logger,
  getSocket,
  markShuttingDown,
  setExitCode = code => { process.exitCode = code },
  exit = code => process.exit(code),
  schedule = setTimeout,
  graceMs = 1000
} = {}) {
  let initiated = false

  return (eventName, reason) => {
    if (initiated) return false
    initiated = true

    try { markShuttingDown?.() } catch {}
    try { setExitCode(1) } catch {}

    const error = reason instanceof Error ? reason : new Error(String(reason ?? 'Unknown fatal error'))
    try { logger?.fatal?.({ event: String(eventName || 'fatal process error'), err: errorLogDetails(error) }, 'Fatal process error; shutting down') } catch {}

    try { getSocket?.()?.end?.(new Error('Fatal process error')) } catch (closeError) {
      try { logger?.error?.({ err: errorLogDetails(closeError) }, 'Socket close failed during fatal shutdown') } catch {}
    }

    try {
      const timer = schedule(() => exit(1), Math.max(0, Number(graceMs) || 0))
      timer?.unref?.()
    } catch {
      try { exit(1) } catch {}
    }
    return true
  }
}
