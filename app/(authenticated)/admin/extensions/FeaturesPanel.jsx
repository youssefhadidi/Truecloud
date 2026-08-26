/** @format */

'use client';

import { useState, useEffect } from 'react';
import { FiDatabase, FiShare2, FiRefreshCw, FiCpu, FiServer, FiMessageSquare, FiFilter } from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useComponentsConfig, useSaveComponentsConfig } from '@/lib/api/system';
import { useTranslation } from '@/components/LanguageProvider';

const COMPONENT_DEFS = [
  { key: 'zfs', labelKey: 'adminExtensions.zfsLabel', descKey: 'adminExtensions.zfsDesc', icon: FiDatabase },
  { key: 'smb', labelKey: 'adminExtensions.smbLabel', descKey: 'adminExtensions.smbDesc', icon: FiShare2 },
  { key: 'transcoding', labelKey: 'adminExtensions.transcodingLabel', descKey: 'adminExtensions.transcodingDesc', icon: FiCpu },
  { key: 'minecraft', labelKey: 'adminExtensions.minecraftLabel', descKey: 'adminExtensions.minecraftDesc', icon: FiServer },
  { key: 'aiChat', labelKey: 'adminExtensions.aiChatLabel', descKey: 'adminExtensions.aiChatDesc', icon: FiMessageSquare },
  { key: 'pihole', labelKey: 'adminExtensions.piholeLabel', descKey: 'adminExtensions.piholeDesc', icon: FiFilter },
];

export default function FeaturesPanel() {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const { data, isLoading, refetch } = useComponentsConfig();
  const saveMutation = useSaveComponentsConfig();

  const [settings, setSettings] = useState({ zfs: true, smb: true, transcoding: false, minecraft: false, aiChat: false, pihole: false });

  useEffect(() => {
    if (data?.config) {
      setSettings(data.config);
    }
  }, [data?.config]);

  const handleToggle = (key) => {
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    saveMutation.mutate(updated, {
      onSuccess: () => {
        const label = t(COMPONENT_DEFS.find((c) => c.key === key)?.labelKey);
        addNotification('success', updated[key]
          ? t('adminExtensions.componentEnabled', { label })
          : t('adminExtensions.componentDisabled', { label }));
      },
      onError: () => {
        // Revert on error
        setSettings(settings);
        addNotification('error', t('adminExtensions.saveComponentsFailed'));
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">{t('adminExtensions.loading')}</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">{t('adminExtensions.components')}</h1>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50"
        >
          <FiRefreshCw className={isLoading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{t('adminExtensions.refresh')}</span>
        </button>
      </div>

      <p className="text-gray-400 text-sm mb-6">
        {t('adminExtensions.componentsIntro')}
      </p>

      <div className="bg-gray-800 rounded-lg divide-y divide-gray-700">
        {COMPONENT_DEFS.map(({ key, labelKey, descKey, icon: Icon }) => {
          const enabled = settings[key];
          const label = t(labelKey);
          return (
            <div key={key} className="flex items-center justify-between p-5">
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-lg ${enabled ? 'bg-blue-600/20 text-blue-400' : 'bg-gray-700 text-gray-500'}`}>
                  <Icon size={22} />
                </div>
                <div>
                  <p className={`font-medium ${enabled ? 'text-white' : 'text-gray-400'}`}>{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t(descKey)}</p>
                </div>
              </div>

              <button
                role="switch"
                aria-checked={enabled}
                aria-label={t('adminExtensions.toggleAria', { label })}
                onClick={() => handleToggle(key)}
                disabled={saveMutation.isPending}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 ${
                  enabled ? 'bg-blue-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                    enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
