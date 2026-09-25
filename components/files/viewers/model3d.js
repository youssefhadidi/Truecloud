/** @format */

// Client-side loading for every 3D format the viewer supports — each one goes
// straight through its three.js loader, no server-side conversion.
//
// Many formats reference sibling files (.mtl libraries, glTF .bin buffers,
// textures). Loaders resolve those against a virtual base URL (VIRTUAL_ROOT =
// "the model's folder"), and the LoadingManager's URL modifier rewrites each
// request onto the real download route. References are matched against a
// listing of the model's folder case-insensitively and fall back to a bare
// file-name lookup, because exporters routinely write absolute paths from the
// author's machine ("C:\Users\me\tex\wood.png") or the wrong case (3DS stores
// upper-case 8.3 names).

import {
  DoubleSide,
  FileLoader,
  Group,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
} from 'three';
import { appendFolderPinToUrl } from '@/lib/folderPinStore';

const VIRTUAL_ROOT = '/__model3d__/';
const VENDOR_PATH = '/vendor/three';

// Formats whose files can point at other files — only these pay for the
// folder listing used to resolve references.
const REFERENCES_EXTERNAL = new Set(['gltf', 'glb', 'obj', 'fbx', 'dae', '3ds', 'wrl', 'vrml', 'lwo']);

// Formats authored Z-up (CAD / 3D printing) that three.js loaders leave as-is.
const Z_UP = new Set(['stl', '3mf', 'amf', '3dm', '3ds']);

// Cap on sub-folders listed when indexing, so a model sitting in a huge
// folder tree doesn't fan out into hundreds of requests.
const MAX_INDEXED_SUBDIRS = 16;

const joinPath = (...parts) => parts.filter(Boolean).join('/');

/** Collapse "." / ".." / empty segments; null when ".." climbs above the root. */
function normalizePath(path) {
  const out = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}

const baseName = (path) => path.slice(path.lastIndexOf('/') + 1);
const dirName = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/**
 * Where the model and its siblings are fetched from. Paths are relative to the
 * storage root the viewer browses: the user's files, or the share's root.
 */
export function createModelSource({ fileId, fileName, currentPath = '', shareToken, sharePassword, singleFileShare }) {
  const dir = normalizePath(currentPath || '') || '';
  const name = fileId || fileName;

  if (shareToken) {
    const pwd = sharePassword ? `pwd=${encodeURIComponent(sharePassword)}` : '';
    const downloadUrl = (path) => {
      const query = [path ? `path=${encodeURIComponent(path)}` : '', pwd].filter(Boolean).join('&');
      return `/api/public/${shareToken}/download${query ? `?${query}` : ''}`;
    };
    return {
      dir,
      // A single-file share exposes nothing but the file itself, so sibling
      // resources can't be listed or fetched.
      canReadSiblings: !singleFileShare,
      mainUrl: singleFileShare ? downloadUrl('') : downloadUrl(joinPath(dir, fileName)),
      fetchHeaders: sharePassword ? { 'x-share-password': sharePassword } : {},
      fileUrl: downloadUrl,
      listUrl: (path) => `/api/public/${shareToken}/files?path=${encodeURIComponent(path)}`,
    };
  }

  const fileUrl = (path) =>
    appendFolderPinToUrl(
      `/api/files/download/${encodeURIComponent(baseName(path))}?path=${encodeURIComponent(dirName(path))}`,
      path,
    );
  return {
    dir,
    canReadSiblings: true,
    mainUrl: fileUrl(joinPath(dir, name)),
    fetchHeaders: {},
    fileUrl,
    listUrl: (path) => appendFolderPinToUrl(`/api/files?path=${encodeURIComponent(path)}`, path),
  };
}

async function listFolder(source, path, signal) {
  try {
    const res = await fetch(source.listUrl(path), { headers: source.fetchHeaders, signal });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.files) ? data.files : [];
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return [];
  }
}

/**
 * Index the model's folder and its direct sub-folders (where textures usually
 * live) by lower-cased path and by lower-cased file name.
 */
