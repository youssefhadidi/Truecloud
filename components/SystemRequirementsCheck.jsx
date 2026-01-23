/** @format */

'use client';

import { useEffect, useState } from 'react';
import { FiCheck, FiX, FiDownload } from 'react-icons/fi';

export default function SystemRequirementsCheck() {
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(null);

  useEffect(() => {
    checkRequirements();
  }, []);

  const checkRequirements = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/system/check-requirements');
      if (response.ok) {
        const data = await response.json();
        setRequirements(data.requirements || []);
      }
    } catch (error) {
      console.error('Error checking requirements:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async (name) => {
    if (!window.confirm(`Install ${name}?`)) return;

    try {
      setInstalling(name);
      const response = await fetch('/api/system/install-requirement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (response.ok) {
        const data = await response.json();
        alert(data.message || `${name} installation started`);
        // Recheck requirements after a delay
        setTimeout(checkRequirements, 2000);
      } else {
        const error = await response.json();
        alert(error.message || `Failed to install ${name}`);
      }
    } catch (error) {
      alert(`Error installing ${name}: ${error.message}`);
    } finally {
      setInstalling(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  const installedCount = requirements.filter((r) => r.installed).length;
  const totalCount = requirements.length;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">System Requirements</h2>
        <p className="text-sm text-gray-600">
          {installedCount}/{totalCount} required programs installed
        </p>
      </div>

      {totalCount === 0 ? (
        <p className="text-sm text-gray-500">No system requirements found</p>
      ) : (
        <div className="space-y-3">
          {requirements.map((req) => (
            <div
              key={req.name}
              className={`flex items-center justify-between p-4 rounded-lg border ${req.installed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}
            >
              <div className="flex items-center gap-3">
                {req.installed ? <FiCheck className="text-green-600" size={20} /> : <FiX className="text-red-600" size={20} />}
                <div>
                  <p className={`font-medium ${req.installed ? 'text-green-900' : 'text-red-900'}`}>{req.name}</p>
                  {req.version && <p className={`text-sm ${req.installed ? 'text-green-700' : 'text-red-700'}`}>{req.version}</p>}
                  {req.description && <p className={`text-xs mt-1 ${req.installed ? 'text-green-600' : 'text-red-600'}`}>{req.description}</p>}
                </div>
              </div>

              {!req.installed && req.installable && (
                <button
                  onClick={() => handleInstall(req.name)}
                  disabled={installing === req.name}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    installing === req.name ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  <FiDownload size={16} />
                  {installing === req.name ? 'Installing...' : 'Install'}
                </button>
              )}

              {!req.installed && !req.installable && <p className="text-sm text-red-600 font-medium">Cannot auto-install</p>}
            </div>
          ))}
        </div>
      )}

      <button onClick={checkRequirements} className="mt-4 w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
        Refresh
      </button>
    </div>
  );
}
