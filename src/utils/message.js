import { getContentType } from '@whiskeysockets/baileys'

export function unwrapMessage(message) {
  let current = message?.message
  while (current?.ephemeralMessage || current?.viewOnceMessage || current?.documentWithCaptionMessage) current = current.ephemeralMessage?.message || current.viewOnceMessage?.message || current.documentWithCaptionMessage?.message
  return current || {}
}
export function extractText(message) {
  const content = unwrapMessage(message)
  const type = getContentType(content)
  if (type === 'conversation') return content.conversation || ''
  if (type === 'extendedTextMessage') return content.extendedTextMessage?.text || ''
  if (type === 'imageMessage' || type === 'videoMessage' || type === 'documentMessage') return content[type]?.caption || ''
  return ''
}
export function getContext(message) {
  const content = unwrapMessage(message)
  for (const value of Object.values(content)) {
    if (value?.contextInfo) return value.contextInfo
  }
  return {}
}
export function getSender(message) { return message?.key?.participant || message?.key?.remoteJid || '' }
export function getMentions(message) { return getContext(message).mentionedJid || [] }
export function getQuoted(message) { const context = getContext(message); const q = context.quotedMessage; return q ? { key: { remoteJid: message.key.remoteJid, fromMe: false, id: context.stanzaId, participant: context.participant }, message: q } : null }
export function parseCommand(text, prefix) {
  if (!text.startsWith(prefix)) return null
  const body = text.slice(prefix.length).trim()
  if (!body) return null
  const [command, ...args] = body.split(/\s+/)
  return { command: command.toLowerCase(), args, rawArgs: body.slice(command.length).trim() }
}
export function formatDuration(seconds) {
  const s = Math.floor(seconds); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sec}s`].filter(Boolean).join(' ')
}