async function buildResourceIndex(source, signal) {
  const byPath = new Map();
  const byName = new Map();
  const add = (path) => {
    byPath.set(path.toLowerCase(), path);
    const key = baseName(path).toLowerCase();
    // First hit wins, and the model's own folder is indexed first.
    if (!byName.has(key)) byName.set(key, path);
  };

  const entries = await listFolder(source, source.dir, signal);
  const subdirs = [];
  for (const entry of entries) {
    const path = joinPath(source.dir, entry.name);
    if (entry.isDirectory) subdirs.push(path);
    else add(path);
  }
  const nested = await Promise.all(subdirs.slice(0, MAX_INDEXED_SUBDIRS).map((path) => listFolder(source, path, signal)));
  nested.forEach((list, i) => {
    for (const entry of list) if (!entry.isDirectory) add(joinPath(subdirs[i], entry.name));
  });
  return { byPath, byName };
}

/** Percent-decode a reference and normalise it to forward slashes. */
function cleanReference(ref) {
  let cleaned = ref.split(/[?#]/)[0];
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // A literal "%" in a file name — keep it as written.
  }
  // After decoding: glTF URIs percent-encode the backslashes too.
  return cleaned.replace(/\\/g, '/').replace(/^file:\/\/\/?/i, '');
}

/**
 * Map a cleaned reference found inside the model (relative to its folder, or
 * an absolute path from the author's machine) to a path under the storage root.
 */
function resolveReference(cleaned, source, index) {
  const isAbsolute = /^[a-z]:\//i.test(cleaned) || cleaned.startsWith('/');
  const relative = isAbsolute ? null : normalizePath(joinPath(source.dir, cleaned));

  if (index && relative !== null) {
    const hit = index.byPath.get(relative.toLowerCase());
    if (hit) return hit;
  }
  const name = baseName(cleaned);
  if (index) {
    const hit = index.byName.get(name.toLowerCase());
    if (hit) return hit;
  }
  return relative ?? joinPath(source.dir, name);
}

/**
 * LoadingManager whose requests for VIRTUAL_ROOT URLs land on the download
 * route. Any sibling that fails to load is reported (by the name the model
 * used) through `onMissing` so the viewer can say which files to upload.
 * Textures keep loading after the scene is returned, so this fires late.
 */
function createManager(source, index, onMissing) {
  const manager = new LoadingManager();
  const displayNames = new Map();
  const missing = new Set();

  manager.setURLModifier((url) => {
    if (!url.startsWith(VIRTUAL_ROOT)) return url; // blob:, data:, decoder libs
    const ref = cleanReference(url.slice(VIRTUAL_ROOT.length));
    const real = source.fileUrl(resolveReference(ref, source, index));
    displayNames.set(real, baseName(ref) || ref);
    return real;
  });
  manager.onError = (url) => {
    // Only files the model points at; a corrupt embedded (blob:) image isn't
    // something the user can fix by uploading.
    const name = displayNames.get(url);
    if (!name) return;
    missing.add(name);
    onMissing?.([...missing]);
  };

  return manager;
}

async function fetchMainFile(source, signal, onProgress) {
  const res = await fetch(source.mainUrl, { headers: source.fetchHeaders, signal });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = (await res.json()).error || message;
    } catch {
      // Non-JSON error body
    }
    throw new Error(message);
  }

  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total || !onProgress) return res.arrayBuffer();

  const chunks = [];
  let received = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(received / total, 1));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}

const decodeText = (buffer) => new TextDecoder().decode(buffer);

function geometryMesh(geometry) {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const hasColors = !!geometry.attributes.color;
  return new Mesh(
    geometry,
    new MeshStandardMaterial({
      color: hasColors ? 0xffffff : 0xb8c0cc,
      vertexColors: hasColors,
      metalness: 0.1,
      roughness: 0.6,
      side: DoubleSide,
    }),
  );
}

function pointCloud(geometry) {
  const hasColors = !!geometry.attributes.color;
  return new Points(geometry, new PointsMaterial({ color: hasColors ? 0xffffff : 0xb8c0cc, vertexColors: hasColors, size: 1 }));
}

/** Handlers for texture formats the browser can't decode as <img>. */
async function registerTextureHandlers(manager) {
  const [{ TGALoader }, { DDSLoader }] = await Promise.all([
    import('three/examples/jsm/loaders/TGALoader.js'),
    import('three/examples/jsm/loaders/DDSLoader.js'),
  ]);
  manager.addHandler(/\.tga$/i, new TGALoader(manager));
  manager.addHandler(/\.dds$/i, new DDSLoader(manager));
}

