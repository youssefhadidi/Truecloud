/** @format */

'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Scene,
  CanvasTexture,
  PerspectiveCamera,
  WebGLRenderer,
  AmbientLight,
  DirectionalLight,
  GridHelper,
  AxesHelper,
  PMREMGenerator,
  MOUSE,
  TOUCH,
  Box3,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createModelSource, loadModel } from './viewers/model3d';

function disposeObject(root) {
  root.traverse((node) => {
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}

export default function Viewer3D({ fileId, currentPath, fileName, shareToken, sharePassword, singleFileShare }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const modelBoundsRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [missing, setMissing] = useState([]);
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

    setLoading(true);
    setProgress(null);
    setError(null);
    setMissing([]);
    modelBoundsRef.current = null;

    // Initialize Three.js scene
    const scene = new Scene();

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

    const texture = new CanvasTexture(canvas);
    scene.background = texture;
    sceneRef.current = scene;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const camera = new PerspectiveCamera(75, width / height, 0.1, 10000);
    camera.position.set(0, 0, 100);
    cameraRef.current = camera;

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Clear any existing renderer before appending new one
    while (mountRef.current.firstChild) {
      mountRef.current.removeChild(mountRef.current.firstChild);
    }

    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Image-based lighting so PBR materials (glTF, USDZ, FBX) aren't flat and dark
    const pmrem = new PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.6;

    // Add lighting
    const ambientLight = new AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Add grid helper
    const gridHelper = new GridHelper(200, 40, 0x444444, 0x222222);
    gridHelper.position.y = -100;
    scene.add(gridHelper);

    // Add axis helper
    const axesHelper = new AxesHelper(100);
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
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    };

    // Enable two-finger touch controls
    controls.touches = {
      ONE: TOUCH.ROTATE,
      TWO: TOUCH.DOLLY_PAN,
    };

    controlsRef.current = controls;

    // The effect can be torn down (viewer closed, next file) while the model
    // is still downloading or parsing — nothing may touch the scene or React
    // state after that.
    const abort = new AbortController();
    let disposed = false;
    let model = null;
    let disposeLoaders = null;
    let missingNames = [];

    const fitModel = (loadedObject) => {
      // Calculate bounding box
      const box = new Box3().setFromObject(loadedObject);
      const size = box.getSize(new Vector3());

      // Scale model to fit 50% of grid (grid is 200x200, so target is ~100 units)
      const targetSize = 100; // 50% of 200 unit grid
      const maxDim = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(maxDim) || maxDim === 0) throw new Error('The file contains no visible geometry');
      const scale = targetSize / maxDim;
      loadedObject.scale.multiplyScalar(scale);

      // Recalculate bounding box after scaling
      const scaledBox = new Box3().setFromObject(loadedObject);
      const scaledSize = scaledBox.getSize(new Vector3());
      const scaledCenter = scaledBox.getCenter(new Vector3());

      // Position model: center horizontally (X, Z), position on floor (Y)
      const floorY = -100;
      loadedObject.position.x = -scaledCenter.x;
      loadedObject.position.y = floorY - scaledBox.min.y;
      loadedObject.position.z = -scaledCenter.z;

      // Point clouds: point size is in view units, unaffected by the scale above
      loadedObject.traverse((node) => {
        if (node.isPoints) node.material.size = 0.6;
      });

      // Recalculate bounding box after positioning
      const finalBox = new Box3().setFromObject(loadedObject);
      const finalCenter = finalBox.getCenter(new Vector3());

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
    };

    loadModel({
      source: createModelSource({ fileId, fileName, currentPath, shareToken, sharePassword, singleFileShare }),
      fileName,
      renderer,
      signal: abort.signal,
      onProgress: (fraction) => !disposed && setProgress(fraction),
      onMissing: (names) => {
        missingNames = names;
        if (!disposed) setMissing(names);
      },
    })
      .then(({ object, dispose }) => {
        model = object;
        disposeLoaders = dispose;
        if (disposed) {
          disposeLoaders();
          disposeObject(model);
          return;
        }
        fitModel(object);
        scene.add(object);
        setLoading(false);
      })
      .catch((err) => {
        if (disposed || err.name === 'AbortError') return;
        console.error('Error loading 3D model:', err);
        // A missing .bin / .mtl usually is the real cause; the loader's own
        // message is just the failed request URL.
        setError(
          missingNames.length
            ? `Failed to load file: missing ${missingNames.join(', ')}`
            : `Failed to load file: ${err.message}`,
        );
        setLoading(false);
      });

    // Animation loop
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
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
      disposed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      if (model) disposeObject(model);
      disposeLoaders?.();
      gridHelper.dispose();
      axesHelper.dispose();
      texture.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();

      // Properly clean up all children in mount ref
      if (mountRef.current) {
        while (mountRef.current.firstChild) {
          mountRef.current.removeChild(mountRef.current.firstChild);
        }
      }
    };
  }, [fileId, currentPath, fileName, shareToken, sharePassword, singleFileShare]);

  const cubeBtn = (active) => ({
    fontSize: 11,
    fontWeight: 700,
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    background: active ? 'var(--accent)' : 'rgba(255,255,255,.10)',
    color: active ? '#fff' : 'rgba(255,255,255,.85)',
    transition: 'background 120ms',
  });

  return (
    <div style={{ width: '100%', height: '100%', flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,.55)',
            zIndex: 50,
          }}
        >
          <div className="mv-loader-card">
            <div className="mv-spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
            <span className="mv-loader-card__text">
              Loading 3D model…{progress != null && progress < 1 ? ` ${Math.round(progress * 100)}%` : ''}
            </span>
          </div>
        </div>
      )}
      {error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,.55)',
            zIndex: 50,
          }}
        >
          <div
            className="mv-video-state-card"
            style={{
              padding: '20px 28px',
              background: 'var(--danger-light)',
              borderColor: 'var(--danger)',
              color: 'var(--danger)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        </div>
      )}
      {/* Textures / .mtl / .bin the model references but that aren't in its folder */}
      {missing.length > 0 && !error && (
        <div
          title={missing.join('\n')}
          style={{
            position: 'absolute',
            left: 14,
            bottom: 14,
            maxWidth: 'calc(100% - 28px)',
            padding: '6px 10px',
            background: 'rgba(15,23,42,.72)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,.10)',
            borderRadius: 8,
            color: 'rgba(255,255,255,.85)',
            fontSize: 12,
            zIndex: 45,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {missing.length === 1 ? 'Missing file' : `${missing.length} missing files`}: {missing.slice(0, 3).join(', ')}
          {missing.length > 3 ? '…' : ''}
        </div>
      )}
      <div ref={mountRef} style={{ flex: 1, width: '100%', position: 'relative', background: '#0f172a', borderRadius: 0 }}>
        {/* Cube camera control */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            width: 96,
            height: 96,
            background: 'rgba(15,23,42,.72)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,.10)',
            borderRadius: 10,
            padding: 4,
            zIndex: 40,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gridTemplateRows: 'repeat(3, 1fr)',
            gap: 3,
          }}
        >
          <button onClick={() => jumpToView('top')} style={cubeBtn(currentView === 'top')} title="Top">T</button>
          <div />
          <button onClick={() => jumpToView('isometric')} style={cubeBtn(currentView === 'isometric')} title="Isometric">ISO</button>
          <button onClick={() => jumpToView('left')} style={cubeBtn(currentView === 'left')} title="Left">L</button>
          <button onClick={() => jumpToView('front')} style={cubeBtn(currentView === 'front')} title="Front">F</button>
          <button onClick={() => jumpToView('right')} style={cubeBtn(currentView === 'right')} title="Right">R</button>
          <div />
          <button onClick={() => jumpToView('bottom')} style={cubeBtn(currentView === 'bottom')} title="Bottom">B</button>
          <button onClick={() => jumpToView('back')} style={cubeBtn(currentView === 'back')} title="Back">BK</button>
        </div>
      </div>
    </div>
  );
}
