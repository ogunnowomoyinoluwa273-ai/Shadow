import fs from 'node:fs/promises'
import { config, validateConfig } from './config.js'
import { createJsonStore } from './services/jsonStore.js'
import { createGroupSettings } from './services/groupSettings.js'
import { createSudoService } from './services/sudo.js'
import { createMemoryService } from './services/memory.js'
import { buildCommands } from './commands/registry.js'
import { startConnection } from './connection/connect.js'
import { attachHandlers } from './handlers/eventHandler.js'
import { createDownloader } from './services/downloader.js'
import { createReactionService } from './services/reactions.js'
import { createGeminiBrain } from './services/aiBrain.js'
import { createImageGenerationService } from './services/imageGeneration.js'
import { createModelRouter } from './services/modelRouter.js'
import { logger } from './utils/logger.js'
import { errorLogDetails } from './utils/errors.js'
import { createFatalProcessErrorHandler } from './utils/processSafety.js'
validateConfig()
await fs.mkdir(config.authDir, { recursive: true, mode: 0o700 })
const settingsStore = await createJsonStore(config.settingsFile)
const warningStore = await createJsonStore(config.warningsFile)
const sudoStore = await createJsonStore(config.sudoFile, [])
const memoryStore = await createJsonStore(config.memoryFile, {})
const modelStore = await createJsonStore(config.modelFile, { activeModel: 'gemini' })
const settings = createGroupSettings(settingsStore, config)
const sudo = createSudoService(sudoStore)
const memory = createMemoryService(memoryStore)
const metrics = { messagesSeen: 0, commandsExecuted: 0, deniedCommands: 0, moderationActions: 0, errors: 0 }
const modelRouter = createModelRouter({ store: modelStore })
const reload = async () => { await settingsStore.reload(); await warningStore.reload(); await sudoStore.reload(); await memoryStore.reload(); await modelStore.reload() }
const startedAt = Date.now(); const downloader = createDownloader({ config }); const reactions = createReactionService(); const imageGenerator = createImageGenerationService({ model: config.imageModel, timeoutMs: config.imageTimeoutMs }); const aiBrain = createGeminiBrain({ config, sudo, memory, imageGenerator, modelRouter }); const commands = buildCommands({ settings, warnings: warningStore, sudo, startedAt, metrics, reload, downloader, reactions, modelRouter }); const seen = new Set()
let currentSocket; let shuttingDown = false; let reconnecting = false

async function connect() {
  currentSocket = await startConnection({
    onSocket: sock => { attachHandlers({ sock, commands, settings, config, seen, aiBrain, reactions, modelRouter, metrics }); reconnecting = false },
    onClosed: async ({ permanent }) => { if (shuttingDown || permanent || reconnecting) return; reconnecting = true; setTimeout(() => { if (shuttingDown) return; connect().catch(error => { logger.error({ err: errorLogDetails(error) }, 'Reconnect attempt failed'); reconnecting = false }) }, 3000) }
  })
}
async function shutdown(signal) { if (shuttingDown) return; shuttingDown = true; logger.info({ signal }, 'Shutting down'); try { currentSocket?.end?.(new Error('Process shutdown')) } catch {} process.exit(0) }
const handleFatalProcessError = createFatalProcessErrorHandler({ logger, getSocket: () => currentSocket, markShuttingDown: () => { shuttingDown = true; reconnecting = false } })
process.once('SIGINT', () => shutdown('SIGINT')); process.once('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', reason => handleFatalProcessError('Unhandled promise rejection', reason))
process.on('uncaughtException', error => handleFatalProcessError('Uncaught exception', error))
logger.info({ bot: config.botName, prefix: config.prefix }, 'Starting secure WhatsApp bot')
await connect()
