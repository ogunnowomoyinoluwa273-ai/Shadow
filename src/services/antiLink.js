const groupInvite = /https?:\/\/(?:chat\.whatsapp\.com|wa\.me)\/[\w-]+/i
const anyUrl = /https?:\/\/[^\s]+/i
export function detectProhibitedLink(text, settings) { if (!settings?.antiLink) return false; if (groupInvite.test(text)) return true; return Boolean(settings.antiLinkAllUrls && anyUrl.test(text)) }
