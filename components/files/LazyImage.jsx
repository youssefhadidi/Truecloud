/** @format */

'use client';

import { useState } from 'react';
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

export default function LazyImage({ src, alt, style, onError, isThumbnail = false, fileId = null, filePath = '' }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const imageSrc = isThumbnail && fileId ? getThumbnailUrl(fileId, filePath) : src;

  if (!imageSrc) {
    return (
      <div style={{ position: 'relative', ...style }}>
        <ThumbnailSpinner />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', ...style }}>
      {!errored && (
        <img
          src={imageSrc}
          alt={alt}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={(e) => {
            setErrored(true);
            onError?.(e);
          }}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 200ms',
          }}
        />
      )}
      {!loaded && !errored && <ThumbnailSpinner />}
      {errored && (
        <div style={{ ...centerAbsolute, color: 'var(--text-3)' }}>
          <FiImage size={22} />
        </div>
      )}
    </div>
  );
}
