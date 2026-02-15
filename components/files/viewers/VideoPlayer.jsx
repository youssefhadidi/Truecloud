/** @format */

import { useEffect, useRef } from 'react';
import HLS from 'hls.js';

export function VideoPlayer({ file, getFileUrl }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const loadVersionRef = useRef(0);

  // Track file changes to abort old loads
  useEffect(() => {
    loadVersionRef.current += 1;
  }, [file.id]);

  const currentVersion = loadVersionRef.current;

  // Setup HLS playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Cleanup previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const hlsUrl = getFileUrl(file, 'hls');
    const fallbackUrl = getFileUrl(file, 'video');

    // Check if HLS is supported
    if (HLS.isSupported()) {
      const hls = new HLS({
        debug: false,
        enableWorker: true,
      });

      hlsRef.current = hls;

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      // Fallback to regular stream if HLS fails
      hls.on(HLS.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('HLS error, falling back to regular stream:', data);
          hls.destroy();
          hlsRef.current = null;
          video.src = fallbackUrl;
        }
      });

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    } else {
      // Fallback for browsers without HLS support
      video.src = fallbackUrl;
    }
  }, [file.id, getFileUrl, file]);

  return (
    <video
      ref={videoRef}
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
