/** @format */

'use client';

import SystemRequirementsCheck from '@/components/SystemRequirementsCheck';

export default function RequirementsPage() {
  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6 lg:mb-8">System Requirements</h1>
      <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
        <SystemRequirementsCheck />
      </div>
    </>
  );
}
