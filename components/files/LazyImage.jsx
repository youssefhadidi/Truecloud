/** @format */

'use client';

import { useEffect, useState, useRef } from 'react';
import { FiImage } from 'react-icons/fi';
import { useThumbnailStatus, useGenerateThumbnail, useThumbnailReady } from '@/lib/api/files';

export default function LazyImage({ src, alt, className, onError, isThumbnail = false }) {
  const [isInView, setIsInView] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [shouldGenerateThumbnail, setShouldGenerateThumbnail] = useState(false);
  const [pollForThumbnail, setPollForThumbnail] = useState(false);
  const imgRef = useRef(null);

  // Extract fileId and path from src for thumbnail generation requests
  const getThumbnailParams = () => {
    if (!isThumbnail || !src) return null;
    // src format: /api/files/thumbnail/[id]?path=[path]
    const match = src.match(/\/api\/files\/thumbnail\/([^?]+)(?:\?path=(.+))?/);
    if (match) {
      return {
        id: decodeURIComponent(match[1]),
        path: match[2] ? decodeURIComponent(match[2]) : '',
      };
    }
    return null;
  };

  const params = getThumbnailParams();

  // Step 1: Check if thumbnail exists
  const { data: statusData } = useThumbnailStatus(
    params?.id || null,
    params?.path || '',
    isThumbnail && isInView && !isLoaded && !hasError
  );

  // Step 2: Generate thumbnail if needed
  const generateMutation = useGenerateThumbnail();

  // Step 3: Poll for thumbnail ready status
  const { data: readyData } = useThumbnailReady(
    params?.id || null,
    params?.path || '',
    pollForThumbnail
  );

  // Handle intersection observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '200px', // Increased for smoother loading experience
        threshold: 0.01, // Start loading as soon as 1% is visible
      },
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      if (imgRef.current) {
        observer.unobserve(imgRef.current);
      }
    };
  }, []);

  // Handle thumbnail status check and generation request
  useEffect(() => {
    if (!isThumbnail || !isInView || !statusData || !params) return;

    if (statusData.exists) {
      // Thumbnail already exists, we can load it now
      return;
    }

    if (statusData.status === 'pending' && !shouldGenerateThumbnail) {
      // Request generation
      setShouldGenerateThumbnail(true);
      generateMutation.mutate({ id: params.id, path: params.path });
      setPollForThumbnail(true);
    }
  }, [statusData, isThumbnail, isInView, shouldGenerateThumbnail, params, generateMutation]);

  // Handle polling completion
  useEffect(() => {
    if (!pollForThumbnail || !readyData) return;

    if (readyData.ready) {
      // Thumbnail is ready, stop polling and allow image to load
      setPollForThumbnail(false);
    }
  }, [readyData, pollForThumbnail]);

  const handleLoad = () => {
    setIsLoaded(true);
  };

  const handleError = () => {
    setHasError(true);
    setPollForThumbnail(false);
    if (onError) {
      onError();
    }
  };

  // Determine if we should show the image
  const showImage = !isThumbnail || !statusData || statusData.exists || readyData?.ready;
  const isGenerating = shouldGenerateThumbnail && !readyData?.ready;

  return (
    <div ref={imgRef} className={`relative ${className}`}>
      {isInView ? (
        <>
          {!hasError && showImage && (
            <img
              src={src}
              alt={alt}
              className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
              onLoad={handleLoad}
              onError={handleError}
              loading="lazy"
              decoding="async"
            />
          )}
          {(!isLoaded || isGenerating) && !hasError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 animate-pulse">
              <FiImage className="text-gray-400" size={24} />
            </div>
          )}
          {hasError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700">
              <FiImage className="text-gray-400" size={24} />
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 animate-pulse">
          <FiImage className="text-gray-400" size={20} />
        </div>
      )}
    </div>
  );
}
