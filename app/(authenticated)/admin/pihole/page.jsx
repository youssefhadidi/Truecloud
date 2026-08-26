/** @format */

'use client';

import { useState } from 'react';
import { FiActivity, FiList, FiFileText, FiSettings, FiRefreshCw } from 'react-icons/fi';
import Tabs from '@/components/ui/Tabs';
import { useTranslation } from '@/components/LanguageProvider';
import { usePiholeStatus } from '@/lib/api/pihole';
import OverviewPanel from './OverviewPanel';
import ListsPanel from './ListsPanel';
import QueryLogPanel from './QueryLogPanel';
import SettingsPanel from './SettingsPanel';
import NotConnected from './NotConnected';
import InstallPanel from './InstallPanel';
import { buttonSecondary } from './ui';

export default function PiholePage() {
  const { t } = useTranslation();
  const [active, setActive] = useState('overview');
  const { data: status, isLoading, refetch, isFetching } = usePiholeStatus();

  const TABS = [
    { key: 'overview', label: t('adminPihole.tabOverview'), icon: FiActivity },
    { key: 'lists', label: t('adminPihole.tabLists'), icon: FiList },
    { key: 'queries', label: t('adminPihole.tabQueryLog'), icon: FiFileText },
    { key: 'settings', label: t('adminPihole.tabSettings'), icon: FiSettings },
  ];

  const connected = Boolean(status?.connection?.ok);

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">{t('adminPihole.title')}</h1>
        <button type="button" onClick={() => refetch()} disabled={isFetching} className={buttonSecondary}>
          <FiRefreshCw className={isFetching ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{t('adminPihole.refresh')}</span>
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-400">{t('adminPihole.loading')}</div>
      ) : !status?.installed ? (
        // Nothing to administer yet — the whole page is the guided installer.
        <InstallPanel />
      ) : (
        <>
          <Tabs tabs={TABS} active={active} onChange={setActive} />

          {/* Settings stays reachable while disconnected — it is where the fix lives. */}
          {!connected && active !== 'settings' ? (
            <NotConnected status={status} onOpenSettings={() => setActive('settings')} />
          ) : (
            <>
              {active === 'overview' && <OverviewPanel status={status} />}
              {active === 'lists' && <ListsPanel />}
              {active === 'queries' && <QueryLogPanel />}
              {active === 'settings' && <SettingsPanel status={status} />}
            </>
          )}
        </>
      )}
    </>
  );
}
