# On-Demand Video Transcoding

## Overview

Truecloud supports on-demand transcoding of non-streamable video formats (AVI, MOV, WMV, FLV, TS, etc.) into browser-compatible H.264/AAC MP4. Transcoding is triggered the first time a video is opened and cached for all subsequent plays.

Hardware acceleration via VAAPI is used automatically when available (`/dev/dri/renderD128`), with a software libx264 fallback.

---

## Design decision: no adaptive bitrate

**Truecloud does not do ABR, and this is deliberate — not a missing feature.**

Every file gets exactly one rendition. Its quality is whatever the administrator
configured in **Admin → Media Processing → Transcoding** (`maxHeight`, stored in
`config/transcoding-settings.json`, read through `lib/transcodingConfig.mjs`).
That setting is authoritative: quality is never negotiated from client bandwidth,
viewport size, or hls.js level switching, and the player is never offered a
choice of levels.

The reason is hardware. The server has a single VAAPI encode engine, which is why
`lib/hlsManager.js` caps HLS transcoding at one concurrent job — parallel jobs
would serialise on the GPU anyway. An ABR ladder means encoding each file two or
three times over, multiplying a queue that already makes a second concurrent
viewer wait behind the first.

If playback quality needs to change, change the admin setting. Do not add
multi-rendition manifests, per-client quality selection, or bandwidth-driven
level switching.

---

## Enabling Transcoding

1. Go to **Admin → Components**
2. Toggle **Hardware Accelerated Transcoding** on
3. When disabled, non-native videos are served as-is (may not play in browser)

---

## Supported Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| AVI | `.avi` | Very common legacy format |
| QuickTime | `.mov` | Apple format |
| Windows Media | `.wmv` | Microsoft format |
| Flash Video | `.flv` | Legacy web format |
| MPEG-TS | `.ts`, `.m2ts`, `.mts` | Transport stream |
| MPEG | `.mpeg`, `.mpg` | Legacy MPEG-1/2 |
| DVD VOB | `.vob` | DVD rip containers |
| RealMedia | `.rm`, `.rmvb` | RealPlayer format |
| M4V | `.m4v` | iTunes-wrapped MP4 |
| Mobile | `.3gp`, `.3g2` | Legacy mobile formats |

**Already handled without transcoding:**
- `.mp4` — native browser playback (moov atom fix applied in background if needed)
- `.webm`, `.ogv`, `.ogg` — native browser playback
- `.mkv` — remuxed to MP4 container on first access (audio re-encoded if needed, video stream copied)

---

## Architecture

### Singleton Job Registry (`lib/transcodeManager.js`)

Node.js module caching ensures a single `Map` is shared across all API route imports within the same process:

```
jobs: Map<fileHash, { status, progress, error? }>
```

- **fileHash** = MD5 of the absolute file path
- **status** = `'transcoding'` | `'done'` | `'error'`
- **progress** = 0–100 (parsed from FFmpeg's `time=HH:MM:SS.ss` stderr output)
- Jobs auto-evict from the map 2 minutes after completion (the cache file persists)

### Cache Location

All transcoded files are stored in `STREAM_CACHE_DIR` (default `./stream-cache`), named `<MD5(fullPath)>.mp4`. This is the same directory used by the MP4 moov-atom fix and MKV remux operations.

### FFmpeg Arguments

Transcoding uses `buildMkvTranscodeArgs()` from `lib/ffmpegUtils.js`:

- **VAAPI available:** `h264_vaapi` encoder with DRM device `/dev/dri/renderD128`
- **Software fallback:** `libx264` with `-crf 23 -preset fast`
- Audio: `aac` at 192k (or copy if already AAC)
- Output: `-movflags +faststart` for streaming-friendly MP4

---

## Player UI States

The `VideoPlayer` component checks `/api/files/transcode-status/[id]` before rendering:

| Status | UI |
|--------|-----|
| `native` / `ready` | `<video>` element rendered immediately |
| `pending` | Spinner + "Preparing video for playback…" |
| `transcoding` | Spinner + progress bar (0–100%) updated every 3 seconds |
| `disabled` | Video rendered as-is + yellow warning banner |
| transcode failed | Video rendered as-is + yellow warning banner |

Polling interval: **3 seconds** while `pending` or `transcoding`.

---

## API Reference

### `GET /api/files/transcode-status/[id]?path=<relativePath>`

Returns the current transcoding status for a file.

**Response:**

```json
{ "status": "native" }           // MP4/WebM/OGV — play directly
{ "status": "ready" }            // Transcoded cache available
{ "status": "pending" }          // Not yet started
{ "status": "transcoding", "progress": 47 }  // In progress
{ "status": "disabled" }         // Transcoding component turned off
{ "status": "disabled", "reason": "transcode_failed" }  // FFmpeg error
```

---

### `GET /api/files/stream/[id]?path=<relativePath>`

Serves the video file for playback. For transcodable formats:

- **Cache hit:** streams the transcoded MP4 directly
- **Cache miss + transcoding enabled:** starts background transcode job, returns `202`:
  ```json
  {
    "error": "Video is being transcoded for playback. Please try again shortly.",
    "status": "transcoding",
    "progress": 0
  }
  ```
- **Transcoding disabled:** serves original file as-is

---

## Progress Tracking

Duration is probed via `ffprobe` before starting the transcode job (`getFileDuration()`). FFmpeg's stderr is parsed in real time for `time=HH:MM:SS.ss` lines. Progress is calculated as:

```
progress = min(99, round((elapsed / totalDuration) * 100))
```

Progress is capped at 99% until the job successfully completes (then set to 100%).

---

## Hardware Acceleration (VAAPI)

VAAPI is detected at runtime by checking for `/dev/dri/renderD128`. If present, the encoder switches to `h264_vaapi`:

```
ffmpeg -vaapi_device /dev/dri/renderD128 -i input.avi \
  -vf 'format=nv12,hwupload' -c:v h264_vaapi \
  -c:a aac -b:a 192k -movflags +faststart output.mp4
```

If VAAPI is unavailable, software encoding is used:

```
ffmpeg -i input.avi \
  -c:v libx264 -crf 23 -preset fast \
  -c:a aac -b:a 192k -movflags +faststart output.mp4
```

To check VAAPI availability on your server:

```bash
ls /dev/dri/renderD128
vainfo  # should show h264_vaapi in entrypoints
```

---

## Troubleshooting

**Video shows "Transcoding disabled" warning:**
Enable the Hardware Accelerated Transcoding toggle in Admin → Components.

**Transcoding fails immediately:**
- Ensure `ffmpeg` is installed: `ffmpeg -version`
- Check server logs for FFmpeg stderr output
- Try running FFmpeg manually on the file to identify the issue

**Progress stays at 0%:**
- `ffprobe` may have failed to detect the duration (returns null → progress stays at 0%)
- The transcode is still running; it will complete

**VAAPI encoder errors:**
- The system falls back to libx264 automatically
- To force software encoding, ensure `/dev/dri/renderD128` is not accessible to the process

**Cache grows too large:**
- Cache files are stored in `STREAM_CACHE_DIR` (default `./stream-cache`)
- Delete files manually or set up a cron job to prune files older than N days
- Cache files are named `<MD5>.mp4` — the original filename is not preserved

**MKV files are handled separately:**
MKV uses a fast remux (copy video stream, transcode audio only if needed). This is handled by the existing `remuxMkvToMp4` logic in the stream route, not by the transcode manager.
