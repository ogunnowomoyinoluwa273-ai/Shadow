export const isGroupJid = jid => typeof jid === 'string' && jid.endsWith('@g.us')
export const normalizeJid = jid => typeof jid === 'string' ? jid.trim().toLowerCase() : ''
export const jidWithoutDevice = jid => normalizeJid(jid).replace(/:\d+(?=@)/, '')
export const sameJid = (a, b) => jidWithoutDevice(a) === jidWithoutDevice(b)
export const participantId = participant => participant?.id || participant?.jid || ''
export const participantIds = participant => [participant?.id, participant?.jid, participant?.lid, participant?.phoneNumber].filter(Boolean)
export const participantMention = jid => jid ? `@${jid.split('@')[0].split(':')[0]}` : '@user'
export function bareNumber(jid) { return normalizeJid(jid).split('@')[0].split(':')[0].replace(/\D/g, '') }
