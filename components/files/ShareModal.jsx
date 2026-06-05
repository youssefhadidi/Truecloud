/** @format */

'use client';

import { useState, useEffect } from 'react';
import {
  FiCopy, FiLock, FiCheck, FiTrash2, FiX, FiLink, FiShare2, FiUpload,
} from 'react-icons/fi';
import { useCreateShare, useDeleteShare, useFileShare } from '@/lib/api/files';
import { useNotifications } from '@/contexts/NotificationsContext';
import Overlay from '@/components/ui/Overlay';
import Btn from '@/components/ui/Btn';
import IconBtn from '@/components/ui/IconBtn';
import Field from '@/components/ui/Field';
import Toggle from '@/components/ui/Toggle';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';

const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: '1h',    label: '1h' },
  { value: '24h',   label: '24h' },
  { value: '7d',    label: '7d' },
  { value: '30d',   label: '30d' },
];

function calculateExpiry(option) {
  if (option === 'never') return null;
  const now = new Date();
  switch (option) {
    case '1h':  return new Date(now.getTime() + 60 * 60 * 1000);
    case '24h': return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case '7d':  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case '30d': return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    default:    return null;
  }
}

export default function ShareModal({ file, currentPath, onClose }) {
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [expiresIn, setExpiresIn] = useState('never');
  const [allowEditing, setAllowEditing] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const { addNotification } = useNotifications();
  const createShareMutation = useCreateShare();
  const deleteShareMutation = useDeleteShare();
  const { data: existingShare, isLoading: checkingShare } = useFileShare(currentPath, file?.name);

  useEffect(() => {
    if (existingShare) {
      const baseUrl = window.location.origin;
      setShareUrl(`${baseUrl}/s/${existingShare.token}`);
    }
  }, [existingShare]);

  const createShare = async () => {
    setLoading(true);
    try {
      const result = await createShareMutation.mutateAsync({
        path: currentPath,
        fileName: file.name,
        isDirectory: file.isDirectory,
        password: usePassword ? password : null,
        expiresAt: calculateExpiry(expiresIn),
        allowEditing: file.isDirectory ? allowEditing : false,
      });
      setShareUrl(result.shareUrl);
      addNotification('success', 'Share created successfully');
    } catch {
      addNotification('error', 'Failed to create share');
    } finally {
      setLoading(false);
    }
  };

  const deleteShare = async () => {
    if (!existingShare) return;
    if (!confirm('Are you sure you want to delete this share?')) return;
    try {
      await deleteShareMutation.mutateAsync(existingShare.id);
      setShareUrl(null);
      addNotification('success', 'Share deleted');
      onClose();
    } catch {
      addNotification('error', 'Failed to delete share');
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      addNotification('success', 'Link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addNotification('error', 'Failed to copy link');
    }
  };

  if (!file) return null;

  return (
    <Overlay onClose={onClose}>
      <div
        className="tc-anim-scale"
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-xl)',
          width: 460,
          maxWidth: '95vw',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--r-md)',
                background: 'var(--success-light)',
                color: 'var(--success)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <FiShare2 size={16} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>
                Share {file.isDirectory ? 'Folder' : 'File'}
              </div>
              <div className="tc-truncate" style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                {file.name}
              </div>
            </div>
          </div>
          <IconBtn icon={FiX} onClick={onClose} title="Close" />
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {checkingShare ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <Spinner size={24} color="var(--accent)" borderColor="var(--border)" thickness={3} />
            </div>
          ) : shareUrl || existingShare ? (
            <>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
                  SHARE LINK
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div
                    style={{
                      flex: 1,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-sm)',
                      padding: '8px 12px',
                      fontSize: 12,
                      color: 'var(--text-2)',
                      fontFamily: 'monospace',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {shareUrl}
                  </div>
                  <Btn variant={copied ? 'surface' : 'primary'} size="sm" onClick={copyLink}>
                    {copied ? <FiCheck size={13} /> : <FiCopy size={13} />}
                    {copied ? 'Copied' : 'Copy'}
                  </Btn>
                </div>
              </div>

              {existingShare && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {existingShare.passwordHash ? (
                        <>
                          <FiLock size={13} color="var(--success)" />
                          Password protected
                        </>
                      ) : (
                        <>
                          <FiLink size={13} />
                          Anyone with the link
                        </>
                      )}
                    </span>
                    <Badge color="accent">{existingShare.accessCount} views</Badge>
                  </div>
                  {existingShare.allowEditing && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)' }}>
                      <FiUpload size={13} />
                      Editing enabled
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Password protection */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FiLock size={14} color="var(--text-2)" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Password protection</span>
                </div>
                <Toggle value={usePassword} onChange={setUsePassword} />
              </div>
              {usePassword && (
                <Field
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Enter password"
                  autoComplete="new-password"
                />
              )}

              {/* Expiration */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
                  EXPIRES
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {EXPIRY_OPTIONS.map((o) => {
                    const active = expiresIn === o.value;
                    return (
                      <button
                        key={o.value}
                        onClick={() => setExpiresIn(o.value)}
                        style={{
                          flex: 1,
                          padding: '8px 0',
                          fontSize: 12,
                          fontWeight: 600,
                          borderRadius: 'var(--r-xs)',
                          border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                          background: active ? 'var(--accent-light)' : 'transparent',
                          color: active ? 'var(--accent)' : 'var(--text-2)',
                          cursor: 'pointer',
                          transition: 'all 150ms',
                          fontFamily: 'inherit',
                        }}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Allow editing (folders only) */}
              {file.isDirectory && (
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FiUpload size={14} color="var(--text-2)" />
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Allow editing</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                      Anyone with the link can upload, rename, move, and delete files in this folder.
                    </div>
                  </div>
                  <Toggle value={allowEditing} onChange={setAllowEditing} />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          {existingShare ? (
            <>
              <Btn variant="danger" size="sm" onClick={deleteShare}>
                <FiTrash2 size={13} />
                Delete Share
              </Btn>
              <Btn variant="outline" size="sm" onClick={onClose}>Close</Btn>
            </>
          ) : (
            <>
              <Btn variant="outline" size="sm" onClick={onClose}>Cancel</Btn>
              <Btn
                variant="primary"
                size="sm"
                onClick={createShare}
                disabled={loading || (usePassword && !password)}
              >
                {loading ? (
                  <>
                    <Spinner size={12} />
                    Creating…
                  </>
                ) : (
                  <>
                    <FiShare2 size={13} />
                    Create Share
                  </>
                )}
              </Btn>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}
