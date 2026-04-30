'use client';

export default function Card({ title, subtitle, children, footer, padding = '18px 20px', style = {} }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-xl)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
        ...style,
      }}
    >
      {(title || subtitle) && (
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          {title && <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{title}</div>}
          {subtitle && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{subtitle}</div>}
        </div>
      )}
      <div style={{ padding }}>{children}</div>
      {footer && (
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          {footer}
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 22, color: 'var(--text)', letterSpacing: '-0.02em' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      {actions}
    </div>
  );
}
