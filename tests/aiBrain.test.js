import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGreetingPrompt, createContextStore, createGeminiBrain, createToolRegistry, formatQuotedMessageContext, isGreetingIntent, parseShadowAddress, selectToolsForPrompt, shouldExposeCommandTool } from '../src/services/aiBrain.js'
import { buildCommands } from '../src/commands/registry.js'

test('recognizes Shadow only at the start and preserves the request', () => {
  assert.equal(parseShadowAddress('Shadow, explain photosynthesis'), 'explain photosynthesis')
  assert.equal(parseShadowAddress('  SHADOW: find an anime  '), 'find an anime')
  assert.equal(parseShadowAddress('shadow'), '')
  assert.equal(parseShadowAddress('shadowed words'), null)
  assert.equal(parseShadowAddress('please shadow this'), null)
})

test('only owner or sudo users can invoke Gemini', async () => {
  let calls = 0
  const client = { interactions: { create: async () => { calls += 1; return { output_text: 'answer', steps: [] } } } }
  const sent = []
  const brain = createGeminiBrain({ client, config: { geminiModel: 'test', geminiTimeoutMs: 1000 }, sudo: { has: jid => jid === 'sudo@s.whatsapp.net' } })
  const message = { key: { remoteJid: 'chat@s.whatsapp.net', id: '1' } }
  const sock = { sendMessage: async (...args) => sent.push(args) }
  await brain.run({ text: 'Shadow, hello', message, sock, sender: 'random@s.whatsapp.net', owner: false })
  assert.equal(calls, 0)
  assert.equal(sent.length, 0)
  await brain.run({ text: 'Shadow, hello', message: { ...message, key: { ...message.key, id: '2' } }, sock, sender: 'sudo@s.whatsapp.net', owner: false })
  assert.equal(calls, 1)
  assert.match(sent.find(item => item[1]?.text)?.[1].text, /answer/)
})

test('a bare Shadow greeting is generated naturally without tools', async () => {
  let calls = 0
  let request
  const brain = createGeminiBrain({ client: { interactions: { create: async value => { calls += 1; request = value; return { output_text: 'Hey. What are we working on?', steps: [] } } } }, config: { geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  const sent = []
  await brain.run({ text: 'Shadow', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: '1' } }, sock: { sendMessage: async (...args) => sent.push(args) }, sender: 'sudo@s.whatsapp.net' })
  assert.equal(calls, 1)
  assert.equal('tools' in request, false)
  assert.equal(request.model, 'gemini-3.5-flash-lite')
  assert.equal(request.generation_config.thinking_level, 'minimal')
  assert.match(request.input, /user addressed you by saying only.*Shadow/i)
  assert.match(sent.find(item => item[1]?.text)?.[1].text, /working on/)
})

test('ordinary conversation sends no tool registry', async () => {
  let request
  const brain = createGeminiBrain({ client: { interactions: { create: async value => { request = value; return { output_text: 'I am doing well.', steps: [] } } } }, config: { geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  const sent = []
  await brain.run({ text: 'Shadow, how are you?', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: '1' } }, sock: { sendMessage: async (...args) => sent.push(args) }, sender: 'sudo@s.whatsapp.net' })
  assert.equal('tools' in request, false)
  assert.match(sent.find(item => item[1]?.text)?.[1].text, /doing well/)
})

test('ordinary Gemini timeout returns a concise failure', async () => {
  const brain = createGeminiBrain({ client: { interactions: { create: async () => new Promise(() => {}) } }, config: { geminiTimeoutMs: 5 }, sudo: { has: () => true }, logger: { error: () => {} } })
  const sent = []
  await brain.run({ text: 'Shadow, hello', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: '1' } }, sock: { sendMessage: async (...args) => sent.push(args) }, sender: 'sudo@s.whatsapp.net' })
  assert.match(sent.find(item => item[1]?.text)?.[1].text, /did not respond in time/)
})

test('executes a declared Gemini tool and returns its real result', async () => {
  const requests = []
  const client = { interactions: { create: async request => {
    requests.push(request)
    return requests.length === 1
      ? { id: 'interaction-1', steps: [{ type: 'function_call', name: 'calculate', id: 'call-1', arguments: { value: 'ok' } }] }
      : { steps: [], output_text: 'The tool returned ok.' }
  } }
  }
  const executed = []
  const brain = createGeminiBrain({ client, config: { geminiModel: 'test', geminiTimeoutMs: 1000 }, sudo: { has: () => true }, toolFactory: () => ({ declarations: [{ type: 'function', name: 'calculate', description: 'demo', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }], byName: new Map([['calculate', { execute: async args => { executed.push(args); return { ok: true, value: args.value } } }]]) }) })
  const sent = []
  await brain.run({ text: 'Shadow, calculate the demo', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: '1' } }, sock: { sendMessage: async (...args) => sent.push(args) }, sender: 'sudo@s.whatsapp.net' })
  assert.deepEqual(executed, [{ value: 'ok' }])
  assert.equal(requests[0].input, 'calculate the demo')
  assert.deepEqual(requests[0].tools.map(tool => tool.name), ['calculate'])
  assert.equal(requests[1].previous_interaction_id, 'interaction-1')
  assert.match(requests[1].input[0].result, /"value":"ok"/)
  assert.match(sent.find(item => item[1]?.text)?.[1].text, /tool returned ok/)
})

