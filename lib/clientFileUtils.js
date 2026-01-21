/** @format */

// Image file extensions
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'heif', 'avif', 'jfif', 'pjpeg', 'pjp'];

// Video file extensions
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'ogv', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'm4v', '3gp', '3g2', 'mpeg', 'mpg', 'ts', 'm2ts', 'mts', 'vob', 'rm', 'rmvb'];

// Audio file extensions
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'wma', 'opus', 'webm', 'aiff', 'ape', 'amr', 'mid', 'midi'];

// PDF file extensions
const PDF_EXTENSIONS = ['pdf'];

// 3D file extensions
const THREED_EXTENSIONS = [
  '3d',
  '3ds',
  '3mf',
  'ac',
  'ac3d',
  'acc',
  'amf',
  'ase',
  'ask',
  'assbin',
  'b3d',
  'blend',
  'bsp',
  'bvh',
  'cob',
  'csm',
  'dae',
  'dxf',
  'enff',
  'fbx',
  'glb',
  'gltf',
  'hmp',
  'ifc',
  'ifczip',
  'iqm',
  'irr',
  'irrmesh',
  'lwo',
  'lws',
  'lxo',
  'md2',
  'md3',
  'md5anim',
  'md5camera',
  'md5mesh',
  'mdc',
  'mdl',
  'mesh',
  'mot',
  'ms3d',
  'ndo',
  'nff',
  'obj',
  'off',
  'ogex',
  'pk3',
  'ply',
  'pmx',
  'prj',
  'q3o',
  'q3s',
  'raw',
  'scn',
  'sib',
  'smd',
  'step',
  'stl',
  'stp',
  'ter',
  'uc',
  'vta',
  'x',
  'x3d',
  'x3db',
  'xgl',
  'xml',
  'zae',
  'zgl',
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

export function is3dFile(filename) {
  const ext = getFileExtension(filename);
  return THREED_EXTENSIONS.includes(ext);
}
