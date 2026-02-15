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
        fragLoadingRetryDelay: 2000,
        fragLoadingMaxRetry: 15,
      });

      hlsRef.current = hls;

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(HLS.Events.ERROR, (event, data) => {
        console.warn('HLS error:', data.type, data.details);

        if (!data.fatal) return;

        // Attempt recovery before falling back
        if (data.type === HLS.ErrorTypes.NETWORK_ERROR) {
          console.warn('HLS network error, attempting recovery...');
          hls.startLoad();
          return;
        }

        if (data.type === HLS.ErrorTypes.MEDIA_ERROR) {
          console.warn('HLS media error, attempting recovery...');
          hls.recoverMediaError();
          return;
        }

        // Unrecoverable error: switch to regular stream
        console.warn('HLS fatal error, falling back to regular stream');
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
