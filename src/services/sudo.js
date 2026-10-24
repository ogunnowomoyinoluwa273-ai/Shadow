import { normalizeJid } from '../utils/jid.js'
import { UserFacingError } from '../utils/errors.js'

export function createSudoService(store) {
  const list = () => Array.isArray(store.get()) ? store.get() : []
  const has = jid => Boolean(jid) && list().some(item => normalizeJid(item) === normalizeJid(jid))
  const add = async jid => { const normalized = normalizeJid(jid); if (!normalized) throw new UserFacingError('Invalid participant identity.'); if (!has(normalized)) await store.update(current => [...listFrom(current), normalized]); return normalized }
  const remove = async jid => { const normalized = normalizeJid(jid); await store.update(current => listFrom(current).filter(item => normalizeJid(item) !== normalized)); return normalized }
  const listFrom = value => Array.isArray(value) ? value : []
  return { list, has, add, remove }
}
