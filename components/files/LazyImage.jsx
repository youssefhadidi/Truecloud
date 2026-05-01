/** @format */

'use client';

import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FiImage } from 'react-icons/fi';
import { getThumbnailUrl } from '@/lib/api/files';

async function fetchBlobUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('thumbnail fetch failed');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export default function LazyImage({ src, alt, className, onError, isThumbnail = false, fileId = null, filePath = '' }) {
  const [isInView, setIsInView] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px', threshold: 0.01 },
    );
    if (imgRef.current) observer.observe(imgRef.current);
    return () => { if (imgRef.current) observer.unobserve(imgRef.current); };
  }, []);

  const thumbnailUrl = isThumbnail && fileId ? getThumbnailUrl(fileId, filePath) : null;

  const { data: blobUrl, isError } = useQuery({
    queryKey: ['thumbnail', fileId, filePath],
    queryFn: () => fetchBlobUrl(thumbnailUrl),
    enabled: isThumbnail && !!fileId && isInView,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });

  const imageSrc = isThumbnail ? blobUrl : src;
  const showImage = isThumbnail ? !!blobUrl : true;

  return (
    <div ref={imgRef} className={`relative ${className}`}>
      {isInView ? (
        <>
          {!isError && showImage && (
            <img
              src={imageSrc}
              alt={alt}
              className={`${className} transition-opacity duration-200`}
              onError={onError}
              loading="lazy"
              decoding="async"
            />
          )}
          {!showImage && !isError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <FiImage className="text-gray-400 animate-spin" size={24} />
            </div>
          )}
          {isError && (
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
