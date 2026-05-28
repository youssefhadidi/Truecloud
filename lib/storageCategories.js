/** @format */

// Single source of truth for "how do we bucket a file extension into a
// storage-analytics category". Reused by the admin storage scanner and the
// UI category breakdown.

const IMAGE = new Set([
  'jpg','jpeg','jfif','pjpeg','pjp','gif','bmp','png','webp','svg','ico',
  'tiff','tif','heic','heif','avif','cr2','cr3','nef','arw','dng','orf',
  'rw2','raf','pef','srw',
]);

const VIDEO = new Set([
  'mp4','webm','ogv','avi','mov','wmv','flv','mkv','m4v','3gp','3g2',
  'mpeg','mpg','ts','m2ts','mts','vob','rm','rmvb',
]);

const AUDIO = new Set([
  'mp3','wav','ogg','oga','flac','aac','m4a','wma','opus','aiff','ape',
  'amr','mid','midi',
]);

const PDF = new Set(['pdf']);
const XLSX = new Set(['xlsx','xls','xlsm','xlsb']);

const THREED = new Set([
  '3d','3ds','3mf','ac','ac3d','acc','amf','ase','ask','assbin','b3d',
  'blend','bsp','bvh','cob','csm','dae','dxf','enff','fbx','glb','gltf',
  'hmp','ifc','ifczip','iqm','irr','irrmesh','lwo','lws','lxo','md2','md3',
  'md5anim','md5camera','md5mesh','mdc','mdl','mesh','mot','ms3d','ndo',
  'nff','obj','off','ogex','pk3','ply','pmx','prj','q3o','q3s','scn','sib',
  'smd','step','stl','stp','ter','uc','vta','x','x3d','x3db','xgl','zae','zgl',
]);

const DOCUMENTS = new Set([
  'doc','docx','rtf','odt','txt','md','markdown','pptx','ppt','odp',
  'pages','tex','epub','mobi','azw','azw3','djvu',
]);

const ARCHIVES = new Set([
  'zip','tar','gz','tgz','bz2','tbz','tbz2','xz','txz','7z','rar','zst',
  'lz','lzma','iso','dmg','cab','arj','ace','z',
]);

const CODE = new Set([
  'js','jsx','ts','tsx','mjs','cjs','css','scss','sass','less','html','htm',
  'py','go','rs','java','c','cc','cpp','h','hpp','cs','rb','php','sh','bash',
  'zsh','ps1','ini','toml','yaml','yml','json','xml','sql','env','lua','r',
  'swift','kt','dart','svelte','vue','prisma','graphql','tsv','csv','log',
]);

export const CATEGORY_ORDER = [
  'video','image','audio','pdf','xlsx','documents','3d','archives','code','other',
];

export function categorize(ext) {
  if (!ext) return 'other';
  const e = ext.toLowerCase();
  if (VIDEO.has(e)) return 'video';
  if (IMAGE.has(e)) return 'image';
  if (AUDIO.has(e)) return 'audio';
  if (PDF.has(e)) return 'pdf';
  if (XLSX.has(e)) return 'xlsx';
  if (DOCUMENTS.has(e)) return 'documents';
  if (THREED.has(e)) return '3d';
  if (ARCHIVES.has(e)) return 'archives';
  if (CODE.has(e)) return 'code';
  return 'other';
}
