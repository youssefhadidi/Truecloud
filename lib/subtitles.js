/** @format */

/**
 * Subtitle discovery and WebVTT extraction.
 *
 * Two sources are supported, presented to the player as one ordered list:
 *   - embedded  — subtitle streams inside the container (MKV/MP4), read via ffprobe
 *   - sidecar   — .srt/.ass/.vtt files sitting next to the video
 *
 * Everything is converted to WebVTT because that is the only format <track>
 * accepts. Conversion runs through ffmpeg and the result is cached under
 * stream-cache/subs/{md5(fullPath)}/{id}.vtt.
 *
 * Track ids are indices into the list built by listSubtitleTracks(), which is
 * deterministic (ffprobe stream order, then sidecars sorted by filename). The
 * VTT route rebuilds the same list and looks the id up, so no filename or
 * stream index ever arrives from the client.
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { access, mkdir, readdir, rename, unlink } from 'fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { logger } from '@/lib/logger';
import { Semaphore } from '@/lib/semaphore.mjs';

// Subtitle conversion is cheap (a few hundred ms) but a media viewer scrolling
// through a folder can fire many at once. Same reasoning as probeSemaphore in
// the stream route: cap the concurrent ffmpeg processes rather than the FDs.
const extractSemaphore = new Semaphore(2);

/** Sidecar subtitle files we know how to convert. */
const SIDECAR_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub']);

/**
 * Bitmap subtitle formats. These are pictures, not text, so there is no
 * WebVTT they can become — they would need OCR or burning into the video.
 * Listed rather than hidden so the player can say why a track is unavailable.
 */
const IMAGE_SUBTITLE_CODECS = new Set([
  'hdmv_pgs_subtitle',
  'dvd_subtitle',
  'dvb_subtitle',
  'dvb_teletext',
  'xsub',
]);

/**
 * ISO 639-2 → ISO 639-1. ffprobe reports the three-letter code but <track
 * srclang> and Intl.DisplayNames both want the two-letter one. Includes the
 * bibliographic/terminological pairs (fre/fra, ger/deu, …) since files in the
 * wild use both.
 */
const ISO639_2_TO_1 = {
  eng: 'en', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', ita: 'it',
  por: 'pt', dut: 'nl', nld: 'nl', rus: 'ru', jpn: 'ja', chi: 'zh', zho: 'zh',
  kor: 'ko', ara: 'ar', heb: 'he', hin: 'hi', tur: 'tr', pol: 'pl', swe: 'sv',
  nor: 'no', dan: 'da', fin: 'fi', cze: 'cs', ces: 'cs', gre: 'el', ell: 'el',
  hun: 'hu', rum: 'ro', ron: 'ro', tha: 'th', vie: 'vi', ukr: 'uk', ind: 'id',
  may: 'ms', msa: 'ms', bul: 'bg', hrv: 'hr', srp: 'sr', slo: 'sk', slk: 'sk',
  slv: 'sl', cat: 'ca', tgl: 'tl', fil: 'fil', per: 'fa', fas: 'fa',
};

/** Normalise whatever language tag we were handed to a BCP-47 primary subtag. */
export function normalizeLang(raw) {
  if (!raw) return null;
  const code = String(raw).toLowerCase().trim().split(/[-_]/)[0];
  if (!code || code === 'und') return null;
  if (code.length === 2) return code;
  return ISO639_2_TO_1[code] ?? null;
}

export function getSubsDir(fullPath, cacheDir) {
  const hash = createHash('md5').update(fullPath).digest('hex');
  return join(cacheDir, 'subs', hash);
}

// ─── ffprobe ──────────────────────────────────────────────────────────────────

function probeSubtitleStreams(filePath, signal) {
  return new Promise((res, rej) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 's',
      filePath,
    ]);

    let stdout = '';
    const onAbort = () => ffprobe.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });

    ffprobe.stdout.on('data', (d) => { stdout += d; });
    ffprobe.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      rej(err);
    });
    ffprobe.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        rej(new DOMException('aborted', 'AbortError'));
        return;
      }
      if (code !== 0) {
        rej(new Error(`ffprobe failed with code ${code}`));
        return;
      }
      try {
        res(JSON.parse(stdout).streams ?? []);
      } catch (err) {
        rej(new Error(`Failed to parse ffprobe output: ${err.message}`));
      }
    });
  });
}

// ─── Sidecar discovery ────────────────────────────────────────────────────────

