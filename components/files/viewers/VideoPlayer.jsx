/** @format */

import { useEffect, useRef } from 'react';
import HLS from 'hls.js';

export function VideoPlayer({ file, getFileUrl }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
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
        manifestLoadingRetryDelay: 2000,
        manifestLoadingMaxRetry: 15,
        levelLoadingRetryDelay: 2000,
        levelLoadingMaxRetry: 15,
      });

      hlsRef.current = hls;

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      // Fallback to regular stream if HLS fails
      hls.on(HLS.Events.ERROR, (event, data) => {
        console.warn('HLS error:', data);

        // Retry on non-fatal errors for a short time, then fallback
        if (!data.fatal) {
          // Non-fatal errors will be retried automatically
          return;
        }

        // Fatal errors: switch to regular stream
        console.warn('HLS fatal error, falling back to regular stream:', data);
        if (hlsRef.current) {
          hls.destroy();
          hlsRef.current = null;
        }
        video.src = fallbackUrl;
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
  }, [file.id, getFileUrl]);

  return (
    <video
      ref={videoRef}
      key={file.id}
      controls
      className="w-full h-full"
      onClick={(e) => e.stopPropagation()}
    />
  );
}
