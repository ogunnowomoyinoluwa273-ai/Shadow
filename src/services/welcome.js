import { participantMention } from '../utils/jid.js'
export function renderTemplate(template, { user, group, count }) { return String(template).replaceAll('{user}', participantMention(user)).replaceAll('{group}', group || 'this group').replaceAll('{count}', String(count ?? '?')) }
