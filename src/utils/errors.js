export const GENERIC_FAILURE_MESSAGE = 'The request failed. Please try again shortly.'

export class UserFacingError extends Error {
  constructor(message, { code } = {}) {
    super(String(message || GENERIC_FAILURE_MESSAGE))
    this.name = 'UserFacingError'
    this.userMessage = this.message
    if (code) this.code = code
  }
}

const secretKey = '(?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?(?:token|id)|pairing[_-]?code|authorization|password|passwd|secret|cookie|token)'
const redactSecretText = value => String(value || '')
  .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
  .replace(new RegExp(`((?:${secretKey})\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&]+)`, 'gi'), '$1[REDACTED]')
  .replace(new RegExp(`([?&](?:${secretKey})=)[^&#\\s]+`, 'gi'), '$1[REDACTED]')
  .replace(/(https?:\/\/)[^\/@\s]+@/gi, '$1[REDACTED]@')

export function errorLogDetails(error) {
  const normalized = error instanceof Error ? error : new Error(String(error ?? 'Unknown error'))
  const details = {
    name: redactSecretText(normalized.name || 'Error').slice(0, 120),
    message: redactSecretText(normalized.message || 'Unknown error').slice(0, 2000)
  }
  if (normalized.code != null) details.code = redactSecretText(normalized.code).slice(0, 120)
  if (normalized.stack) details.stack = redactSecretText(normalized.stack).slice(0, 8000)
  return details
}
