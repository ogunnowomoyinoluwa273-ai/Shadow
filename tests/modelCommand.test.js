import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCommands } from '../src/commands/registry.js'
import { createModelRouter } from '../src/services/modelRouter.js'

function setup() {
  const modelRouter = createModelRouter({ store: { get: () => ({}), update: async fn => fn({}) }, apiKey: 'test' })
  const commands = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}), update: async fn => fn({}) }, sudo: { has: () => true, list: () => [], add: async () => {}, remove: async () => {} }, startedAt: Date.now(), downloader: {}, modelRouter })
  return { command: commands.lookup('aimodel'), modelRouter }
}

test('.aimodel displays both choices and current model', async () => {
  const { command } = setup(); const replies = []
  await command.run({ sock: {}, message: { key: { remoteJid: 'owner@s.whatsapp.net' } }, args: [], reply: async text => replies.push(text) })
  assert.match(replies[0], /Gemini 3\.5 Flash/); assert.match(replies[0], /DeepSeek V4\.1 Flash/); assert.match(replies[0], /Current model: Gemini 3\.5 Flash/)
})

test('.aimodel 2 and status switch and report the active model', async () => {
  const { command } = setup(); const replies = []; const message = { key: { remoteJid: 'owner@s.whatsapp.net', participant: 'owner@s.whatsapp.net' } }; const sock = { user: { id: 'bot@s.whatsapp.net' } }
  await command.run({ sock, message, args: ['2'], reply: async text => replies.push(text) })
  await command.run({ sock, message, args: ['status'], reply: async text => replies.push(text) })
  assert.match(replies[0], /Switched.*DeepSeek/); assert.match(replies[1], /Active AI model: DeepSeek/)
})
