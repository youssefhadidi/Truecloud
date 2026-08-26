/** @format */

'use client';

import { FiAlertTriangle, FiPower, FiLink, FiDownload } from 'react-icons/fi';
import { useTranslation } from '@/components/LanguageProvider';
import { buttonSecondary } from './ui';

/**
 * Pi-hole can be unavailable for four quite different reasons and the fix
 * differs each time, so they get distinct copy rather than one generic error.
 *
 * @param {object} status the payload from GET /api/admin/pihole
 * @param {() => void} [onOpenSettings]
 */
export default function NotConnected({ status, onOpenSettings }) {
  const { t } = useTranslation();

  const { kind, Icon, title, body, detail } = describe(status, t);

  return (
    <div className="bg-gray-800 rounded-lg p-6 sm:p-8 text-center max-w-2xl">
      <div className="inline-flex p-3 rounded-full bg-gray-700 text-gray-400 mb-4">
        <Icon size={24} />
      </div>
      <h2 className="text-lg font-semibold text-white mb-2">{title}</h2>
      <p className="text-sm text-gray-400 whitespace-pre-line">{body}</p>

      {detail && (
        <pre className="mt-4 text-left text-xs text-red-300 bg-red-900/20 border border-red-800/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
          {detail}
        </pre>
      )}

      {(kind === 'unconfigured' || kind === 'error') && onOpenSettings && (
        <button type="button" onClick={onOpenSettings} className={`${buttonSecondary} mt-5`}>
          {t('adminPihole.goToSettings')}
        </button>
      )}
    </div>
  );
}

function describe(status, t) {
  if (!status?.installed) {
    return {
      kind: 'missing',
      Icon: FiDownload,
      title: t('adminPihole.notInstalledTitle'),
      body: t('adminPihole.notInstalledBody'),
    };
  }

  if (!status.service?.active) {
    return {
      kind: 'stopped',
      Icon: FiPower,
      title: t('adminPihole.serviceStoppedTitle'),
      body: t('adminPihole.serviceStoppedBody'),
    };
  }

  if (!status.connection?.hasPassword && status.connection?.error) {
    return {
      kind: 'unconfigured',
      Icon: FiLink,
      title: t('adminPihole.notConfiguredTitle'),
      body: t('adminPihole.notConfiguredBody'),
      detail: status.connection.error,
    };
  }

  return {
    kind: 'error',
    Icon: FiAlertTriangle,
    title: t('adminPihole.connectionErrorTitle'),
    body: t('adminPihole.notConfiguredBody'),
    detail: status?.connection?.error,
  };
}
