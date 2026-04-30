/** @format */

'use client';

import Btn from '@/components/ui/Btn';

export default function DeleteConfirm({ username, onCancel, onConfirm, isLoading = false }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-xl)',
        maxWidth: 460,
        width: '100%',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Delete User</h3>
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>
          Are you sure you want to delete <strong style={{ color: 'var(--text)' }}>{username}</strong>?
        </p>
        <div
          style={{
            background: 'var(--danger-light)',
            border: '1px solid color-mix(in oklab, var(--danger) 35%, transparent)',
            borderRadius: 'var(--r-md)',
            padding: 12,
            fontSize: 12,
            color: 'var(--danger)',
          }}
        >
          <p style={{ fontWeight: 700, margin: '0 0 4px' }}>This action will:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Permanently delete this user account</li>
            <li>Delete all files in their personal folder</li>
            <li>Remove all associated permissions and sessions</li>
          </ul>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0 }}>This action cannot be undone.</p>
      </div>
      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <Btn variant="outline" size="md" onClick={onCancel} disabled={isLoading} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
        <Btn
          variant="danger"
          size="md"
          onClick={onConfirm}
          disabled={isLoading}
          style={{ flex: 1, justifyContent: 'center', background: 'var(--danger)', color: '#fff' }}
        >
          {isLoading ? 'Deleting…' : 'Delete User'}
        </Btn>
      </div>
    </div>
  );
}
