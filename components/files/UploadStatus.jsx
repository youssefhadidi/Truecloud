/** @format */

'use client';

import { FiCheckCircle, FiXCircle, FiUpload, FiDownload } from 'react-icons/fi';
import Spinner from '@/components/ui/Spinner';

export default function UploadStatus({ uploads, transfers }) {
  const items = transfers || uploads || [];
  if (items.length === 0) return null;

  return (
    <div
      className="tc-anim-slide"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 6000,
        width: 320,
        maxHeight: 400,
        overflowY: 'auto',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-xl)',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          fontWeight: 700,
          fontSize: 13,
          color: 'var(--text)',
        }}
      >
        Transfers
      </div>

      {items.map((item) => {
        const isDownload = item.type === 'download';
        const isActive = item.status === 'uploading' || item.status === 'downloading';
        const accent = isDownload ? 'var(--accent)' : 'var(--accent)';
        return (
          <div key={item.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flexShrink: 0, marginTop: 2 }}>
                {isActive ? (
                  <Spinner size={14} color="var(--accent)" borderColor="var(--border)" thickness={2} />
                ) : item.status === 'success' ? (
                  <FiCheckCircle color="var(--success)" size={16} />
                ) : item.status === 'error' ? (
                  <FiXCircle color="var(--danger)" size={16} />
                ) : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isDownload ? <FiDownload size={13} color="var(--accent)" /> : <FiUpload size={13} color="var(--accent)" />}
                  <span
                    className="tc-truncate"
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1 }}
                    title={item.fileName}
                  >
                    {item.fileName}
                  </span>
                  {isActive && (
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {item.progress ?? 0}%
                    </span>
                  )}
                </div>
                {isActive && (
                  <div
                    style={{
                      marginTop: 6,
                      height: 3,
                      background: 'var(--surface-2)',
                      borderRadius: 99,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${item.progress ?? 0}%`,
                        background: accent,
                        borderRadius: 99,
                        transition: 'width 300ms',
                      }}
                    />
                  </div>
                )}
                {item.status === 'success' && (
                  <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>
                    {isDownload ? 'Download complete' : 'Upload complete'}
                  </div>
                )}
                {item.status === 'error' && (
                  <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
                    {item.error || 'Transfer failed'}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