/**
 * The .mtl libraries an OBJ uses. A mtllib line may list several files or one
 * name containing spaces; the folder index tells the two apart. Exporters that
 * omit mtllib usually still write "<model>.mtl" next to the model.
 */
function mtlLibraries(objText, index, source, fileName) {
  const names = [];
  for (const match of objText.matchAll(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/gm)) {
    const value = match[1];
    const whole = normalizePath(joinPath(source.dir, value.replace(/\\/g, '/')));
    const isOneFile = !/\s/.test(value) || (whole !== null && index?.byPath.has(whole.toLowerCase()));
    names.push(...(isOneFile ? [value] : value.split(/\s+/)));
  }
  if (!names.length && index) {
    const guess = fileName.replace(/\.obj$/i, '.mtl');
    if (index.byPath.has(joinPath(source.dir, guess).toLowerCase())) names.push(guess);
  }
  return [...new Set(names)];
}

async function loadObj(buffer, manager, index, source, fileName) {
  const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
    import('three/examples/jsm/loaders/OBJLoader.js'),
    import('three/examples/jsm/loaders/MTLLoader.js'),
  ]);
  const text = decodeText(buffer);
  const objLoader = new OBJLoader(manager);

  const fileLoader = new FileLoader(manager);
  let creator = null;
  for (const lib of mtlLibraries(text, index, source, fileName)) {
    try {
      const mtlText = await fileLoader.loadAsync(VIRTUAL_ROOT + lib);
      // Textures in an .mtl are relative to the .mtl, not the .obj.
      const libDir = dirName(lib.replace(/\\/g, '/'));
      const parsed = new MTLLoader(manager).parse(mtlText, VIRTUAL_ROOT + (libDir ? `${libDir}/` : ''));
      if (!creator) creator = parsed;
      else creator.setMaterials({ ...creator.materialsInfo, ...parsed.materialsInfo });
    } catch {
      // Missing .mtl is recorded by the manager; the mesh still renders grey.
    }
  }
  if (creator) {
    creator.preload();
    objLoader.setMaterials(creator);
  }
  return objLoader.parse(text);
}

/** "proj/Objects/cars" → "../../" — LightWave paths are relative to the content dir above Objects/. */
function lightwaveContentBase(dir) {
  const segs = dir ? dir.split('/') : [];
  const i = segs.lastIndexOf('Objects');
  return VIRTUAL_ROOT + (i === -1 ? '' : '../'.repeat(segs.length - i));
}

