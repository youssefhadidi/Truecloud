/** @format */

import { useEffect, useRef } from 'react';

export function AudioPlayer({ file, getFileUrl }) {
  const audioRef = useRef(null);
  const loadVersionRef = useRef(0);

  // Cancel download when file changes
  useEffect(() => {
    loadVersionRef.current += 1;
    return () => {
      // Clear src to stop any pending downloads
      if (audioRef.current) {
        audioRef.current.src = '';
        audioRef.current.load();
      }
    };
  }, [file.id]);

  const currentVersion = loadVersionRef.current;

  return (
    <audio
      ref={audioRef}
      src={getFileUrl(file, 'audio')}
      controls
      autoPlay
      className="w-full"
      onLoadStart={() => {
        // Verify this is still the current audio
        if (loadVersionRef.current !== currentVersion) {
          audioRef.current.pause();
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
