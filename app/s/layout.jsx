/** @format */

export const metadata = {
  title: 'Shared File · Truecloud',
  description: 'View shared file',
};

export default function ShareLayout({ children }) {
  return (
    <div
      style={{
        height: '100dvh',
        background: 'var(--bg)',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
      }}
    >
      <header
        style={{
          height: 'var(--header-h)',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
          flexShrink: 0,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-128.png"
            alt=""
            width={28}
            height={28}
            style={{ borderRadius: 'var(--r-sm)', flexShrink: 0, display: 'block' }}
          />
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em' }}>Truecloud</span>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Shared with you</span>
      </header>
      <main style={{ flex: 1, width: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  );
}
