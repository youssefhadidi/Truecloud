/** @format */

'use client';

import { useState } from 'react';
import { FiCheckSquare, FiZap } from 'react-icons/fi';
import Tabs from '@/components/ui/Tabs';
import SystemRequirementsCheck from '@/components/SystemRequirementsCheck';
import UpdateStatusClient from './UpdateStatusClient';

const TABS = [
  { key: 'updates', label: 'Server Updates', icon: FiZap },
  { key: 'requirements', label: 'Requirements', icon: FiCheckSquare },
];

export default function SystemHealthPage() {
  const [active, setActive] = useState('updates');

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6">System Health</h1>
      <Tabs tabs={TABS} active={active} onChange={setActive} />
      {active === 'requirements' && (
        <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
          <SystemRequirementsCheck />
        </div>
      )}
      {active === 'updates' && <UpdateStatusClient />}
    </>
  );
}
