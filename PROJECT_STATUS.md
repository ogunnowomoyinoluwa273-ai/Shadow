# Project Status

## Current state

The project is a modular Node.js WhatsApp bot using exactly `@whiskeysockets/baileys@7.0.0-rc14`, Node.js 20+, and ES modules.

Completed and tested in the sandbox:

- QR authentication, credential persistence, reconnect handling, and graceful shutdown.
- General and group-management command architecture.
- Owner commands from the linked WhatsApp account using Baileys `fromMe` messages.
- LID/PN/device-suffixed JID handling for owner and bot-admin checks.
- Persistent sudo authorization with `.addsudo`, `.delsudo`, and `.sudos`.
- Anti-link, welcome/goodbye, warnings, group settings, and duplicate-message safeguards.
- Windows packaging and handoff guidance.
- Reusable `secure-baileys-bot` Manus skill created separately under `/home/ubuntu/skills/secure-baileys-bot/`.
- Phase 1 command audit completed in the sandbox. Shared reply/context handling, metrics wiring, participant-event filtering, document captions, wrapped media detection, calculator no-space parsing, translation source detection, dictionary fallback handling, FFmpeg resolution, anti-delete recovery, and downloader command guards were checked and repaired where needed.

## Latest verified results

- Exact installed Baileys version: `7.0.0-rc14`.
- Automated tests: 70 passed.
- JavaScript syntax checks: passed.
- Skill validation: passed.
- Unexpected command errors now use a generic chat reply with sanitized diagnostics; fatal uncaught exceptions/rejections shut down with exit status 1 for process-manager recovery. All eight reaction commands now send animated WebP sticker payloads. `.hmph` pairs an original random line with an anime `pout` sticker and falls back to text on retrieval, conversion, or sending failure.

## Current phase

Phase 1 audit complete in the sandbox; live Windows provider validation remains. Anti-delete is implemented as a per-group opt-in feature with bounded in-memory recovery and optional log forwarding. The rc14 revoke handler now selects the outer deleted-message key rather than the protocol envelope key. Downloader phase is implemented around the existing yt-dlp provider with guarded public URL support, SD video up to 480p by default, explicit HD video from 720p to 1080p only when `hd` is supplied, no silent fallback between tiers, clear size-limit guidance, and expiring `.play` sessions. Audio `.yta`/`.play` defaults to 128 kbps MP3; `hd` requests 320 kbps output, with source fidelity varying. Windows Node-side yt-dlp resolution is verified from the active Shadow project and resolves the WinGet executable at `C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe`; no `YTDLP_PATH` override is currently required. Fixed yt-dlp size-limit formatting to send `50M`, fixed video output to prefer MP4, added FFprobe-backed final stream validation plus conditional H.264/AAC MP4 and MP3 conversion, and optimized source selection with audio-only downloads, SD video up to 480p by default and explicit HD video from 720p to 1080p only when requested, with no silent cross-tier fallback, bounded fragment concurrency/retries, and timeouts. `.play` numbered selections now correctly use the audio path. `.menu` is now a Shadow-branded command directory with live command count, date/time, version, uptime, prefix, category headings, and only implemented commands rendered as prefix plus Unicode-bold uppercase names; `.help` remains the separate descriptive Shadow control center. Generated MP4/MP3 fixtures passed the end-to-end downloader path. `.ping` now works in private chats and groups and sends one response formatted as `Pong! You think you can match my speed? ⚡: Nms`; its rounded milliseconds measure local bot-side handling time, not WhatsApp delivery RTT. Added `.anime`, `.character`, `.seasonal`, `.animesong`, `.waifu`, `.anibattle`, `.animequiz`, and `.recommend` under an ANIME menu category, plus `.manga`, `.neko`, `.animequote`, `.animegenre`, `.animepopular`, seven standard animated reaction commands plus `.hmph`, and persistent group `.greet`. Live timeout investigation confirmed Jikan TLS/connectivity failures near 10 seconds and Waifu.im HTTP 403; anime metadata now uses AniList first, Jikan only as a short fallback, and SFW character images use Nekos.best; reactions use the separate animegifs API service, converted to animated WebP by the installed FFmpeg `libwebp_anim` encoder, with bounded size/duration, an in-memory cache, Baileys sticker payloads, and text fallback. Earlier live probes completed for manga, animegenre, animepopular, and neko. Animegifs `hug` and `pout` API JSON responses were checked; live provider GIF bytes and authenticated WhatsApp sticker delivery remain untested. A synthetic moving GIF passed the local FFmpeg encoder and RIFF/WebP structure smoke test (5,930-byte output). The sandbox FFmpeg 6.1.1 decoder could not decode the full animated WebP (`image data not found`), although its extracted VP8 still frame decoded; WhatsApp rendering remains unverified. A live `.animesong Naruto` metadata query returned eight theme-video results in ~4.2s; `.animesong` now downloads the first opening (or first ending if there is no opening) as MP3, validates direct sources against exact host `v.animethemes.moe`, and sends only audio. No usable video now produces an error rather than a link; live audio-download behavior still needs testing. No API key is currently required. Live platform downloads, Windows WhatsApp anime rendering, and live menu rendering remain to be retested. yt-dlp is unavailable in this sandbox, so this update used mocked platform failures and did not run live downloads. Unauthorized recognized commands are silently ignored. Translation detects the source language before calling MyMemory. FFmpeg detection is validated from Node with an explicit override and Windows locator fallback. Deployment to an always-on VPS or server must wait until local and live validation are complete.

