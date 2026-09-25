/** @format */

// Image file extensions
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'gif', 'bmp', 'png', 'webp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'heif', 'avif', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw'];

// Video file extensions
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'ogv', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'm4v', '3gp', '3g2', 'mpeg', 'mpg', 'ts', 'm2ts', 'mts', 'vob', 'rm', 'rmvb'];

// Audio file extensions
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'wma', 'opus', 'webm', 'aiff', 'ape', 'amr', 'mid', 'midi'];

// PDF file extensions
const PDF_EXTENSIONS = ['pdf'];

// XLSX file extensions
const XLSX_EXTENSIONS = ['xlsx', 'xls', 'xlsm', 'xlsb'];

// 3D file extensions — only formats a three.js loader can read in the browser
// (components/files/viewers/model3d.js). Anything else has no preview.
const THREED_EXTENSIONS = [
  'glb', 'gltf', 'obj', 'fbx', 'dae', '3ds', 'stl', 'ply', '3mf', 'amf', '3dm',
  'wrl', 'vrml', 'lwo', 'md2', 'vtk', 'vtp', 'pcd', 'xyz', 'usdz', 'usda', 'usdc', 'usd',
  'vox', 'gcode',
];

// Plain prose / log files, then source, markup and config files. Every one
// opens in the text viewer, which picks a grammar per extension
// (components/files/viewers/textSyntax.js).
// Deliberately absent: `ts` (MPEG transport stream here — see VIDEO_EXTENSIONS)
// and `svg` (image). `xml` lives here rather than in THREED_EXTENSIONS: nearly
// every .xml is a text document, not a 3D scene.
const TEXT_EXTENSIONS = [
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'nfo', 'log', 'srt', 'vtt', 'tex', 'bib', 'diff', 'patch', 'csv', 'tsv',
  'js', 'jsx', 'mjs', 'cjs', 'tsx', 'vue', 'svelte', 'astro',
  'json', 'jsonc', 'json5', 'map', 'lock', 'webmanifest',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'ino',
  'java', 'cs', 'go', 'rs', 'php', 'swift', 'kt', 'kts', 'dart', 'scala', 'groovy', 'gradle',
  'css', 'scss', 'sass', 'less', 'styl',
  'py', 'pyw', 'rb', 'erb', 'pl', 'pm',
  'sh', 'bash', 'zsh', 'fish', 'ksh', 'bat', 'cmd', 'ps1', 'psm1',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'config', 'properties', 'env', 'desktop', 'service',
  'dockerfile', 'mk', 'make', 'cmake',
  'graphql', 'gql', 'proto', 'tf', 'tfvars', 'hcl', 'prisma',
  'r', 'lua', 'sql', 'psql',
  'html', 'htm', 'xhtml', 'xml', 'xsl', 'xsd', 'plist', 'rss', 'atom', 'kml',
];

// Text files with no extension at all (or a leading-dot one). Matched against
// the whole lowercased file name.
const TEXT_FILENAMES = [
  'dockerfile', 'containerfile', 'makefile', 'gnumakefile', 'gemfile', 'rakefile', 'vagrantfile', 'brewfile',
  'procfile', 'jenkinsfile', 'license', 'licence', 'copying', 'notice', 'authors', 'contributors', 'changelog',
  'readme', 'todo',
  '.gitignore', '.gitattributes', '.dockerignore', '.npmignore', '.editorconfig', '.npmrc', '.nvmrc', '.env',
  '.bashrc', '.bash_profile', '.zshrc', '.profile', '.babelrc', '.prettierrc', '.eslintrc',
];

export function getFileExtension(filename) {
  if (!filename) return '';
  return filename.split('.').pop().toLowerCase();
}

export function isImage(filename) {
  const ext = getFileExtension(filename);
  return IMAGE_EXTENSIONS.includes(ext);
}

export function isVideo(filename) {
  const ext = getFileExtension(filename);
  return VIDEO_EXTENSIONS.includes(ext);
}

export function isAudio(filename) {
  const ext = getFileExtension(filename);
  return AUDIO_EXTENSIONS.includes(ext);
}

export function isPdf(filename) {
  const ext = getFileExtension(filename);
  return PDF_EXTENSIONS.includes(ext);
}

export function isXlsx(filename) {
  const ext = getFileExtension(filename);
  return XLSX_EXTENSIONS.includes(ext);
}

export function is3dFile(filename) {
  const ext = getFileExtension(filename);
  return THREED_EXTENSIONS.includes(ext);
}

export function isText(filename) {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  if (TEXT_FILENAMES.includes(lower)) return true;
  // A dotless name has no extension — `split('.').pop()` would hand back the
  // whole name and match e.g. a file literally called "json".
  return lower.lastIndexOf('.') > 0 && TEXT_EXTENSIONS.includes(getFileExtension(lower));
}

/** Human-readable size ("840 B", "2.4 MB", "12 GB"); '' when unknown. */
export function formatFileSize(bytes) {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${n >= 10 || u === 0 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
}
