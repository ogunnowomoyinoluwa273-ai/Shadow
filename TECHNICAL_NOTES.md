

## Animated reaction stickers

`src/services/reactions.js` retains the AnimeGifs provider boundary and converts trusted, bounded GIF downloads with the existing `resolveFfmpeg()` helper and FFmpeg's `libwebp_anim` encoder. It writes a 512 × 512 animated WebP with transparent padding, caps animation at 8 seconds, validates RIFF/WEBP, VP8X animation metadata, frame image chunks and cumulative frame duration, and caps output at 500,000 bytes. It tries up to three lower-frame-rate/quality profiles when an output exceeds the size cap. Converted stickers are cached in memory by media URL with a 24-hour TTL, a 32-entry limit, and an 8 MiB total byte limit; concurrent requests for the same media share one conversion. Cache state is ephemeral and is not written alongside credentials or settings.

`src/commands/registry.js` sends sticker bytes as `{ sticker, isAnimated: true }` through Baileys rc14, never as `video`/`gifPlayback`. Because sticker messages have no caption field, existing reaction labels and the `.hmph` line are sent as companion text. Retrieval, conversion, or sticker-send failure falls back to that text. `src/services/tsundere.js` remains command-scoped to `.hmph`; SHADOW's normal conversation behavior is unchanged.

Local verification caveat: the sandbox FFmpeg 6.1.1 build includes `libwebp_anim` and generated a 5,930-byte animated RIFF/WebP from a moving GIF. Its `ffprobe`/decoder then reported `image data not found` for the full animation; an extracted VP8 frame decoded as a static WebP. The service therefore validates the animated WebP container and frame structure, but WhatsApp's actual rendering still requires a live test on the user's WhatsApp copy. The runtime only needs the encoder; it does not decode its own output.
