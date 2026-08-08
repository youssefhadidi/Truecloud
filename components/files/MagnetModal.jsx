/** @format */

'use client';

import { useEffect, useState } from 'react';
import { FiX, FiClipboard, FiDownload } from 'react-icons/fi';
import Overlay from '@/components/ui/Overlay';
import IconBtn from '@/components/ui/IconBtn';
import Btn from '@/components/ui/Btn';
import Field from '@/components/ui/Field';
import { useStartDownload } from '@/lib/api/downloads';
import { useTranslation } from '@/components/LanguageProvider';

const INPUT_ID = 'magnet-modal-input';

export default function MagnetModal({ open, currentPath = '', onClose, onAdded }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const startDownload = useStartDownload();

  useEffect(() => {
    if (!open) return;
    setValue('');
    setError('');
  }, [open]);

  // The clipboard API is unavailable outside a secure context (plain-HTTP LAN
  // access) and readText() rejects when permission is denied, so fall back to
  // telling the user to paste manually rather than failing silently.
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (!text) throw new Error('empty');
      setValue(text.trim());
      setError('');
    } catch {
      setError(t('magnetModal.pasteUnavailable'));
      document.getElementById(INPUT_ID)?.focus();
    }
  };

  const handleSubmit = async () => {
    const magnet = value.trim();
    if (!magnet) return;
    if (!magnet.startsWith('magnet:')) {
      setError(t('magnetModal.invalidMagnet'));
      return;
    }

    setError('');
    try {
      const formData = new FormData();
      formData.append('url', magnet);
      // Pass currentPath verbatim: the API echoes it back and the file list
      // merges live downloads by exact path match (hooks/useFilesPage.js).
      formData.append('path', currentPath);

      const data = await startDownload.mutateAsync(formData);
      onAdded?.(data);
      setValue('');
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('magnetModal.failed'));
    }
  };

  if (!open) return null;

  return (
    <Overlay onClose={onClose}>
      <div
        className="tc-anim-scale"
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-xl)',
          width: 520,
          maxWidth: '95vw',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            {t('magnetModal.title')}
          </h3>
          <IconBtn icon={FiX} onClick={onClose} title={t('common.close')} />
        </div>

        <div style={{ padding: '16px 20px' }}>
          <Field
            id={INPUT_ID}
            label={t('magnetModal.label')}
            value={value}
            onChange={(v) => {
              setValue(v);
              if (error) setError('');
            }}
            placeholder="magnet:?xt=urn:btih:…"
            autoFocus
            disabled={startDownload.isPending}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />

          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '8px 0 0' }}>
            {t('magnetModal.downloadingTo')}{' '}
            <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>
              {currentPath || t('moveModal.root')}
            </span>
          </p>

          {error && (
            <p style={{ fontSize: 12, color: 'var(--danger)', margin: '10px 0 0' }}>{error}</p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <Btn variant="surface" size="sm" onClick={handlePaste} disabled={startDownload.isPending}>
              <FiClipboard size={13} />
              {t('magnetModal.paste')}
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!value.trim() || startDownload.isPending}
            >
              <FiDownload size={13} />
              {startDownload.isPending ? t('magnetModal.adding') : t('magnetModal.add')}
            </Btn>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
