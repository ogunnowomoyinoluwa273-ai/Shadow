# Handoff

## Stopping point

Phase 1 audit and repair are complete in the sandbox. All registered commands were audited: owner/diagnostics, media, web utilities, general commands, group metadata, administration, moderation, settings, warnings, welcome/goodbye, anti-delete, and downloader handling. The latest verified working-copy baseline reports 70 passing tests and successful JavaScript syntax checks. Repairs include shared quoted-context extraction, document captions, wrapped media detection, event metrics wiring, correct promote/demote handling, calculator no-space coverage, translation source detection, Dictionary API fallback handling, Windows FFmpeg discovery, opt-in anti-delete recovery, the Baileys rc14 revoke-event path, and guarded yt-dlp downloader commands. Do not assume the latest archive has been installed or that live WhatsApp/provider behavior has been verified.

## Completed work

- Core modular bot implemented under `src/`.
- Exact dependency pinned to `@whiskeysockets/baileys@7.0.0-rc14`.
- Owner configuration was set in the user's local `.env` during the prior session; do not recreate or print secrets blindly.
- Owner self-command bug fixed by allowing explicit prefixed `fromMe` commands.
- Persistent sudo allowlist added through `src/services/sudo.js` and `data/sudo.json`.
- Command authorization added in `src/handlers/messageHandler.js`.
- `.addsudo`, `.delsudo`, and `.sudos` added in `src/commands/registry.js`.
- Bot-admin identity matching hardened in `src/utils/jid.js` and `src/utils/permissions.js`.
- Phase 2 added `.mute`, `.unmute`, `.slowmode`, safe `.clear`, `.stats`, `.reload`, guarded `.broadcast`, `.disablecmd`, and `.enablecmd`.
- The requested command batch added `.sticker`, `.toimage`, `.tomp3`, `.media`, `.setname`, `.setdescription`, `.invite`, `.revokeinvite`, `.joinrequest`, `.group link`, `.weather`, `.translate`, `.calculate`, `.define`, `.shortlink`, and `.qr`.
- `.translate` now accepts a reply with no text for auto-detected English output, a reply plus a target language name/code, or the existing manual language-plus-text form. Text and image/video captions are supported; unsupported media produces a clean usage/error response.
- Phase 1 fixed the shared `getContext` limitation that previously read context only from `extendedTextMessage`, so quoted image/video/document captions and mentions now work across relevant commands. `resolveTarget` and media detection use the shared unwrapped context path.
- Phase 1 fixed metrics not being passed from `eventHandler` into `messageHandler`; `.stats` now receives runtime counts. Promote/demote participant events no longer trigger goodbye messages.
- `.define` now falls back from Dictionary API to Datamuse when the primary provider returns an outage such as HTTP 530; `ineffable` was verified through the fallback response shape.
- `.antidelete on|off` is an admin-only per-group toggle. Enabled groups cache recent messages in memory for up to 24 hours, notify when a cached message is deleted, and attempt to resend text or downloadable media. `ANTIDELETE_LOG_JID` optionally receives a notice and recovered copy.
- Baileys rc14 emits Delete for Everyone through `messages.update` with a REVOKE stub and the original key nested in `update.key`; this is now handled in addition to `messages.delete`.
- Recovered text now uses the requested branded format: sender display name and original text, `Shadow: ♠️ Shadow sees all...`, and `**Recovered message:** <text>`. The recovery resend omits mentions to avoid failures with unusual participant identities.
- Final live-log diagnosis: `update.key` is the revoke protocol envelope, not the deleted message. The deleted message key is the outer `messages.update` item's `key`; the handler now prioritizes that key, preventing recovery of `type: protocolMessage`.
- Downloader phase added `.yta`, `.ytv`, `.play`, `.tiktok`, `.insta`, `.fb`, and `.twitter` through `src/services/downloader.js`. It uses `execFile`, validates supported HTTPS hosts, keeps the 50 MiB default size limit (configurable up to 100 MiB), three-minute timeout, one-job concurrency, temporary cleanup, and chat/sender-bound five-minute play sessions. Video is SD (up to 480p) by default and HD (720p–1080p) only with a trailing `hd`; unavailable tiers do not cross-fallback and size errors explain the cap. The official `yt-dlp.exe` must be installed on Windows or configured with `YTDLP_PATH`.

## Tests and results

