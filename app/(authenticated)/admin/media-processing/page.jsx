/** @format */

'use client';

import { useState } from 'react';
import { FiImage, FiFilm } from 'react-icons/fi';
import Tabs from '@/components/ui/Tabs';
import { useComponentsConfig } from '@/lib/api/system';
import ThumbnailsPanel from './ThumbnailsPanel';
import TranscodingPanel from './TranscodingPanel';

export default function MediaProcessingPage() {
  const { data: componentsData } = useComponentsConfig();
  const transcodingEnabled = componentsData?.config?.transcoding;

  const tabs = [
    { key: 'thumbnails', label: 'Thumbnails', icon: FiImage },
    ...(transcodingEnabled ? [{ key: 'transcoding', label: 'Transcoding', icon: FiFilm }] : []),
  ];

  const [active, setActive] = useState('thumbnails');

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6">Media Processing</h1>
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      {active === 'thumbnails' && <ThumbnailsPanel />}
      {active === 'transcoding' && transcodingEnabled && <TranscodingPanel />}
    </>
  );
}
