/** @format */

'use client';

import { useState } from 'react';
import { FiActivity, FiFileText } from 'react-icons/fi';
import Tabs from '@/components/ui/Tabs';
import LogViewer from '@/components/LogViewer';
import JobsPanel from './JobsPanel';

const TABS = [
  { key: 'jobs', label: 'Jobs', icon: FiActivity },
  { key: 'logs', label: 'Logs', icon: FiFileText },
];

export default function ActivityPage() {
  const [active, setActive] = useState('jobs');

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6">Activity</h1>
      <Tabs tabs={TABS} active={active} onChange={setActive} />
      {active === 'jobs' && <JobsPanel />}
      {active === 'logs' && <LogViewer />}
    </>
  );
}
