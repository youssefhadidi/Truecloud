/** @format */

'use client';

import { useState } from 'react';
import { FiPackage, FiTrash2, FiRefreshCw, FiPlus, FiGitBranch, FiDatabase } from 'react-icons/fi';
import { useModules, useAddModule, useRemoveModule, useUpdateModule } from '@/lib/api/modules';
import { useNotifications } from '@/contexts/NotificationsContext';

export default function ModulesPage() {
  const { data: modules, isLoading } = useModules();
  const addModule = useAddModule();
  const removeModule = useRemoveModule();
  const updateModule = useUpdateModule();
  const { addNotification } = useNotifications();

  const [repository, setRepository] = useState('');
  const [deletingModule, setDeletingModule] = useState(null);
  const [deleteDatabase, setDeleteDatabase] = useState(false);

  const handleInstall = async (e) => {
    e.preventDefault();
    if (!repository.trim()) return;

    try {
      await addModule.mutateAsync(repository.trim());
      addNotification('success', 'Module installed successfully. Rebuild required.');
      setRepository('');
    } catch (err) {
      addNotification('error', err.response?.data?.error || 'Failed to install module');
    }
  };

  const handleRemove = async () => {
    if (!deletingModule) return;
    try {
      await removeModule.mutateAsync({ name: deletingModule, deleteDatabase });
      addNotification('success', `Module "${deletingModule}" removed. Rebuild required.`);
      setDeletingModule(null);
      setDeleteDatabase(false);
    } catch (err) {
      addNotification('error', err.response?.data?.error || 'Failed to remove module');
    }
  };

  const handleUpdate = async (name) => {
    try {
      await updateModule.mutateAsync(name);
      addNotification('success', `Module "${name}" updated. Rebuild required.`);
    } catch (err) {
      addNotification('error', err.response?.data?.error || 'Failed to update module');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <FiPackage size={24} />
          Modules
        </h2>
      </div>

      {/* Install Module Form */}
      <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Install Module</h3>
        <form onSubmit={handleInstall} className="flex gap-3">
          <div className="flex-1">
            <input
              type="text"
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              placeholder="Git repository URL (e.g. https://github.com/user/truecloud-module-example.git)"
              className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
              disabled={addModule.isPending}
            />
          </div>
          <button
            type="submit"
            disabled={addModule.isPending || !repository.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
          >
            {addModule.isPending ? (
              <>
                <FiRefreshCw className="animate-spin" size={16} />
                Installing...
              </>
            ) : (
              <>
                <FiPlus size={16} />
                Install
              </>
            )}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-2">
          A rebuild is required after installing or removing modules.
        </p>
      </div>

      {/* Module List */}
      <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Installed Modules</h3>

        {isLoading ? (
          <div className="text-gray-400 text-sm">Loading...</div>
        ) : !modules || modules.length === 0 ? (
          <div className="text-gray-400 text-sm py-8 text-center">
            No modules installed. Use the form above to install a module from a git repository.
          </div>
        ) : (
          <div className="space-y-3">
            {modules.map((mod) => (
              <div key={mod.name} className="bg-gray-700 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-white font-medium truncate">{mod.name}</h4>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-600 text-gray-300">
                      v{mod.version}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        mod.type === 'nextjs'
                          ? 'bg-blue-900/50 text-blue-300'
                          : 'bg-green-900/50 text-green-300'
                      }`}
                    >
                      {mod.type === 'nextjs' ? 'Next.js' : 'React'}
                    </span>
                  </div>
                  {mod.description && (
                    <p className="text-sm text-gray-400 mt-1 truncate">{mod.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1 truncate">
                      <FiGitBranch size={12} />
                      {mod.repository}
                    </span>
                    <span>
                      Installed {new Date(mod.installedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleUpdate(mod.name)}
                    disabled={updateModule.isPending}
                    className="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5 transition-colors"
                    title="Update to latest"
                  >
                    <FiRefreshCw size={14} className={updateModule.isPending ? 'animate-spin' : ''} />
                    Update
                  </button>
                  <button
                    onClick={() => setDeletingModule(mod.name)}
                    disabled={removeModule.isPending}
                    className="px-3 py-1.5 text-sm bg-red-600/20 hover:bg-red-600/40 disabled:opacity-50 text-red-400 rounded-lg flex items-center gap-1.5 transition-colors"
                    title="Remove module"
                  >
                    <FiTrash2 size={14} />
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deletingModule && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-white mb-2">Remove Module</h3>
            <p className="text-gray-300 text-sm mb-4">
              Are you sure you want to remove <strong>{deletingModule}</strong>? This will delete all module files. A rebuild will be required.
            </p>

            <label className="flex items-center gap-2 text-sm text-gray-300 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteDatabase}
                onChange={(e) => setDeleteDatabase(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
              />
              <FiDatabase size={14} />
              Also delete module database
            </label>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setDeletingModule(null);
                  setDeleteDatabase(false);
                }}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRemove}
                disabled={removeModule.isPending}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {removeModule.isPending ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