test('context is isolated by conversation and sender and expires', () => {
  let now = 0
  const context = createContextStore({ now: () => now, ttlMs: 100, maxTurns: 2 })
  context.add('chat-a:user-a', 'user', 'private-a')
  context.add('chat-b:user-b', 'user', 'private-b')
  assert.deepEqual(context.get('chat-a:user-a').map(item => item.content), ['private-a'])
  assert.deepEqual(context.get('chat-b:user-b').map(item => item.content), ['private-b'])
  now = 101
  assert.deepEqual(context.get('chat-a:user-a'), [])
})

test('greeting intent is recognized and builds the correct group or private audience prompt', () => {
  assert.equal(isGreetingIntent('greet'), true)
  assert.equal(isGreetingIntent('welcome everyone in a funny way'), true)
  assert.equal(isGreetingIntent('say hello to the group'), true)
  assert.equal(isGreetingIntent('explain anime power systems'), false)
  assert.match(buildGreetingPrompt('greet in a funny way', { isGroup: true }), /current WhatsApp group/i)
  assert.match(buildGreetingPrompt('greet', { isGroup: false }), /current private chat/i)
})
test('natural-language greetings use the fast model without unrelated tools and vary by prompt', async () => {
  const requests = []
  const client = { interactions: { create: async request => { requests.push(request); return { output_text: requests.length === 1 ? 'Welcome, everyone. Try not to cause a diplomatic incident before lunch.' : 'Hey there. You made it—what are we getting into?' } } } }
  const brain = createGeminiBrain({ client, config: { geminiFastModel: 'fast-test', geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  const sent = []
  const sock = { sendMessage: async (...args) => sent.push(args) }
  await brain.run({ text: 'Shadow, greet the group in a funny way', message: { key: { remoteJid: '123@g.us', id: 'greet-group' } }, sock, sender: 'sudo@s.whatsapp.net' })
  await brain.run({ text: 'Shadow, say hello', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'greet-private' } }, sock, sender: 'sudo@s.whatsapp.net' })
  assert.equal(requests[0].model, 'fast-test')
  assert.equal('tools' in requests[0], false)
  assert.match(requests[0].input, /current WhatsApp group/i)
  assert.match(requests[1].input, /current private chat/i)
  const greetingTexts = sent.map(item => item[1]?.text).filter(Boolean)
  assert.equal(greetingTexts.length, 2)
  assert.notEqual(greetingTexts[0], greetingTexts[1])
})
test('replies to another user include quoted text and preserve sender identity', async () => {
  let request
  const brain = createGeminiBrain({ client: { interactions: { create: async value => { request = value; return { output_text: 'I would say the quoted remark is not a useful argument.' } } } }, config: { geminiFastModel: 'fast-test', geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  const sent = []
  await brain.run({ text: 'Shadow, what do you think?', message: { key: { remoteJid: '123@g.us', id: 'reply-1' } }, quoted: { sender: 'friend@s.whatsapp.net', role: 'participant', type: 'conversation', text: 'Shadow is stupid', stanzaId: 'original-1' }, sock: { sendMessage: async (...args) => sent.push(args) }, sender: 'requester@s.whatsapp.net' })
  assert.match(request.input, /Shadow is stupid/)
  assert.match(request.input, /another participant/)
  assert.match(request.input, /friend@s\.whatsapp\.net/)
  assert.match(sent.find(item => item[1]?.text)?.[1].text, /quoted remark/)
})
test('replies to Shadow include the bot role and short contextual instructions', async () => {
  let request
  const brain = createGeminiBrain({ client: { interactions: { create: async value => { request = value; return { output_text: 'Fair correction. I should have been clearer.' } } } }, config: { geminiFastModel: 'fast-test', geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  await brain.run({ text: 'Shadow, explain this', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'reply-2' } }, quoted: { sender: 'shadow@s.whatsapp.net', role: 'shadow', type: 'conversation', text: 'The answer is definitely 42.', stanzaId: 'original-2' }, sock: { sendMessage: async () => {} }, sender: 'sudo@s.whatsapp.net' })
  assert.match(request.input, /Shadow \(the bot\)/)
  assert.match(request.input, /The answer is definitely 42\./)
  assert.match(formatQuotedMessageContext('cook him', { sender: 'friend@s.whatsapp.net', role: 'participant', type: 'conversation', text: 'That was weak.' }), /Treat the quoted sender as separate/)
})
test('missing quoted content produces an explicit no-invention context', async () => {
  let request
  const brain = createGeminiBrain({ client: { interactions: { create: async value => { request = value; return { output_text: 'I cannot see the message you meant to reference.' } } } }, config: { geminiFastModel: 'fast-test', geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  await brain.run({ text: 'Shadow, reply to this', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'reply-3' } }, sock: { sendMessage: async () => {} }, sender: 'sudo@s.whatsapp.net' })
  assert.match(request.input, /no usable quoted WhatsApp message content/i)
  assert.match(request.input, /Do not invent the missing message/i)
})

test('hmph requests select the sticker tool and send existing pout assets', async () => {
  const sent = []
  const loaded = []
  const registry = createToolRegistry({ reactions: { loadSticker: async action => { loaded.push(action); return Buffer.from('sticker') } }, sock: { sendMessage: async (...args) => sent.push(args) }, message: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'hmph-1' } } })
  const selected = selectToolsForPrompt('make me 5 hmph stickers', registry)
  assert.deepEqual(selected.declarations.map(tool => tool.name), ['send_reaction_stickers'])
  await selected.byName.get('send_reaction_stickers').execute({ action: 'hmph', quantity: 5 })
  assert.deepEqual(loaded, ['pout', 'pout', 'pout', 'pout', 'pout'])
  assert.equal(sent.length, 5)
})

test('hmph requests explain when existing sticker capability is unavailable', async () => {
  const sent = []
  const brain = createGeminiBrain({ client: { interactions: { create: async () => ({ output_text: 'should not be called' }) } }, config: { geminiTimeoutMs: 1000 }, sudo: { has: () => true } })
  await brain.run({ text: 'Shadow, make me 5 hmph stickers', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'hmph-2' } }, sock: { sendMessage: async (...args) => sent.push(args) }, sender: 'sudo@s.whatsapp.net' })
  assert.match(sent[0][1].text, /existing reaction stickers/i)
  assert.match(sent[0][1].text, /cannot generate new artwork/i)
})

test('less-obvious command phrasing selects the existing command tool', () => {
  const registry = createToolRegistry({ commands: { allCommands: [{ name: 'setdescription' }, { name: 'joinrequest' }, { name: 'anibattle' }, { name: 'shortlink' }], lookup: () => ({}) }, sock: { sendMessage: async () => {} }, message: { key: { remoteJid: 'chat@s.whatsapp.net' } } })
  for (const prompt of ['change our group description', 'approve the pending join request', 'compare Naruto and Ichigo', 'shorten this link']) assert.ok(selectToolsForPrompt(prompt, registry).byName.has('run_existing_command'), prompt)
})

test('follow-up wording retains command routing from recent command context', () => {
  const registry = createToolRegistry({ commands: { allCommands: [{ name: 'ytv' }], lookup: () => ({}) }, sock: { sendMessage: async () => {} }, message: { key: { remoteJid: 'chat@s.whatsapp.net' } } })
  assert.ok(selectToolsForPrompt('download the video hd', registry).byName.has('run_existing_command'))
})

test('every command from the actual registry reaches the generic natural-language tool without a command keyword list', () => {
  const commands = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {}, has: () => false }, startedAt: Date.now() })
  const registry = createToolRegistry({ commands, sock: { sendMessage: async () => {} }, message: { key: { remoteJid: 'chat@s.whatsapp.net' } } })
  for (const command of commands.allCommands.filter(command => command.name !== 'greet')) {
    assert.equal(shouldExposeCommandTool(command.name, { commands }), true, `${command.name} was not routable`)
    assert.ok(selectToolsForPrompt(command.name, registry).byName.has('run_existing_command'), `${command.name} did not expose run_existing_command`)
  }
})

