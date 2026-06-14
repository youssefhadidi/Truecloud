/** @format */

'use client';

import Btn from '@/components/ui/Btn';
import { useTranslation } from '@/components/LanguageProvider';

export default function Confirm({ message, onCancel, onConfirm, isLoading = false }) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        padding: 12,
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <p style={{ fontSize: 13, color: 'var(--text)', margin: 0 }}>{message}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <Btn variant="ghost" size="sm" onClick={onCancel} disabled={isLoading}>{t('common.cancel')}</Btn>
        <Btn variant="primary" size="sm" onClick={onConfirm} disabled={isLoading}>
          {isLoading ? t('common.loading') : t('common.confirm')}
        </Btn>
      </div>
    </div>
  );
}
