'use client';

import { useState } from 'react';

export default function IconBtn({
  icon: IconCmp,
  size = 16,
  title,
  onClick,
  active,
  danger,
  badge,
  disabled,
  style = {},
  width = 32,
  height = 32,
}) {
  const [hov, setHov] = useState(false);
  const bg = active
    ? 'var(--accent-light)'
    : hov && !disabled
    ? 'var(--surface-2)'
    : 'transparent';
  const color = danger
    ? 'var(--danger)'
    : active
    ? 'var(--accent)'
    : hov && !disabled
    ? 'var(--text)'
    : 'var(--text-2)';
  return (
    <button
      type="button"
      title={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width,
        height,
        borderRadius: 'var(--r-sm)',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: bg,
        color,
        transition: 'all 150ms ease',
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {IconCmp ? <IconCmp size={size} /> : null}
      {badge != null && (
        <span
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            borderRadius: 99,
            minWidth: 14,
            height: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
            lineHeight: 1,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
