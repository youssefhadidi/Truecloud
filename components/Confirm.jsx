/** @format */

'use client';

/**
 * Reusable confirm dialog component that replaces the button/action it was triggered from
 * @param {string} message - The confirmation message to display
 * @param {function} onCancel - Callback when Cancel is clicked
 * @param {function} onConfirm - Callback when Confirm is clicked
 * @param {boolean} isLoading - Optional loading state for the confirm button
 */
export default function Confirm({ message, onCancel, onConfirm, isLoading = false }) {
  return (
    <div className="bg-white dark:bg-gray-700 rounded-lg p-3 text-sm space-y-2 border border-gray-200 dark:border-gray-600">
      <p className="text-gray-900 dark:text-white">{message}</p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="px-3 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button onClick={onConfirm} disabled={isLoading} className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 transition-colors">
          {isLoading ? 'Loading...' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
