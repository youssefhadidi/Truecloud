'use client';

const colors = {
  accent:  { bg: 'var(--accent-light)',  color: 'var(--accent)' },
  success: { bg: 'var(--success-light)', color: 'var(--success)' },
  warning: { bg: 'var(--warning-light)', color: 'var(--warning)' },
  danger:  { bg: 'var(--danger-light)',  color: 'var(--danger)' },
};

export default function Badge({ children, color = 'accent', style = {} }) {
  const c = colors[color] || colors.accent;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        background: c.bg,
        color: c.color,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
