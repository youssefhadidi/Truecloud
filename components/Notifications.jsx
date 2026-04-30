/** @format */

'use client';

import { FiX, FiAlertCircle, FiCheckCircle, FiInfo, FiAlertTriangle } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';

const KIND_META = {
  success: { Icon: FiCheckCircle, color: 'var(--success)' },
  error:   { Icon: FiAlertCircle, color: 'var(--danger)' },
  warning: { Icon: FiAlertTriangle, color: 'var(--warning)' },
  info:    { Icon: FiInfo, color: 'var(--accent)' },
};

export default function Notifications() {
  const { notifications, dismissNotification } = useNotifications();

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 360,
      }}
    >
      {notifications.map((n) => {
        const meta = KIND_META[n.type] || KIND_META.info;
        const { Icon } = meta;
        return (
          <div
            key={n.id}
            style={{
              pointerEvents: 'all',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              padding: '12px 14px',
              boxShadow: 'var(--shadow-lg)',
              animation: 'tc-toastIn 250ms ease both',
              minWidth: 240,
              borderLeft: `3px solid ${meta.color}`,
              color: 'var(--text)',
            }}
          >
            <Icon size={16} color={meta.color} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {n.title && (
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>
                  {n.title}
                </div>
              )}
              <div style={{ fontSize: 13, fontWeight: 500, color: n.title ? 'var(--text-2)' : 'var(--text)', lineHeight: 1.4 }}>
                {n.message}
              </div>
            </div>
            <button
              onClick={() => dismissNotification(n.id)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-3)',
                display: 'flex',
                padding: 0,
                marginTop: 2,
              }}
            >
              <FiX size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
