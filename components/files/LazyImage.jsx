/** @format */

'use client';

import { useEffect, useState, useRef } from 'react';
import { FiImage } from 'react-icons/fi';

export default function LazyImage({ src, alt, className, onError, isThumbnail = false }) {
  const [isInView, setIsInView] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [thumbnailReady, setThumbnailReady] = useState(!isThumbnail);
  const [isGenerating, setIsGenerating] = useState(isThumbnail);
  const imgRef = useRef(null);
  const pollIntervalRef = useRef(null);

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

  // Handle thumbnail generation and polling
  useEffect(() => {
    if (!isThumbnail || !isInView || thumbnailReady) return;

    const params = getThumbnailParams();
    if (!params) {
      setThumbnailReady(true);
      return;
    }

    const handleThumbnailGeneration = async () => {
      try {
        setIsGenerating(true);

        // Step 1: Check if thumbnail exists
        const checkRes = await fetch(`/api/files/thumbnail/${params.id}?path=${encodeURIComponent(params.path)}`);
        const checkData = await checkRes.json();

        if (checkData.exists) {
          // Thumbnail already exists, we're ready to load it
          setThumbnailReady(true);
          setIsGenerating(false);
          return;
        }

        if (checkData.status === 'pending') {
          // Thumbnail doesn't exist, request generation
          await fetch('/api/files/thumbnail/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: params.id, path: params.path }),
          });

          // Step 2: Poll for completion (check every 500ms, max 20 attempts = 10 seconds)
          let attempts = 0;
          const maxAttempts = 20;

          const interval = setInterval(async () => {
            attempts++;
            try {
              const pollRes = await fetch(`/api/files/thumbnail/${params.id}?path=${encodeURIComponent(params.path)}`);
              const pollData = await pollRes.json();

              if (pollData.exists) {
                // Thumbnail is ready
                setThumbnailReady(true);
                setIsGenerating(false);
                clearInterval(interval);
              } else if (attempts >= maxAttempts) {
                // Timeout after 10 seconds, show error
                setHasError(true);
                setIsGenerating(false);
                clearInterval(interval);
              }
            } catch (err) {
              console.error('Error polling thumbnail status:', err);
              if (attempts >= maxAttempts) {
                setHasError(true);
                setIsGenerating(false);
                clearInterval(interval);
              }
            }
          }, 500);

          pollIntervalRef.current = interval;
        } else {
          // Unsupported or unknown status
          setHasError(true);
          setIsGenerating(false);
        }
      } catch (err) {
        console.error('Error initiating thumbnail generation:', err);
        setHasError(true);
        setIsGenerating(false);
      }
    };

    handleThumbnailGeneration();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isThumbnail, isInView, thumbnailReady]);

  const handleLoad = () => {
    setIsLoaded(true);
  };

  const handleError = () => {
    setHasError(true);
    if (onError) {
      onError();
    }
  };

  return (
    <div ref={imgRef} className={`relative ${className}`}>
      {isInView ? (
        <>
          {!hasError && thumbnailReady && (
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
