/** @format */

'use client';

import { FiShare2 } from 'react-icons/fi';

export default function SmbPage() {
  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <FiShare2 size={28} className="text-blue-400" />
        <h1 className="text-2xl lg:text-3xl font-bold text-white">SMB Shares</h1>
      </div>

      <div className="bg-gray-800 rounded-lg p-6 text-gray-400">
        <p>SMB share management is coming soon.</p>
      </div>
    </div>
  );
}
