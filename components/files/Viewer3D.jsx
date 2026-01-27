/** @format */

'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

// List of supported 3D file formats
const SUPPORTED_FORMATS = [
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

export function is3dFile(filename) {
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  return SUPPORTED_FORMATS.includes(ext);
}

export default function Viewer3D({ fileId, currentPath, fileName, shareToken, sharePassword }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const modelBoundsRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentView, setCurrentView] = useState('isometric');

  // Function to jump camera to a specific view
  const jumpToView = (viewName) => {
    if (!cameraRef.current || !controlsRef.current || !modelBoundsRef.current) return;

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const { center, size } = modelBoundsRef.current;
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 1.2;

    const viewConfigs = {
      front: { pos: [0, center.y, distance], up: [0, 1, 0] },
      back: { pos: [0, center.y, -distance], up: [0, 1, 0] },
      top: { pos: [0, center.y + distance, 0], up: [0, 0, -1] },
      bottom: { pos: [0, center.y - distance, 0], up: [0, 0, 1] },
      left: { pos: [-distance, center.y, 0], up: [0, 1, 0] },
      right: { pos: [distance, center.y, 0], up: [0, 1, 0] },
      isometric: { pos: [distance * 0.7, center.y + distance * 0.5, distance * 0.7], up: [0, 1, 0] },
    };

    const config = viewConfigs[viewName];
    if (!config) return;

    camera.position.set(...config.pos);
    camera.up.set(...config.up);
    controls.target.copy(center);
    controls.update();
    setCurrentView(viewName);
  };

  useEffect(() => {
    if (!mountRef.current) return;

    // Initialize Three.js scene
    const scene = new THREE.Scene();

    // Create gradient background
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#1f2937');
    gradient.addColorStop(1, '#0f172a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    const texture = new THREE.CanvasTexture(canvas);
    scene.background = texture;
    sceneRef.current = scene;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 10000);
    camera.position.set(0, 0, 100);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Clear any existing renderer before appending new one
    while (mountRef.current.firstChild) {
      mountRef.current.removeChild(mountRef.current.firstChild);
    }

    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Add grid helper
    const gridHelper = new THREE.GridHelper(200, 40, 0x444444, 0x222222);
    gridHelper.position.y = -100;
    scene.add(gridHelper);

    // Add axis helper
    const axesHelper = new THREE.AxesHelper(100);
    axesHelper.position.y = -100;
    scene.add(axesHelper);

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = false;
    controls.enableZoom = true;
    controls.enablePan = true;

    // Fusion 360-like controls
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    // Enable two-finger touch controls
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    controlsRef.current = controls;

    // Load 3D file
    const loadGeometry = async () => {
      try {
        const fileNameLower = (fileName || '').toLowerCase();
        const fileExt = fileNameLower.split('.').pop();
        let object;

        // Determine the conversion URL based on file type and share mode
        let conversionUrl;

        // Files that need conversion to GLTF
        const needsConversion = !['glb', 'gltf', 'obj'].includes(fileExt);

        // Use public routes for share mode
        if (shareToken) {
          const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
          if (needsConversion) {
            conversionUrl = `/api/public/${shareToken}/convert-3d?file=${encodeURIComponent(filePath)}`;
          } else {
            conversionUrl = `/api/public/${shareToken}/download?path=${encodeURIComponent(filePath)}`;
          }
        } else {
          if (needsConversion) {
            conversionUrl = `/api/files/convert-3d?id=${encodeURIComponent(fileId)}&path=${encodeURIComponent(currentPath)}`;
          } else {
            conversionUrl = `/api/files/download/${encodeURIComponent(fileId)}?path=${encodeURIComponent(currentPath)}`;
          }
        }

        // Build headers for password-protected shares
        const fetchHeaders = sharePassword ? { 'x-share-password': sharePassword } : {};

        // Load as GLTF/GLB
        if (fileNameLower.endsWith('.glb') || fileNameLower.endsWith('.gltf') || needsConversion) {
          const gltfLoader = new GLTFLoader();

          // For share mode with password, fetch first and use blob URL
          if (shareToken && sharePassword) {
            const response = await fetch(conversionUrl, { headers: fetchHeaders });
            if (!response.ok) throw new Error('Failed to load model');
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            object = await new Promise((resolve, reject) => {
              gltfLoader.load(blobUrl, (gltf) => {
                URL.revokeObjectURL(blobUrl);
                resolve(gltf);
              }, undefined, reject);
            });
          } else {
            object = await new Promise((resolve, reject) => {
              gltfLoader.load(conversionUrl, resolve, undefined, reject);
            });
          }
          scene.add(object.scene);
        }
        // Load as OBJ
        else if (fileNameLower.endsWith('.obj')) {
          const objLoader = new OBJLoader();
          const response = await fetch(conversionUrl, { headers: fetchHeaders });
          const text = await response.text();
          object = objLoader.parse(text);
          scene.add(object);
        } else {
          setError(`Unsupported file format: ${fileExt}`);
          setLoading(false);
          return;
        }

        // Get the loaded object for bounding box calculation
        const loadedObject = object.scene || object;

        // Calculate bounding box
        const box = new THREE.Box3().setFromObject(loadedObject);
        const size = box.getSize(new THREE.Vector3());

        // Scale model to fit 50% of grid (grid is 200x200, so target is ~100 units)
        const targetSize = 100; // 50% of 200 unit grid
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = targetSize / maxDim;
        loadedObject.scale.multiplyScalar(scale);

        // Recalculate bounding box after scaling
        const scaledBox = new THREE.Box3().setFromObject(loadedObject);
        const scaledSize = scaledBox.getSize(new THREE.Vector3());
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3());

        // Position model: center horizontally (X, Z), position on floor (Y)
        const floorY = -100;
        loadedObject.position.x = -scaledCenter.x;
        loadedObject.position.y = floorY - scaledBox.min.y;
        loadedObject.position.z = -scaledCenter.z;

        // Recalculate bounding box after positioning
        const finalBox = new THREE.Box3().setFromObject(loadedObject);
        const finalCenter = finalBox.getCenter(new THREE.Vector3());

        // Store model bounds for camera control
        modelBoundsRef.current = { center: finalCenter, size: scaledSize };

        // Auto-fit camera
        const scaledMaxDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
        const fov = camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(scaledMaxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;
        camera.position.z = cameraZ;

        // Update camera target to look at the centered model
        controls.target.copy(finalCenter);
        controls.update();
        setCurrentView('isometric');

        setLoading(false);
      } catch (err) {
        console.error('Error loading 3D model:', err);
        setError(`Failed to load file: ${err.message}`);
        setLoading(false);
      }
    };

    loadGeometry();

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!mountRef.current) return;
      const width = mountRef.current.clientWidth;
      const height = mountRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();

      // Properly clean up all children in mount ref
      if (mountRef.current) {
        while (mountRef.current.firstChild) {
          mountRef.current.removeChild(mountRef.current.firstChild);
        }
      }
    };
  }, [fileId, currentPath, fileName, shareToken, sharePassword]);

  return (
    <div className="w-full h-full flex flex-col gap-2 relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded z-50">
          <div className="text-white">Loading 3D model...</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded z-50">
          <div className="text-red-400">{error}</div>
        </div>
      )}
      <div ref={mountRef} className="flex-1 w-full rounded bg-gray-900 relative">
        {/* Cube Camera Control */}
        <div className="absolute top-4 right-4 w-24 h-24 bg-gray-800 bg-opacity-80 rounded-lg p-1 z-40">
          <div className="relative w-full h-full grid grid-cols-3 gap-0.5">
            {/* Top face */}
            <button
              onClick={() => jumpToView('top')}
              className={`col-span-1 text-xs font-bold rounded ${currentView === 'top' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title="Top"
            >
              T
            </button>
            <div className="col-span-1" />
            <button
              onClick={() => jumpToView('isometric')}
              className={`col-span-1 text-xs font-bold rounded ${currentView === 'isometric' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title="Isometric"
            >
              ISO
            </button>

            {/* Left, Front, Right */}
            <button
              onClick={() => jumpToView('left')}
              className={`text-xs font-bold rounded ${currentView === 'left' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title="Left"
            >
              L
            </button>
            <button
              onClick={() => jumpToView('front')}
              className={`text-xs font-bold rounded ${currentView === 'front' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title="Front"
            >
              F
            </button>
            <button
              onClick={() => jumpToView('right')}
              className={`text-xs font-bold rounded ${currentView === 'right' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title="Right"
            >
              R
            </button>

            {/* Bottom face */}
            <div className="col-span-1" />
            <button
              onClick={() => jumpToView('bottom')}
              className={`col-span-1 text-xs font-bold rounded ${currentView === 'bottom' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title="Bottom"
            >
              B
            </button>
            <button
              onClick={() => jumpToView('back')}
              className={`col-span-1 text-xs font-bold rounded ${currentView === 'back' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title="Back"
            >
              BK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