## Pending work

1. Copy the audited package into the active Windows project while preserving `.env`, `data/auth`, and local JSON state.
2. Windows Node-side yt-dlp access is verified. Run the updated test suite, verify `ffmpeg -version`, and retry the downloader commands. Set `YTDLP_PATH` only if PATH lookup later fails; restart Shadow after PATH changes.
3. Live-test `.yta`, `.ytv`, `.play` search/direct-URL/selection/expiry/ownership, each social URL command at default SD and explicit HD where available, `.antidelete on|off`, deletion recovery, optional `ANTIDELETE_LOG_JID`, reply-based translation, media replies, group-admin commands, warnings, settings, and owner diagnostics in a test group/chat.
4. Record any live-only WhatsApp/API errors before adding more features or AI integration.
5. If 24/7 operation is required, deploy to an always-on host using the existing auth session securely.

## Next action

Install the audited package on Windows, preserve local credentials/state, run `npm test`, and perform the live command checks documented in `PHASE_1_VALIDATION.md` plus the current commands documented in `README.md`.

## Greeting and command cleanup (2026-10-26)
- Removed the retired character-selection command from the registry, menu/help inventories, natural-language command metadata, tests, and documentation. The included runtime snapshot no longer carries the obsolete group character field.
- `.greet` remains a group-only prefix command and now sends a simple greeting without requiring character state.
- Natural-language requests such as `Shadow, greet`, `Shadow, greet the group`, `Shadow, say hello`, and `Shadow, welcome everyone` are recognized as a dedicated greeting intent. Gemini receives group/private audience context, uses the lightweight model, sends no unrelated tools, and is instructed not to claim tagging or contacting people.
- Syntax checks passed and the complete suite now reports 123 passing tests and 0 failures. Live Gemini/WhatsApp rendering still requires the user's configured API key and active connection.

## WhatsApp reply awareness (2026-10-26)
- Added normalized Baileys quoted-message extraction for quoted text, sender identity, stanza ID, media type, MIME type, filename, captions, and media presence. Missing/deleted/unsupported quote content is represented explicitly rather than invented.
- The message handler now passes reply context to Gemini and classifies the quoted sender independently as `shadow`, `owner`, `participant`, or `unknown`, including PN/LID/device-aware bot identities.
- Gemini now understands replies to participants and Shadow, short contextual requests such as `reply to this`, `cook him`, `explain this`, and `what do you think?`, and includes bounded quoted context without treating the quoted sender as the requester.
- Syntax checks passed; full suite: 129 passed, 0 failed. No live WhatsApp connection test was performed in the sandbox.
