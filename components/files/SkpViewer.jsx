/** @format */

'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export default function SkpViewer({ fileId, currentPath, fileName }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!mountRef.current) return;

    // Initialize Three.js scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    sceneRef.current = scene;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 10000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    scene.add(directionalLight);

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = false;
    controls.enableZoom = true;
    controlsRef.current = controls;

    // Load SKP file as OBJ/GLB (converted on server)
    const loadGeometry = async () => {
      try {
        let objectUrl;
        const fileNameLower = (fileName || '').toLowerCase();
        let object;

        // For SKP files, use the conversion endpoint
        if (fileNameLower.endsWith('.skp')) {
          objectUrl = `/api/files/convert-skp?id=${fileId}&path=${encodeURIComponent(currentPath)}`;
        } else {
          objectUrl = `/api/files/download/${fileId}?path=${encodeURIComponent(currentPath)}`;
        }

        // Try GLB/GLTF first (includes converted SKP files)
        if (fileNameLower.endsWith('.glb') || fileNameLower.endsWith('.gltf') || fileNameLower.endsWith('.skp')) {
          const gltfLoader = new GLTFLoader();
          object = await new Promise((resolve, reject) => {
            gltfLoader.load(objectUrl, resolve, undefined, reject);
          });
          scene.add(object.scene);
        }
        // Try OBJ format
        else if (fileNameLower.endsWith('.obj')) {
          const objLoader = new OBJLoader();
          const response = await fetch(objectUrl);
          const text = await response.text();
          object = objLoader.parse(text);
          scene.add(object);
        }
        // Default fallback
        else {
          setError(`Unsupported file format: ${fileNameLower}`);
          setLoading(false);
          return;
        }

        // Get the loaded object for bounding box calculation
        const loadedObject = object.scene || object;

        // Auto-fit camera
        const box = new THREE.Box3().setFromObject(loadedObject);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;
        camera.position.z = cameraZ;
        controls.target.copy(box.getCenter(new THREE.Vector3()));
        controls.update();

        setLoading(false);
      } catch (err) {
        console.error('Error loading model:', err);
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
      mountRef.current?.removeChild(renderer.domElement);
    };
  }, [fileId, currentPath]);

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
      <div ref={mountRef} className="flex-1 w-full rounded bg-gray-900" />
      <div className="text-xs text-gray-400 px-4 py-2 bg-gray-800 rounded">
        <p>Controls: Left Mouse - Rotate | Right Mouse/Scroll - Pan/Zoom</p>
      </div>
    </div>
  );
}
