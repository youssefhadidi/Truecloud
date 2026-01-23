/** @format */

'use client';

import SystemRequirementsCheck from '@/components/SystemRequirementsCheck';

export default function RequirementsPage() {
  return (
    <>
      <h1 className="text-3xl font-bold text-white mb-8">System Requirements</h1>
      <div className="bg-gray-800 rounded-lg shadow p-6">
        <SystemRequirementsCheck />
      </div>
    </>
  );
}
