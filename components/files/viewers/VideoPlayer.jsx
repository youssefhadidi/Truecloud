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

  return (
    <video
      ref={videoRef}
      src={getFileUrl(file, 'video')}
      key={file.id}
      controls
      className="w-full h-full"
      onLoadStart={() => {
        // Verify this is still the current video
        if (loadVersionRef.current !== currentVersion) {
          videoRef.current.pause();
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
