/** @format */

'use client';

import Btn from '@/components/ui/Btn';
import { useTranslation } from '@/components/LanguageProvider';

export default function DeleteConfirm({ username, onCancel, onConfirm, isLoading = false }) {
  const { t } = useTranslation();
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
        <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{t('adminAccounts.deleteUser')}</h3>
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>
          {t('adminAccounts.deleteConfirmQuestion').split('{username}').flatMap((part, i) =>
            i === 0 ? [part] : [<strong key={i} style={{ color: 'var(--text)' }}>{username}</strong>, part],
          )}
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
          <p style={{ fontWeight: 700, margin: '0 0 4px' }}>{t('adminAccounts.deleteActionTitle')}</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>{t('adminAccounts.deleteAction1')}</li>
            <li>{t('adminAccounts.deleteAction2')}</li>
            <li>{t('adminAccounts.deleteAction3')}</li>
          </ul>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0 }}>{t('adminAccounts.deleteCannotUndo')}</p>
      </div>
      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <Btn variant="outline" size="md" onClick={onCancel} disabled={isLoading} style={{ flex: 1, justifyContent: 'center' }}>{t('adminAccounts.cancel')}</Btn>
        <Btn
          variant="danger"
          size="md"
          onClick={onConfirm}
          disabled={isLoading}
          style={{ flex: 1, justifyContent: 'center', background: 'var(--danger)', color: '#fff' }}
        >
          {isLoading ? t('adminAccounts.deleting') : t('adminAccounts.deleteUser')}
        </Btn>
      </div>
    </div>
  );
}
