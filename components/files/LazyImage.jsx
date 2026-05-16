/** @format */

'use client';

import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FiImage } from 'react-icons/fi';
import { getThumbnailUrl } from '@/lib/api/files';

const centerAbsolute = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function ThumbnailSpinner() {
  return (
    <div style={centerAbsolute}>
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          border: '2.5px solid var(--border)',
          borderTopColor: 'var(--accent)',
          animation: 'tc-spin 700ms linear infinite',
        }}
      />
    </div>
  );
}

async function fetchBlobUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('thumbnail fetch failed');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default function LazyImage({ src, alt, style, onError, isThumbnail = false, fileId = null, filePath = '' }) {
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
      { rootMargin: '100px', threshold: 0.01 },
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
    structuralSharing: false,
  });

  const imageSrc = isThumbnail ? blobUrl : src;
  const showImage = isThumbnail ? !!blobUrl : true;

  return (
    <div ref={imgRef} style={{ position: 'relative', ...style }}>
      {isInView ? (
        <>
          {!isError && showImage && (
            <img
              src={imageSrc}
              alt={alt}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 1, transition: 'opacity 200ms' }}
              onError={onError}
              loading="lazy"
              decoding="async"
            />
          )}
          {!showImage && !isError && <ThumbnailSpinner />}
          {isError && (
            <div style={{ ...centerAbsolute, color: 'var(--text-3)' }}>
              <FiImage size={22} />
            </div>
          )}
        </>
      ) : (
        <ThumbnailSpinner />
      )}
    </div>
  );
}
