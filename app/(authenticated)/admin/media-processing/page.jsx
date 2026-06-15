/** @format */

'use client';

import { useState } from 'react';
import { FiImage, FiFilm } from 'react-icons/fi';
import Tabs from '@/components/ui/Tabs';
import { useComponentsConfig } from '@/lib/api/system';
import ThumbnailsPanel from './ThumbnailsPanel';
import TranscodingPanel from './TranscodingPanel';
import { useTranslation } from '@/components/LanguageProvider';

export default function MediaProcessingPage() {
  const { t } = useTranslation();
  const { data: componentsData } = useComponentsConfig();
  const transcodingEnabled = componentsData?.config?.transcoding;

  const tabs = [
    { key: 'thumbnails', label: t('adminMedia.tabThumbnails'), icon: FiImage },
    ...(transcodingEnabled ? [{ key: 'transcoding', label: t('adminMedia.tabTranscoding'), icon: FiFilm }] : []),
  ];

  const [active, setActive] = useState('thumbnails');

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6">{t('adminMedia.title')}</h1>
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      {active === 'thumbnails' && <ThumbnailsPanel />}
      {active === 'transcoding' && transcodingEnabled && <TranscodingPanel />}
    </>
  );
}
