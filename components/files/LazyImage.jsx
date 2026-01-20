/** @format */

'use client';

import { useEffect, useState, useRef } from 'react';
import { FiImage } from 'react-icons/fi';

export default function LazyImage({ src, alt, className, onError }) {
  const [isInView, setIsInView] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef(null);

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
          {!hasError && (
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
          {!isLoaded && !hasError && (
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
