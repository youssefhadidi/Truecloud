/** @format */

'use client';

export default function CreateFolderModal({ show, folderName, errorMessage, onFolderNameChange, onCreate, onClose }) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Create New Folder</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400">
            ✕
          </button>
        </div>
        <input
          type="text"
          value={folderName}
          onChange={(e) => onFolderNameChange(e.target.value)}
          placeholder="Folder name"
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-2"
          onKeyPress={(e) => e.key === 'Enter' && onCreate()}
          autoFocus
        />
        {errorMessage && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{errorMessage}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            Cancel
          </button>
          <button onClick={onCreate} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
