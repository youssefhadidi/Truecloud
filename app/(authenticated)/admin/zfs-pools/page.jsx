/** @format */

'use client';

import { useState } from 'react';
import { FiPlus, FiX, FiChevronDown, FiChevronUp, FiAlertCircle } from 'react-icons/fi';
import { useZfsPools, useZfsPoolDetail, useAvailableDisks, useCreateZfsPool } from '@/lib/api/zfsPools';
import { useNotifications } from '@/contexts/NotificationsContext';

function getHealthColor(health) {
  switch (health?.toUpperCase()) {
    case 'ONLINE':
      return 'bg-green-900 text-green-200';
    case 'DEGRADED':
      return 'bg-yellow-900 text-yellow-200';
    case 'FAULTED':
    case 'UNAVAIL':
      return 'bg-red-900 text-red-200';
    default:
      return 'bg-gray-700 text-gray-300';
  }
}

function PoolCard({ pool, isSelected, onSelect }) {
  return (
    <div
      className={`p-4 border rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'border-blue-500 bg-gray-700'
          : 'border-gray-700 bg-gray-800 hover:bg-gray-700'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">{pool.name}</h3>
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getHealthColor(pool.health)}`}>
          {pool.health}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-gray-400 text-xs">Total</p>
          <p className="text-white font-medium">{pool.size}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Used</p>
          <p className="text-white font-medium">{pool.alloc}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Free</p>
          <p className="text-white font-medium">{pool.free}</p>
        </div>
      </div>

      {/* Usage bar */}
      <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-600"
          style={{
            width: `${pool.sizeBytes > 0 ? (pool.allocBytes / pool.sizeBytes) * 100 : 0}%`,
          }}
        />
      </div>
    </div>
  );
}

