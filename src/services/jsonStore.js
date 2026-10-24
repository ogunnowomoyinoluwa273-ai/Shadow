import fs from 'node:fs/promises'
import path from 'node:path'

export async function createJsonStore(file, initial = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  let data = initial
  async function load() { try { data = JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error; await save() } return data }
  await load()
  async function save() { await fs.writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 }) }
  return { get: () => data, async update(fn) { const next = await fn(data); if (next !== undefined) data = next; await save(); return data }, save, reload: load }
}
