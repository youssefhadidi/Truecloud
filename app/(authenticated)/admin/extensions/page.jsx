/** @format */

'use client';

import { useState } from 'react';
import { FiPackage, FiSliders } from 'react-icons/fi';
import Tabs from '@/components/ui/Tabs';
import ModulesPanel from './ModulesPanel';
import FeaturesPanel from './FeaturesPanel';
import { useTranslation } from '@/components/LanguageProvider';

export default function ExtensionsPage() {
  const { t } = useTranslation();
  const [active, setActive] = useState('modules');

  const TABS = [
    { key: 'modules', label: t('adminExtensions.tabModules'), icon: FiPackage },
    { key: 'features', label: t('adminExtensions.tabFeatures'), icon: FiSliders },
  ];

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6">{t('adminExtensions.title')}</h1>
      <Tabs tabs={TABS} active={active} onChange={setActive} />
      {active === 'modules' && <ModulesPanel />}
      {active === 'features' && <FeaturesPanel />}
    </>
  );
}