function DatasetsList({ datasets }) {
  if (!datasets || datasets.length === 0) {
    return <div className="text-gray-400 text-sm p-4">No datasets found</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-700 border-b border-gray-600">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-300">Name</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-300">Type</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-300">Used</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-300">Available</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-300">Mountpoint</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {datasets.map((dataset) => (
            <tr key={dataset.name} className="hover:bg-gray-700">
              <td className="px-4 py-2 text-white">{dataset.name}</td>
              <td className="px-4 py-2 text-gray-300">{dataset.type}</td>
              <td className="px-4 py-2 text-gray-300">{dataset.used}</td>
              <td className="px-4 py-2 text-gray-300">{dataset.avail}</td>
              <td className="px-4 py-2 text-gray-300 font-mono text-xs">{dataset.mountpoint}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ZfsPoolsPage() {
  const [showForm, setShowForm] = useState(false);
  const [selectedPool, setSelectedPool] = useState(null);
  const [expandedDatasets, setExpandedDatasets] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    vdevType: 'stripe',
    devices: [],
  });

  const { addNotification } = useNotifications();

  // React Query hooks
  const { data: pools = [], isLoading: loadingPools } = useZfsPools(true);
  const { data: poolDetail, isLoading: loadingDetail } = useZfsPoolDetail(selectedPool?.name, !!selectedPool);
  const { data: disks = [], isLoading: loadingDisks } = useAvailableDisks(showForm);
  const createPoolMutation = useCreateZfsPool();

  const handleCreatePool = async (e) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      addNotification('error', 'Pool name is required');
      return;
    }

    if (formData.devices.length === 0) {
      addNotification('error', 'At least one device must be selected');
      return;
    }

    try {
      await createPoolMutation.mutateAsync({
        name: formData.name,
        vdevType: formData.vdevType,
        devices: formData.devices,
      });
      setShowForm(false);
      setFormData({
        name: '',
        vdevType: 'stripe',
        devices: [],
      });
      addNotification('success', `ZFS pool '${formData.name}' created successfully`);
    } catch (error) {
      console.error('Error creating pool:', error);
      addNotification('error', error.response?.data?.error || 'Failed to create ZFS pool');
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setFormData({
      name: '',
      vdevType: 'stripe',
      devices: [],
    });
  };

  const toggleDevice = (deviceName) => {
    setFormData((prev) => {
      const devices = [...prev.devices];
      const index = devices.indexOf(deviceName);
      if (index > -1) {
        devices.splice(index, 1);
      } else {
        devices.push(deviceName);
      }
      return { ...prev, devices };
    });
  };

  if (loadingPools) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading ZFS pools...</div>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6 lg:mb-8">ZFS Pools</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2">
          {/* Pools List */}
          <div className="bg-gray-800 rounded-lg shadow mb-4">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
              <h2 className="text-base sm:text-lg font-semibold text-white">Pools ({pools.length})</h2>
            </div>

            <div className="p-4 sm:p-6 space-y-3">
              {pools.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  <FiAlertCircle className="mx-auto mb-2 text-gray-500" size={32} />
                  <p>No ZFS pools found. Create one to get started.</p>
                </div>
              ) : (
                pools.map((pool) => (
                  <PoolCard
                    key={pool.name}
                    pool={pool}
                    isSelected={selectedPool?.name === pool.name}
                    onSelect={() => {
                      setSelectedPool(pool);
                      setExpandedDatasets(false);
                    }}
                  />
                ))
              )}
            </div>
          </div>

          {/* Pool Details - Datasets */}
          {selectedPool && (
            <div className="bg-gray-800 rounded-lg shadow">
              <div
                className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700 cursor-pointer hover:bg-gray-700 transition-colors"
                onClick={() => setExpandedDatasets(!expandedDatasets)}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-base sm:text-lg font-semibold text-white">Datasets</h2>
                  {expandedDatasets ? <FiChevronUp /> : <FiChevronDown />}
                </div>
              </div>

              {expandedDatasets && (
                <div className="px-4 sm:px-6 py-4">
                  {loadingDetail ? (
                    <div className="text-gray-400 text-sm">Loading datasets...</div>
                  ) : (
                    <>
                      {poolDetail?.status && (
                        <div className="mb-4">
                          <h3 className="text-sm font-semibold text-gray-300 mb-2">Pool Status</h3>
                          <pre className="bg-gray-700 p-3 rounded text-xs text-gray-300 overflow-auto max-h-48 font-mono">
                            {poolDetail.status}
                          </pre>
                        </div>
                      )}
                      <h3 className="text-sm font-semibold text-gray-300 mb-3">Datasets</h3>
                      <DatasetsList datasets={poolDetail?.datasets} />
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Create Pool Form */}
        <div className="lg:col-span-1">
          <div className="bg-gray-800 rounded-lg shadow p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base sm:text-lg font-semibold text-white">Create Pool</h2>
              {showForm && (
                <button onClick={closeForm} className="text-gray-400 hover:text-gray-300">
                  <FiX size={20} />
                </button>
              )}
            </div>

            {!showForm ? (
              <button
                onClick={() => setShowForm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm sm:text-base"
              >
                <FiPlus />
                Create Pool
              </button>
            ) : (
              <form onSubmit={handleCreatePool} className="space-y-3 sm:space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Pool Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    placeholder="e.g., tank"
                    required
                  />
                  <p className="text-xs text-gray-400 mt-1">Alphanumeric, hyphens, underscores only</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Virtual Device Type *</label>
                  <select
                    value={formData.vdevType}
                    onChange={(e) => setFormData({ ...formData, vdevType: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
                  >
                    <option value="stripe">Single Disk (Stripe)</option>
                    <option value="mirror">Mirror (2+ disks)</option>
                    <option value="raidz">RAID-Z (3+ disks)</option>
                    <option value="raidz2">RAID-Z2 (4+ disks)</option>
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Determines redundancy level</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Select Devices *</label>
                  {loadingDisks ? (
                    <div className="text-gray-400 text-xs">Loading available disks...</div>
                  ) : disks.length === 0 ? (
                    <div className="text-gray-400 text-xs p-3 bg-gray-700 rounded">
                      No available disks found. All devices may be in use.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {disks.map((disk) => (
                        <label key={disk.name} className="flex items-start gap-2 p-2 rounded hover:bg-gray-700">
                          <input
                            type="checkbox"
                            checked={formData.devices.includes(disk.name)}
                            onChange={() => toggleDevice(disk.name)}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white font-mono">{disk.name}</p>
                            <p className="text-xs text-gray-400">
                              {disk.size} {disk.model && `(${disk.model})`}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={createPoolMutation.isPending || formData.devices.length === 0}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {createPoolMutation.isPending ? 'Creating...' : 'Create Pool'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
