/** @format */

'use client';

import { useState } from 'react';
import { FiActivity, FiFileText } from 'react-icons/fi';
import Tabs from '@/components/ui/Tabs';
import LogViewer from '@/components/LogViewer';
import JobsPanel from './JobsPanel';
import { useTranslation } from '@/components/LanguageProvider';

export default function ActivityPage() {
  const { t } = useTranslation();
  const [active, setActive] = useState('jobs');

  const TABS = [
    { key: 'jobs', label: t('extra.activity.tabJobs'), icon: FiActivity },
    { key: 'logs', label: t('extra.activity.tabLogs'), icon: FiFileText },
  ];

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6">{t('extra.activity.title')}</h1>
      <Tabs tabs={TABS} active={active} onChange={setActive} />
      {active === 'jobs' && <JobsPanel />}
      {active === 'logs' && <LogViewer />}
    </>
  );
}
