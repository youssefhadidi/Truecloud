/** @format */

'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { FiCopy, FiDownload, FiExternalLink, FiAlertTriangle } from 'react-icons/fi';
import { useTruecloudSync } from '@/lib/api/truecloudSync';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTranslation } from '@/components/LanguageProvider';

const EXPO_URL = 'exp://truecloudsync.mooo.com:8090';
const EXPO_GO_APP_STORE_URL = 'https://apps.apple.com/app/expo-go/id982107779';
const APK_DOWNLOAD_PATH = '/api/admin/truecloud-sync/apk';

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function SectionCard({ title, children }) {
  return (
    <div className="bg-gray-800 rounded-lg shadow">
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
        <h2 className="text-base sm:text-lg font-semibold text-white">{title}</h2>
      </div>
      <div className="p-4 sm:p-6 space-y-4">{children}</div>
    </div>
  );
}

function QrBox({ value }) {
  return (
    <div className="flex justify-center">
      <div className="bg-white p-3 rounded-lg">
        <QRCodeSVG value={value} size={192} />
      </div>
    </div>
  );
}

export default function TruecloudSyncPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useTruecloudSync();
  const { addNotification } = useNotifications();

  // The APK QR needs an absolute URL, which is only known in the browser.
  const [apkUrl, setApkUrl] = useState('');
  useEffect(() => {
    setApkUrl(new URL(APK_DOWNLOAD_PATH, window.location.origin).toString());
  }, []);

  const copyExpoLink = async () => {
    try {
      await navigator.clipboard.writeText(EXPO_URL);
      addNotification('success', t('adminSync.linkCopied'));
    } catch {
      addNotification('error', t('adminSync.copyFailed'));
    }
  };

  const apk = data?.apk;

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6 lg:mb-8">{t('adminSync.title')}</h1>

      <p className="text-sm text-gray-400 mb-4 sm:mb-6">{t('adminSync.intro')}</p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        {/* ---------------- iOS (Expo Go) ---------------- */}
        <SectionCard title={t('adminSync.iosTitle')}>
          <p className="text-sm text-gray-400">{t('adminSync.iosSteps')}</p>
          <QrBox value={EXPO_URL} />
          <div className="flex items-center gap-2 p-2 bg-gray-900 rounded">
            <code className="flex-1 min-w-0 truncate text-sm text-white">{EXPO_URL}</code>
            <button
              onClick={copyExpoLink}
              className="flex items-center gap-1.5 px-2 py-1 text-xs border border-gray-600 text-gray-300 rounded hover:bg-gray-700"
            >
              <FiCopy size={12} />
              {t('adminSync.copyLink')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={EXPO_URL} className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <FiExternalLink size={14} />
              {t('adminSync.openInExpoGo')}
            </a>
            <a
              href={EXPO_GO_APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700"
            >
              {t('adminSync.getExpoGo')}
            </a>
          </div>
        </SectionCard>

        {/* ---------------- Android (APK) ---------------- */}
        <SectionCard title={t('adminSync.androidTitle')}>
          {isLoading ? (
            <div className="text-sm text-gray-400">{t('adminSync.loading')}</div>
          ) : !apk ? (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-sm text-red-200">{t('adminSync.loadFailed')}</div>
          ) : !apk.available ? (
            <>
              <p className="text-sm text-gray-400">{t('adminSync.androidSteps')}</p>
              <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 text-sm text-yellow-200 flex items-start gap-2">
                <FiAlertTriangle className="mt-0.5 flex-shrink-0" />
                <span>{t('adminSync.apkFallback', { path: 'downloads/truecloudsync.apk' })}</span>
              </div>
              <QrBox value={apk.fallbackUrl} />
              <div className="flex justify-end">
                <a
                  href={apk.fallbackUrl}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <FiDownload size={14} />
                  {t('adminSync.downloadApkEas')}
                </a>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-400">
                {t('adminSync.androidSteps')} {t('adminSync.qrNeedsLogin')}
              </p>
              {apkUrl && <QrBox value={apkUrl} />}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs text-gray-400">
                  {t('adminSync.apkMeta', { size: formatBytes(apk.size), date: new Date(apk.updatedAt).toLocaleString() })}
                </span>
                <a
                  href={APK_DOWNLOAD_PATH}
                  download
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <FiDownload size={14} />
                  {t('adminSync.downloadApk')}
                </a>
              </div>
            </>
          )}
        </SectionCard>
      </div>
    </>
  );
}
