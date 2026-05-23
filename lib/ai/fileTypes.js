/** @format */

// Pure JS so this module is safe to import from both server and client.
function extname(fileName) {
  const m = /\.([^.\/\\]+)$/.exec(fileName || '');
  return m ? '.' + m[1] : '';
}

const IMAGE_MEDIA = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  // HEIC/HEIF aren't natively readable by Claude's Read tool — we transcode
  // them to JPEG server-side before passing the path along.
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

const NEEDS_TRANSCODE = new Set(['.heic', '.heif']);

export function imageNeedsTranscode(fileName) {
  const m = /\.([^.\/\\]+)$/.exec(fileName || '');
  if (!m) return false;
  return NEEDS_TRANSCODE.has('.' + m[1].toLowerCase());
}

const PDF_EXT = new Set(['.pdf']);
const XLSX_EXT = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb']);
const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.yaml', '.yml',
  '.log', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.scss', '.html',
  '.htm', '.py', '.go', '.rs', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs',
  '.rb', '.php', '.sh', '.bash', '.zsh', '.ps1', '.ini', '.toml', '.sql', '.env',
  '.lua', '.r', '.swift', '.kt', '.dart', '.svelte', '.vue', '.prisma', '.graphql',
]);

/**
 * Classify a file by extension into how we'll send it to Claude.
 * @returns {{kind: 'image'|'pdf'|'xlsx'|'text'|'unsupported', mediaType: string|null}}
 */
export function classifyAiFile(fileName) {
  const ext = extname(fileName).toLowerCase();
  if (IMAGE_MEDIA[ext]) return { kind: 'image', mediaType: IMAGE_MEDIA[ext] };
  if (PDF_EXT.has(ext)) return { kind: 'pdf', mediaType: 'application/pdf' };
  if (XLSX_EXT.has(ext)) return { kind: 'xlsx', mediaType: null };
  if (TEXT_EXT.has(ext)) return { kind: 'text', mediaType: 'text/plain' };
  return { kind: 'unsupported', mediaType: null };
}

export function isAiSupported(fileName) {
  return classifyAiFile(fileName).kind !== 'unsupported';
}
