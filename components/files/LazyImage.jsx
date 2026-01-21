/** @format */

'use client';

import { useEffect, useState, useRef } from 'react';
import { FiImage } from 'react-icons/fi';
import { useThumbnail } from '@/lib/api/files';

export default function LazyImage({ src, alt, className, onError, isThumbnail = false }) {
  const [isInView, setIsInView] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef(null);

  // Extract fileId and path from src for thumbnail requests
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

  // Fetch thumbnail (generates if needed)
  const { data: thumbnailData, isLoading, isError } = useThumbnail(params?.id || null, params?.path || '', isThumbnail && isInView && !hasError);

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
        rootMargin: '200px',
        threshold: 0.01,
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

  // Handle error from React Query
  useEffect(() => {
    if (isError) {
      setHasError(true);
      if (onError) {
        onError();
      }
    }
  }, [isError, onError]);

  const handleLoad = () => {
    setIsLoaded(true);
  };

  const handleError = () => {
    setHasError(true);
    if (onError) {
      onError();
    }
  };

  // Use base64 data if it's a thumbnail, otherwise use original src
  const imageSrc = isThumbnail && thumbnailData?.data ? thumbnailData.data : src;
  const showImage = !isThumbnail || thumbnailData?.data;

  return (
    <div ref={imgRef} className={`relative ${className}`}>
      {isInView ? (
        <>
          {!hasError && showImage && (
            <img
              src={imageSrc}
              alt={alt}
              className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
              onLoad={handleLoad}
              onError={handleError}
              loading="lazy"
              decoding="async"
            />
          )}
          {(!isLoaded || isLoading) && !hasError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <FiImage className="text-gray-400 animate-spin" size={24} />
            </div>
          )}
          {hasError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <FiImage className="text-gray-400" size={24} />
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <FiImage className="text-gray-400 animate-spin" size={20} />
        </div>
      )}
    </div>
  );
}
