'use client';

import { useState } from 'react';

const sizes = {
  sm: { fontSize: 12, padding: '4px 10px', height: 28 },
  md: { fontSize: 13, padding: '6px 14px', height: 34 },
  lg: { fontSize: 14, padding: '10px 20px', height: 42 },
};

const variants = {
  primary: { background: 'var(--accent)', color: '#fff', boxShadow: '0 1px 3px rgba(99,102,241,.35)' },
  ghost:   { background: 'transparent', color: 'var(--text-2)' },
  outline: { background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' },
  danger:  { background: 'var(--danger-light)', color: 'var(--danger)' },
  surface: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' },
};

const hoverStyles = {
  primary: { background: 'var(--accent-h)', transform: 'translateY(-1px)', boxShadow: '0 3px 8px rgba(99,102,241,.4)' },
  ghost:   { background: 'var(--surface-2)', color: 'var(--text)' },
  outline: { background: 'var(--surface-2)' },
  danger:  { background: 'rgba(239,68,68,.12)' },
  surface: { background: 'var(--surface-2)' },
};

export default function Btn({
  children,
  variant = 'ghost',
  size = 'md',
  onClick,
  disabled,
  type = 'button',
  style = {},
  className = '',
  title,
  ...rest
}) {
  const [hov, setHov] = useState(false);
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontFamily: 'inherit',
    fontWeight: 500,
    borderRadius: 'var(--r-sm)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 150ms ease',
    border: 'none',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    opacity: disabled ? 0.5 : 1,
  };
  const hovStyle = hov && !disabled ? hoverStyles[variant] : {};
  return (
    <button
      type={type}
      title={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ ...base, ...sizes[size], ...variants[variant], ...hovStyle, ...style }}
      className={className}
      {...rest}
    >
      {children}
    </button>
  );
}