test('registry descriptions make natural paraphrases routable and recent command context carries follow-ups', () => {
  const commands = buildCommands({ settings: { get: () => ({}) }, warnings: { get: () => ({}) }, sudo: { list: () => [], add: async () => {}, remove: async () => {}, has: () => false }, startedAt: Date.now() })
  for (const prompt of ['show who owns this bot', 'make this replied media into a sticker', 'turn on anti link protection', 'what are the group rules', 'switch to the other model', 'send the anime opening as audio']) assert.equal(shouldExposeCommandTool(prompt, { commands }), true, prompt)
  assert.equal(shouldExposeCommandTool('hd', { commands, history: [{ role: 'user', content: 'download the YouTube video' }] }), true)
})

test('rate-limit responses enter a local cooldown without retrying Gemini', async () => {
  let calls = 0
  const sent = []
  const brain = createGeminiBrain({ client: { interactions: { create: async () => { calls += 1; const error = new Error('Rate limit exceeded. Please retry in 1h'); error.status = 429; throw error } } }, config: { geminiTimeoutMs: 1000 }, sudo: { has: () => true }, logger: { error: () => {} } })
  const input = { text: 'Shadow, hello', message: { key: { remoteJid: 'chat@s.whatsapp.net', id: 'quota-1' } }, sock: { sendMessage: async (...args) => sent.push(args) }, sender: 'sudo@s.whatsapp.net' }
  await brain.run(input)
  await brain.run({ ...input, message: { ...input.message, key: { ...input.message.key, id: 'quota-2' } } })
  assert.equal(calls, 1)
  assert.match(sent.at(-1)[1].text, /rate-limited/i)
})
