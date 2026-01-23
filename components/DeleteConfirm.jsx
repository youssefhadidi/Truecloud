/** @format */

'use client';

/**
 * Custom confirm component for delete actions with warning details
 */
export default function DeleteConfirm({ username, onCancel, onConfirm, isLoading = false }) {
  return (
    <div className="bg-gray-800 rounded-lg shadow-lg max-w-md w-full">
      <div className="px-6 py-4 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">Delete User</h3>
      </div>
      <div className="px-6 py-4 space-y-3">
        <p className="text-gray-300">
          Are you sure you want to delete <strong>{username}</strong>?
        </p>
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
          <p className="font-semibold mb-1">This action will:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Permanently delete this user account</li>
            <li>Delete all files in their personal folder</li>
            <li>Remove all associated permissions and sessions</li>
          </ul>
        </div>
        <p className="text-xs text-gray-400">This action cannot be undone.</p>
      </div>
      <div className="px-6 py-4 border-t border-gray-700 flex gap-2">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="flex-1 px-4 py-2 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button onClick={onConfirm} disabled={isLoading} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-600 transition-colors">
          {isLoading ? 'Deleting...' : 'Delete User'}
        </button>
      </div>
    </div>
  );
}