The latest sandbox run executed `npm test`: 69 tests passed. Syntax checks passed for all JavaScript files. Translation and dictionary provider calls are mocked in tests, with separate live probes for Japanese translation and Datamuse `ineffable`; anti-delete uses mocked Baileys `messages.update` and deletion events, including branded recovery output. Downloader URL validation and mocked search-session ownership pass. Windows Node-side yt-dlp access was then verified from `C:\Users\User\Downloads\whatsapp-bot-owner-fix\whatsapp-bot`; the resolver found `C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe`. No `YTDLP_PATH` override is currently required. The downloader now probes final streams with FFprobe, rejects incomplete output, conditionally converts incompatible video to H.264/AAC MP4 or audio to MP3, requests audio-only sources, selects SD video up to 480p by default and HD 720p–1080p only when explicitly requested, and uses bounded fragment concurrency/retries. `.play` search is metadata-only, pasted URLs download directly as audio, and numbered selections use audio extraction with optional HD bitrate. `.menu` is the compact Shadow command directory with prefix plus Unicode-bold uppercase names and no descriptions; `.help` remains the descriptive synchronized control center. `.ping` now works in private chats and groups and sends one response formatted as `Pong! You think you can match my speed? ⚡: Nms`. Its rounded milliseconds measure local bot-side handling time from receipt to just before sending; they are not WhatsApp network RTT. Added `.anime`, `.character`, `.seasonal`, `.animesong`, `.waifu`, `.anibattle`, `.animequiz`, `.recommend`, `.manga`, `.neko`, `.animequote`, `.animegenre`, `.animepopular`, `.hug`, `.slap`, `.kiss`, `.pat`, `.bonk`, `.cry`, `.bite`, and `.greet`. The timeout investigation confirmed Jikan TLS/connectivity failure near 10 seconds and Waifu.im HTTP 403; AniList is now primary, Jikan is a short fallback, and Nekos.best supplies SFW character images; reactions use `src/services/reactions.js` and the animegifs API, converted with FFmpeg `libwebp_anim` to animated WebP stickers sent as Baileys sticker messages. Earlier live probes measured manga, animegenre, animepopular, and neko. Animegifs `hug` and `pout` API JSON responses were checked. Upstream docs list `Pout`; live provider GIF bytes and authenticated Baileys delivery remain untested. A generated local GIF passed the actual FFmpeg sticker-conversion path. A live `.animesong Naruto` metadata query returned eight theme-video results in ~4.2s. `.animesong` now downloads the first opening (or first ending if no opening exists) through the bounded audio pipeline and sends MP3 only; it rejects non-`v.animethemes.moe` video sources and does not return search links. The metadata query was live-tested, but audio transfer via the active Windows WhatsApp bot still needs validation. Replace the Windows copy with the updated archive and live-test `.menu`, `.help`, the anime commands, `.manga One Piece`, `.neko`, `.animequote`, `.animegenre Action`, `.animepopular`, `.hug`, `.slap`, `.kiss`, `.pat`, `.bonk`, `.cry`, `.bite`, `.hmph`, `.Gojo`, and `.greet`, plus the existing downloader commands. Other provider responses and image delivery were tested from the sandbox but not through the user’s Windows WhatsApp connection. The animegifs API response was checked read-only; no reaction GIF bytes or WhatsApp message were sent. Public-provider rate limits, asset licensing, and data freshness remain limitations. This update tested platform failure paths with mocked yt-dlp errors; no live media download ran because yt-dlp is absent from the current sandbox.

## Known limitations

- The bot runs only while its host process is running. Local Windows shutdown stops it.
- 24/7 deployment to a VPS or always-on machine is not completed.
- The active Windows copy may differ from the sandbox code.
- Multi-file auth and JSON stores are suitable for modest use but not high-concurrency production.
- WhatsApp server permissions and identity mappings remain authoritative.

## Next recommended action

1. Install the audited package in the active Windows project while preserving `.env`, `data/auth`, and JSON state.
2. On Windows, run the Node-side `yt-dlp --version` and `ffmpeg -version` checks from the Shadow project folder, verify Baileys rc14, and run the 70-test suite. Set `YTDLP_PATH` only if PATH lookup fails; restart Shadow after PATH changes. If FFmpeg resolution still fails, set `FFMPEG_PATH` in `.env` to the full `ffmpeg.exe` path.
3. Live-test owner commands, sudo grant/revoke, and unauthorized rejection.
4. In a test group/chat, live-test `.yta`, `.ytv`, `.play` search/direct-URL/result selection and expiry, cross-user selection rejection, each social downloader at default SD and explicit HD where available, `.antidelete on|off`, deleting text/media, optional log forwarding, reply translation, media conversions, group metadata/admin operations, warnings, settings, and diagnostics.
5. Keep `BROADCAST_GROUPS` empty unless explicit guarded broadcasts are required.
6. Record live-only failures before adding AI integration or further features.
7. Plan the proposed Anime Games replacement before removing `.animequiz`. Candidate names (`.akinator`, `.guessanime`, `.animehint`, `.animescore`) remain unfinalized. Define game flows, chat-scoped state, expiry/cancellation, data and score persistence, and tests first; implement that as a separate change after command names and behavior are approved.

