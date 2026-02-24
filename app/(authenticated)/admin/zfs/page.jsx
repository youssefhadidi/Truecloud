/** @format */

'use client';

import { FiDatabase } from 'react-icons/fi';

export default function ZfsPage() {
  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <FiDatabase size={28} className="text-blue-400" />
        <h1 className="text-2xl lg:text-3xl font-bold text-white">ZFS Pool Management</h1>
      </div>

      <div className="bg-gray-800 rounded-lg p-6 text-gray-400">
        <p>ZFS pool management is coming soon.</p>
      </div>
    </div>
  );
}
