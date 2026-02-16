/** @format */

'use client';

import { useEffect, useState, useRef } from 'react';
import { FiImage } from 'react-icons/fi';
import { getThumbnailUrl } from '@/lib/api/files';
import { safeDecodeURIComponent } from '@/lib/safeUriDecode';

export default function LazyImage({ src, alt, className, onError, isThumbnail = false, fileId = null, filePath = '' }) {
  const [isInView, setIsInView] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef(null);

  // Get thumbnail URL (when in view and for thumbnails only)
  // URL is stable/deterministic so browser caches via HTTP cache headers
  const thumbnailUrl = isThumbnail && isInView && fileId ? getThumbnailUrl(fileId, filePath) : null;

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
        rootMargin: '400px',
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


  const handleLoad = () => {
    setIsLoaded(true);
  };

  const handleError = () => {
    setHasError(true);
    if (onError) {
      onError();
    }
  };

  // Use thumbnail URL if available, otherwise use original src
  const imageSrc = isThumbnail && thumbnailUrl ? thumbnailUrl : src;
  const showImage = !isThumbnail || thumbnailUrl;

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
          {!isLoaded && !hasError && (
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
