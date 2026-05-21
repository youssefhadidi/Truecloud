/** @format */

'use client';

import { useEffect, useState } from 'react';
import { FiX, FiRefreshCw } from 'react-icons/fi';
import Btn from '@/components/ui/Btn';
import IconBtn from '@/components/ui/IconBtn';
import { useWebSocket } from '@/contexts/WebSocketContext';

export default function PendingReloadBanner() {
  const [pending, setPending] = useState(false);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    return subscribe('app-updated', () => setPending(true));
  }, [subscribe]);

  if (!pending) return null;

  return (
    <div
      className="tc-anim-slide"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 5600,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 'var(--r-md)',
        boxShadow: 'var(--shadow-xl)',
        padding: 14,
        maxWidth: 360,
        width: 'calc(100vw - 32px)',
      }}
    >
      <div style={{ position: 'absolute', top: 6, right: 6 }}>
        <IconBtn
          icon={FiX}
          title="Dismiss"
          onClick={() => setPending(false)}
          width={26}
          height={26}
          size={13}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingRight: 24 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--r-sm)',
            background: 'var(--accent-light)',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <FiRefreshCw size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            Update applied
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
            A new version is running on the server. Refresh to load it.
          </div>
          <div style={{ marginTop: 10 }}>
            <Btn variant="primary" size="sm" onClick={() => window.location.reload()}>
              Refresh now
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
