import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../src/services/jsonStore.js'
import { createMemoryService } from '../src/services/memory.js'

test('persistent memory saves, recalls, deletes, and isolates users', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-memory-'))
  const file = path.join(dir, 'memories.json')
  try {
    const store = await createJsonStore(file, {})
    const memory = createMemoryService(store)
    const saved = await memory.remember('Alice@S.whatsapp.net', 'I prefer short answers.')
    await memory.remember('Bob@s.whatsapp.net', 'I like detailed answers.')
    assert.equal(memory.recall('alice@s.whatsapp.net', 'short').length, 1)
    assert.equal(memory.recall('alice@s.whatsapp.net', 'detailed').length, 0)
    assert.equal(await memory.forget('alice@s.whatsapp.net', saved.id), true)
    assert.equal(memory.recall('alice@s.whatsapp.net').length, 0)
    const reloaded = createMemoryService(await createJsonStore(file, {}))
    assert.equal(reloaded.recall('bob@s.whatsapp.net').length, 1)
    await reloaded.clear('bob@s.whatsapp.net')
    assert.equal(reloaded.recall('bob@s.whatsapp.net').length, 0)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
