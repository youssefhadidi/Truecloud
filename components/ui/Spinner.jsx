'use client';

export default function Spinner({ size = 16, color = '#fff', borderColor = 'rgba(255,255,255,.3)', thickness = 2 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: `${thickness}px solid ${borderColor}`,
        borderTop: `${thickness}px solid ${color}`,
        borderRadius: 99,
        animation: 'tc-spin 600ms linear infinite',
        flexShrink: 0,
      }}
    />
  );
}