async function parseModel(ext, buffer, { manager, index, source, fileName, renderer, disposers }) {
  switch (ext) {
    case 'glb':
    case 'gltf': {
      const [{ GLTFLoader }, { DRACOLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/loaders/DRACOLoader.js'),
        import('three/examples/jsm/loaders/KTX2Loader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      const draco = new DRACOLoader().setDecoderPath(`${VENDOR_PATH}/draco/`);
      const ktx2 = new KTX2Loader().setTranscoderPath(`${VENDOR_PATH}/basis/`).detectSupport(renderer);
      disposers.push(() => draco.dispose(), () => ktx2.dispose());
      const loader = new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
      return (await loader.parseAsync(buffer, VIRTUAL_ROOT)).scene;
    }
    case 'obj':
      return loadObj(buffer, manager, index, source, fileName);
    case 'fbx': {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
      return new FBXLoader(manager).parse(buffer, VIRTUAL_ROOT);
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
      return new ColladaLoader(manager).parse(decodeText(buffer), VIRTUAL_ROOT).scene;
    }
    case '3ds': {
      const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js');
      return new TDSLoader(manager).parse(buffer, VIRTUAL_ROOT);
    }
    case 'wrl':
    case 'vrml': {
      const { VRMLLoader } = await import('three/examples/jsm/loaders/VRMLLoader.js');
      return new VRMLLoader(manager).parse(decodeText(buffer), VIRTUAL_ROOT);
    }
    case 'lwo': {
      const { LWOLoader } = await import('three/examples/jsm/loaders/LWOLoader.js');
      const { meshes } = new LWOLoader(manager).parse(buffer, lightwaveContentBase(source.dir), 'model');
      return new Group().add(...meshes);
    }
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      return geometryMesh(new STLLoader().parse(buffer));
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
      const geometry = new PLYLoader().parse(buffer);
      // Faces become an index; without one the file is a point cloud.
      return geometry.index ? geometryMesh(geometry) : pointCloud(geometry);
    }
    case 'md2': {
      const { MD2Loader } = await import('three/examples/jsm/loaders/MD2Loader.js');
      return geometryMesh(new MD2Loader().parse(buffer));
    }
    case 'vtk':
    case 'vtp': {
      const { VTKLoader } = await import('three/examples/jsm/loaders/VTKLoader.js');
      const geometry = new VTKLoader().parse(buffer);
      return geometry.index ? geometryMesh(geometry) : pointCloud(geometry);
    }
    case 'pcd': {
      const { PCDLoader } = await import('three/examples/jsm/loaders/PCDLoader.js');
      return new PCDLoader().parse(buffer);
    }
    case 'xyz': {
      const { XYZLoader } = await import('three/examples/jsm/loaders/XYZLoader.js');
      return pointCloud(new XYZLoader().parse(decodeText(buffer)));
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
      return new ThreeMFLoader().parse(buffer);
    }
    case 'amf': {
      const { AMFLoader } = await import('three/examples/jsm/loaders/AMFLoader.js');
      return new AMFLoader().parse(buffer);
    }
    case '3dm': {
      const { Rhino3dmLoader } = await import('three/examples/jsm/loaders/3DMLoader.js');
      const loader = new Rhino3dmLoader().setLibraryPath(`${VENDOR_PATH}/rhino3dm/`);
      disposers.push(() => loader.dispose());
      return new Promise((resolve, reject) => loader.parse(buffer, resolve, reject));
    }
    case 'usdz':
    case 'usdc':
    case 'usda':
    case 'usd': {
      const { USDLoader } = await import('three/examples/jsm/loaders/USDLoader.js');
      // .usda (and a non-crate .usd) is text; the loader tells text from binary by type.
      const isCrate = decodeText(buffer.slice(0, 8)) === 'PXR-USDC';
      const isText = ext === 'usda' || (ext === 'usd' && !isCrate);
      return new USDLoader().parse(isText ? decodeText(buffer) : buffer);
    }
    case 'vox': {
      const { VOXLoader, buildMesh } = await import('three/examples/jsm/loaders/VOXLoader.js');
      const result = new VOXLoader().parse(buffer);
      return result.scene || new Group().add(...result.chunks.map((chunk) => buildMesh(chunk)));
    }
    case 'gcode': {
      const { GCodeLoader } = await import('three/examples/jsm/loaders/GCodeLoader.js');
      return new GCodeLoader().parse(decodeText(buffer));
    }
    default:
      throw new Error(`Unsupported file format: ${ext}`);
  }
}

/**
 * Fetch and parse a model. Resolves to `{ object, dispose }`; `dispose`
 * releases decoder workers. `onMissing(names)` is called whenever a referenced
 * file (texture, .mtl, .bin) fails to load.
 */
export async function loadModel({ source, fileName, renderer, signal, onProgress, onMissing }) {
  const ext = (fileName || '').toLowerCase().split('.').pop();

  const [buffer, index] = await Promise.all([
    fetchMainFile(source, signal, onProgress),
    REFERENCES_EXTERNAL.has(ext) && source.canReadSiblings ? buildResourceIndex(source, signal) : null,
  ]);

  const manager = createManager(source, index, onMissing);
  if (REFERENCES_EXTERNAL.has(ext)) await registerTextureHandlers(manager);

  const disposers = [];
  const dispose = () => disposers.forEach((fn) => fn());
  let parsed;
  try {
    parsed = await parseModel(ext, buffer, { manager, index, source, fileName, renderer, disposers });
  } catch (err) {
    dispose();
    throw err;
  }

  // Wrap in a root so the Z-up correction doesn't fight the viewer's own
  // scale / position.
  if (Z_UP.has(ext)) parsed.rotation.x -= Math.PI / 2;
  return { object: new Group().add(parsed), dispose };
}
