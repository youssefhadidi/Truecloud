'use client';

export default function Toggle({ value, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange?.(!value)}
      disabled={disabled}
      style={{
        width: 40,
        height: 22,
        borderRadius: 99,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: value ? 'var(--accent)' : 'var(--border-strong)',
        position: 'relative',
        transition: 'background 200ms',
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: value ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: 99,
          background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,.2)',
          transition: 'left 200ms',
        }}
      />
    </button>
  );
}