## Relevant files

- `src/handlers/messageHandler.js`: message parsing, deduplication, command authorization, self-command handling.
- `src/utils/permissions.js`: owner, sender, group-admin, and bot-admin identity checks.
- `src/utils/jid.js`: LID/PN/device JID normalization.
- `src/commands/registry.js`: command definitions and sudo commands.
- `src/services/sudo.js`: persistent sudo allowlist logic.
- `src/connection/connect.js`: Baileys connection, QR, auth, reconnect lifecycle.
- `tests/bot.test.js`: mocked regression tests.


## Error-handling robustness update

Unexpected command failures now receive only the generic chat response `The request failed. Please try again shortly.` Intentional usage, permission, input-validation, and download-tier guidance is tagged as `UserFacingError` and remains actionable. Exception name/message/stack are logged through a sanitizer that redacts common bearer values, credential-bearing URLs, and secret assignments; pairing codes are not written to structured logs. Uncaught exceptions and unhandled rejections trigger one bounded socket close, suppress reconnect, set exit status 1, and force termination after the grace period so an external process manager can restart the bot. Validation at the error-hardening stage: 64 tests and syntax checks passed; the animated-sticker update brings the current suite to 70 tests.


## Animated reaction sticker update (2026-10-24)

All seven action reactions and `.hmph` now send animated WebP stickers through Baileys `{ sticker, isAnimated: true }`; the MP4/`gifPlayback` route was removed. The shared AnimeGifs service uses FFmpeg `libwebp_anim`, checks 512 × 512 dimensions and animation chunks, limits duration to 8 seconds and output to 500,000 bytes, tries lower-rate/quality profiles when needed, and keeps a bounded 24-hour in-memory cache. Existing action labels and `.hmph`'s randomly selected line are companion text; provider, conversion, or sticker-send failures fall back to text alone. FFmpeg smoke-tested a generated local moving GIF into a 5,930-byte RIFF/WebP output; the sandbox FFmpeg 6.1.1 decoder could not decode the complete animation (`image data not found`), while an extracted static VP8 frame decoded. WhatsApp rendering remains unverified. `npm test`: 70 passed, 0 failed; `npm run check` and JavaScript syntax checks passed. No live AnimeGifs GIF or authenticated WhatsApp sticker send was tested. The user's `.env`, `data/auth`, owner configuration, prefix, and local JSON files were not changed.

## Greeting refactor (2026-10-26)
The retired character-selection command has been removed from code, inventories, tests, documentation, and the included runtime settings snapshot. `.greet` remains available as a group-only prefix command with a simple optional audience. Natural-language greeting requests are handled by `src/services/aiBrain.js`: they infer group versus private audience, preserve explicit tone/audience instructions, use the fast Gemini model, omit unrelated tools, and do not claim that anyone was tagged or contacted. The updated suite reports 123 passed and 0 failed; syntax checks passed.

Live verification remains: configure `GEMINI_API_KEY`, restart Shadow, and test `Shadow, greet`, `Shadow, greet the group`, `Shadow, say hello`, and `.greet` from an authorized account in a test group/private chat.

## WhatsApp reply awareness (2026-10-26)
Reply-aware processing is implemented in `src/utils/message.js`, `src/handlers/messageHandler.js`, and `src/services/aiBrain.js`. Quoted text/captions and safe media metadata are extracted from Baileys `contextInfo.quotedMessage`; sender identity is kept separate from the requester and classified against Shadow/owner/participant identities. Gemini receives bounded context for replies to users or Shadow and an explicit no-invention message when the quote is unavailable. The full suite reports 129 passed and 0 failed; syntax checks passed.

Live next step: with the existing Windows `.env` and `data/auth` preserved, restart Shadow and test replies to a participant message, a Shadow message, an image caption, a sticker/media message, and a deleted/unavailable message using `Shadow, what do you think?`, `Shadow, explain this`, `Shadow, reply to this`, and `Shadow, cook him`.

## WhatsApp reply awareness (2026-10-26)
Reply-aware processing is implemented in `src/utils/message.js`, `src/handlers/messageHandler.js`, and `src/services/aiBrain.js`. Quoted text/captions and safe media metadata are extracted from Baileys `contextInfo.quotedMessage`; sender identity is kept separate from the requester and classified against Shadow/owner/participant identities. Gemini receives bounded context for replies to users or Shadow and an explicit no-invention message when the quote is unavailable. The full suite reports 129 passed and 0 failed; syntax checks passed.

Live next step: with the existing Windows `.env` and `data/auth` preserved, restart Shadow and test replies to a participant message, a Shadow message, an image caption, a sticker/media message, and a deleted/unavailable message using `Shadow, what do you think?`, `Shadow, explain this`, `Shadow, reply to this`, and `Shadow, cook him`.
