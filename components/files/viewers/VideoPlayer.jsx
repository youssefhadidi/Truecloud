/** @format */

import { useEffect, useRef } from 'react';

export function VideoPlayer({ file, getFileUrl }) {
  const videoRef = useRef(null);
  const loadVersionRef = useRef(0);

  // Cancel download when file changes
  useEffect(() => {
    loadVersionRef.current += 1;
    return () => {
      // Clear src to stop any pending downloads
      if (videoRef.current) {
        videoRef.current.src = '';
        videoRef.current.load();
      }
    };
  }, [file.id]);

  const currentVersion = loadVersionRef.current;

  return (
    <video
      ref={videoRef}
      src={getFileUrl(file, 'video')}
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