/**
 * Pull a language tag out of the part of a sidecar filename that follows the
 * video's own basename: "Show.S01E01.en.srt" → "en", "Show.S01E01.eng.forced.srt"
 * → "eng". Returns null for "Show.S01E01.srt", which is the unlabelled case.
 */
function langFromSidecarSuffix(suffix) {
  for (const part of suffix.split('.')) {
    const lang = normalizeLang(part);
    if (lang) return lang;
  }
  return null;
}

async function findSidecars(fullPath) {
  const dir = dirname(fullPath);
  const videoBase = basename(fullPath, extname(fullPath)).toLowerCase();

  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const found = [];
  for (const name of entries) {
    const ext = extname(name).toLowerCase();
    if (!SIDECAR_EXTENSIONS.has(ext)) continue;

    const stem = basename(name, ext).toLowerCase();
    // "Show.S01E01.en.srt" belongs to "Show.S01E01.mkv"; "Other.srt" does not.
    if (stem !== videoBase && !stem.startsWith(`${videoBase}.`)) continue;

    found.push({
      file: join(dir, name),
      name,
      lang: langFromSidecarSuffix(stem.slice(videoBase.length)),
    });
  }

  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the ordered track list for a video. Never throws — a missing ffprobe
 * or an unreadable directory degrades to "no subtitles" rather than failing
 * playback, which is the behaviour the player wants.
 *
 * @returns {Promise<Array<{
 *   id: number, source: 'embedded'|'sidecar', lang: string|null,
 *   title: string|null, codec: string, available: boolean,
 *   streamIndex?: number, file?: string
 * }>>}
 */
export async function listSubtitleTracks(fullPath, signal) {
  const tracks = [];

  let streams = [];
  try {
    streams = await probeSubtitleStreams(fullPath, signal);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    logger.warn('subtitles: ffprobe failed', { fullPath, error: err.message });
  }

  streams.forEach((s, i) => {
    const codec = s.codec_name?.toLowerCase() ?? 'unknown';
    tracks.push({
      id: tracks.length,
      source: 'embedded',
      // The index within the subtitle streams, which is what `-map 0:s:N`
      // takes — NOT s.index, which counts every stream in the container.
      streamIndex: i,
      lang: normalizeLang(s.tags?.language),
      title: s.tags?.title ?? null,
      codec,
      available: !IMAGE_SUBTITLE_CODECS.has(codec),
    });
  });

  for (const sidecar of await findSidecars(fullPath)) {
    tracks.push({
      id: tracks.length,
      source: 'sidecar',
      file: sidecar.file,
      lang: sidecar.lang,
      title: null,
      codec: extname(sidecar.name).slice(1).toLowerCase(),
      available: true,
    });
  }

  return tracks;
}

/**
 * Convert one track to WebVTT, caching the result. Returns the path to the
 * .vtt file.
 */
export async function extractSubtitleVtt(fullPath, cacheDir, track, signal) {
  const dir = getSubsDir(fullPath, cacheDir);
  const outPath = join(dir, `${track.id}.vtt`);

  try {
    await access(outPath);
    return outPath;
  } catch {}

  await mkdir(dir, { recursive: true });

  await extractSemaphore.acquire(1, signal);
  try {
    // Another request may have produced it while we waited for the slot.
    try {
      await access(outPath);
      return outPath;
    } catch {}

    // Write to a temp file and rename, so a concurrent reader can never open a
    // half-written .vtt — same reason hls_flags carries temp_file.
    const tmpPath = `${outPath}.${process.pid}.tmp`;
    const args =
      track.source === 'embedded'
        ? ['-v', 'error', '-i', fullPath, '-map', `0:s:${track.streamIndex}`, '-c:s', 'webvtt', '-f', 'webvtt', '-y', tmpPath]
        : ['-v', 'error', '-i', track.file, '-c:s', 'webvtt', '-f', 'webvtt', '-y', tmpPath];

    await new Promise((res, rej) => {
      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';
      const onAbort = () => ffmpeg.kill('SIGKILL');
      signal?.addEventListener('abort', onAbort, { once: true });

      ffmpeg.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2048); });
      ffmpeg.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        rej(err);
      });
      ffmpeg.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) rej(new DOMException('aborted', 'AbortError'));
        else if (code === 0) res();
        else rej(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
      });
    }).catch(async (err) => {
      await unlink(tmpPath).catch(() => {});
      throw err;
    });

    await rename(tmpPath, outPath);
    logger.info('subtitles: extracted track', { fullPath, id: track.id, source: track.source });
    return outPath;
  } finally {
    extractSemaphore.release();
  }
}
