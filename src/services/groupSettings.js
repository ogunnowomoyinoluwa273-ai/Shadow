export function createGroupSettings(store, config) {
  const defaults = () => ({ antiLink: config.antiLinkDefault, antiLinkAllUrls: false, antiDelete: false, welcome: false, goodbye: false, rules: 'Be respectful. Follow the group topic and WhatsApp rules.', support: '', mutedParticipants: [], slowmodeSeconds: 0, disabledCommands: [] })
  const get = jid => ({ ...defaults(), ...(store.get()[jid] || {}) })
  const set = async (jid, patch) => store.update(all => ({ ...all, [jid]: { ...get(jid), ...patch } }))
  return { get, set }
}
