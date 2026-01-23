/** @format */

'use client';

import LogViewer from '@/components/LogViewer';

export default function LogsPage() {
  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6 lg:mb-8">System Logs</h1>
      <div>
        <LogViewer />
      </div>
    </>
  );
}
