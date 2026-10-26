
- Added `.hmph`: each invocation randomly selects from 25 original local tsundere-style lines and sends the selected text as the caption of an anime `pout` GIF converted through the existing bounded AnimeGifs/FFmpeg service. If retrieval or sending fails, SHADOW sends that same text alone. The command is listed in generated help/menu; this is command-only and does not change SHADOW's normal conversation persona. Added tests for random selection, `pout` provider routing, single-message caption payload, both fallback paths, and help/menu registration. `npm test`: 69 passed, 0 failed; syntax checks passed. Upstream docs list `Pout` and a live API JSON response was verified; GIF bytes and delivery through the user's WhatsApp session were not tested.

- Replaced MP4 `gifPlayback` reaction outputs with actual animated WebP sticker messages for `.hug`, `.slap`, `.kiss`, `.pat`, `.bonk`, `.cry`, `.bite`, and `.hmph`. The shared AnimeGifs service now uses the installed FFmpeg `libwebp_anim` encoder, validates 512×512 animated WebP output and WhatsApp size/duration limits, retries smaller quality profiles, and caches converted stickers in bounded memory. Baileys receives `{ sticker, isAnimated: true }`; existing reaction labels and `.hmph` lines are sent as companion text, with text-only fallback on retrieval, conversion, or sticker-send failures. Verification: `npm test` 70 passed/0 failed, `npm run check` and all JavaScript syntax checks passed; the installed FFmpeg encoder produced a 5,930-byte structurally valid RIFF/WebP from a synthetic moving GIF. Its animated-WebP decoder check failed with `image data not found`; a static extracted VP8 frame decoded, so authenticated WhatsApp visual delivery remains unverified.

## 2026-10-26
- Removed the retired character-selection command and cleaned its registry, generated inventories, documentation, tests, and obsolete runtime state.
- Refactored natural-language greeting handling so authorized `Shadow, greet` requests infer group/private audience, use lightweight Gemini with no unrelated tools, respect explicit tone/audience instructions, and produce varied responses.
- Preserved `.greet` as a group-only prefix command without character configuration.
- Added focused greeting and removal regressions; full suite: 123 passed, 0 failed.

## 2026-10-26
- Added full WhatsApp reply-to-message awareness for Gemini: quoted text, captions, sender identity, media metadata, Shadow/owner/participant classification, and graceful missing-quote handling.
- Added regressions for participant replies, Shadow replies, short contextual instructions, media captions, sender separation, handler propagation, and unavailable quoted content.
- Full suite: 129 passed, 0 failed.
