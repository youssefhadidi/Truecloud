'use client';

export default function Divider({ vertical, style = {} }) {
  return (
    <div
      style={
        vertical
          ? { width: 1, height: 20, background: 'var(--border)', flexShrink: 0, ...style }
          : { height: 1, background: 'var(--border)', margin: '4px 0', ...style }
      }
    />
  );
}
