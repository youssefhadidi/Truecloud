'use client';

import { useEffect } from 'react';

export default function Overlay({ onClose, children, lockScroll = true, zIndex = 8000 }) {
  useEffect(() => {
    if (!lockScroll) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, lockScroll]);

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15,23,42,.45)',
        backdropFilter: 'blur(4px)',
        animation: 'tc-fadeIn 200ms ease both',
      }}
    >
      {children}
    </div>
  );
}
