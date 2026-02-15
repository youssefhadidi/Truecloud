/** @format */

import { useEffect, useRef } from 'react';

export function VideoPlayer({ file, getFileUrl }) {
  const videoRef = useRef(null);
  const loadVersionRef = useRef(0);

  // Track file changes to abort old loads
  useEffect(() => {
    loadVersionRef.current += 1;
  }, [file.id]);

  const currentVersion = loadVersionRef.current;

  // Use HLS if browser supports it natively (Safari/iOS)
  // Other browsers fall back to byte-range stream
  const supportsHlsNatively =
    typeof document !== 'undefined' &&
    document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';

  const src = supportsHlsNatively ? getFileUrl(file, 'hls') : getFileUrl(file, 'video');

  return (
    <video
      ref={videoRef}
      src={src}
      key={file.id}
      controls
      className="w-full h-full"
      onLoadStart={() => {
        // Verify this is still the current video
        if (loadVersionRef.current !== currentVersion) {
          videoRef.current?.pause();
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
