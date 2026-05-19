/** @format */

'use client';

import { useState } from 'react';
import { FiPackage, FiSliders } from 'react-icons/fi';
import Tabs from '@/components/ui/Tabs';
import ModulesPanel from './ModulesPanel';
import FeaturesPanel from './FeaturesPanel';

const TABS = [
  { key: 'modules', label: 'Modules', icon: FiPackage },
  { key: 'features', label: 'Features', icon: FiSliders },
];

export default function ExtensionsPage() {
  const [active, setActive] = useState('modules');

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6">Extensions</h1>
      <Tabs tabs={TABS} active={active} onChange={setActive} />
      {active === 'modules' && <ModulesPanel />}
      {active === 'features' && <FeaturesPanel />}
    </>
  );
}
