/** @format */

'use client';

import LogViewer from '@/components/LogViewer';

export default function LogsPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-white mb-8">System Logs</h1>
      <div>
        <LogViewer />
      </div>
    </div>
  );
}
