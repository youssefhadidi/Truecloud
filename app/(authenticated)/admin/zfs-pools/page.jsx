/** @format */

'use client';

import { useState } from 'react';
import { FiPlus, FiX, FiChevronDown, FiChevronUp, FiAlertCircle, FiZap } from 'react-icons/fi';
import { useZfsPools, useZfsPoolDetail, useAvailableDisks, useCreateZfsPool, useAddCacheDevice } from '@/lib/api/zfsPools';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTranslation } from '@/components/LanguageProvider';

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

function PoolCard({ pool, isSelected, onSelect, onAddCache }) {
  const { t } = useTranslation();
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
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getHealthColor(pool.health)}`}>
            {pool.health}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onAddCache(pool); }}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-gray-200 rounded transition-colors"
            title={t('adminZfs.addCacheTitle')}
          >
            <FiZap size={11} />
            {t('adminZfs.addCache')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-gray-400 text-xs">{t('adminZfs.total')}</p>
          <p className="text-white font-medium">{pool.size}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">{t('adminZfs.used')}</p>
          <p className="text-white font-medium">{pool.alloc}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">{t('adminZfs.free')}</p>
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
  const { t } = useTranslation();
  if (!datasets || datasets.length === 0) {
    return <div className="text-gray-400 text-sm p-4">{t('adminZfs.noDatasets')}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-700 border-b border-gray-600">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-300">{t('adminZfs.colName')}</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-300">{t('adminZfs.colType')}</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-300">{t('adminZfs.colUsed')}</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-300">{t('adminZfs.colAvailable')}</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-300">{t('adminZfs.colMountpoint')}</th>
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
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [selectedPool, setSelectedPool] = useState(null);
  const [expandedDatasets, setExpandedDatasets] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    vdevType: 'stripe',
    devices: [],
  });
  const [forceConfirm, setForceConfirm] = useState(null); // holds pending payload when existing filesystem detected
  const [addCacheTarget, setAddCacheTarget] = useState(null); // pool to add cache to
  const [selectedCacheDisk, setSelectedCacheDisk] = useState('');

  const { addNotification } = useNotifications();

  // React Query hooks
  const { data: pools = [], isLoading: loadingPools } = useZfsPools(true);
  const { data: poolDetail, isLoading: loadingDetail } = useZfsPoolDetail(selectedPool?.name, !!selectedPool);
  const { data: disks = [], isLoading: loadingDisks } = useAvailableDisks(showForm || !!addCacheTarget);
  const createPoolMutation = useCreateZfsPool();
  const addCacheMutation = useAddCacheDevice();

  const handleAddCache = async () => {
    if (!addCacheTarget || !selectedCacheDisk) return;
    try {
      await addCacheMutation.mutateAsync({ poolName: addCacheTarget.name, device: selectedCacheDisk });
      addNotification('success', t('adminZfs.cacheAdded', { device: selectedCacheDisk, pool: addCacheTarget.name }));
      setAddCacheTarget(null);
      setSelectedCacheDisk('');
    } catch (error) {
      addNotification('error', error.response?.data?.error || t('adminZfs.addCacheFailed'));
    }
  };

  const handleCreatePool = async (e) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      addNotification('error', t('adminZfs.poolNameRequired'));
      return;
    }

    if (formData.devices.length === 0) {
      addNotification('error', t('adminZfs.deviceRequired'));
      return;
    }

    try {
      await createPoolMutation.mutateAsync({
        name: formData.name,
        vdevType: formData.vdevType,
        devices: formData.devices,
      });
      setShowForm(false);
      setFormData({ name: '', vdevType: 'stripe', devices: [] });
      addNotification('success', t('adminZfs.poolCreated', { name: formData.name }));
    } catch (error) {
      if (error.response?.status === 409 && error.response?.data?.code === 'EXISTING_FILESYSTEM') {
        setForceConfirm({ name: formData.name, vdevType: formData.vdevType, devices: formData.devices });
        return;
      }
      console.error('Error creating pool:', error);
      addNotification('error', error.response?.data?.error || t('adminZfs.poolCreateFailed'));
    }
  };

  const handleForceCreate = async () => {
    if (!forceConfirm) return;
    try {
      await createPoolMutation.mutateAsync({ ...forceConfirm, force: true });
      setForceConfirm(null);
      setShowForm(false);
      setFormData({ name: '', vdevType: 'stripe', devices: [] });
      addNotification('success', t('adminZfs.poolCreated', { name: forceConfirm.name }));
    } catch (error) {
      console.error('Error force creating pool:', error);
      addNotification('error', error.response?.data?.error || t('adminZfs.poolCreateFailed'));
      setForceConfirm(null);
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
        <div className="text-gray-400">{t('adminZfs.loading')}</div>
      </div>
    );
  }

  return (
    <>
      {/* Add Cache modal */}
      {addCacheTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <FiZap className="text-yellow-400" />
                {t('adminZfs.addCacheDevice')}
              </h3>
              <button onClick={() => { setAddCacheTarget(null); setSelectedCacheDisk(''); }} className="text-gray-400 hover:text-gray-300">
                <FiX size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              {t('adminZfs.addCacheBodyPrefix')}<span className="text-white font-mono">{addCacheTarget.name}</span>{t('adminZfs.addCacheBodySuffix')}
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">{t('adminZfs.selectCacheDevice')}</label>
              {loadingDisks ? (
                <div className="text-gray-400 text-xs">{t('adminZfs.loadingDisks')}</div>
              ) : disks.length === 0 ? (
                <div className="text-gray-400 text-xs p-3 bg-gray-700 rounded">
                  {t('adminZfs.noDisks')}
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {disks.map((disk) => (
                    <label key={disk.name} className="flex items-start gap-2 p-2 rounded hover:bg-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="cacheDisk"
                        value={disk.name}
                        checked={selectedCacheDisk === disk.name}
                        onChange={() => setSelectedCacheDisk(disk.name)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-mono">{disk.name}</p>
                        <p className="text-xs text-gray-400">{disk.size}{disk.model && ` (${disk.model})`}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setAddCacheTarget(null); setSelectedCacheDisk(''); }}
                className="flex-1 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
              >
                {t('adminZfs.cancel')}
              </button>
              <button
                onClick={handleAddCache}
                disabled={!selectedCacheDisk || addCacheMutation.isPending}
                className="flex-1 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {addCacheMutation.isPending ? t('adminZfs.adding') : t('adminZfs.addCache')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Force confirmation dialog */}
      {forceConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-red-700 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-red-400 mb-2">{t('adminZfs.existingFsTitle')}</h3>
            <p className="text-gray-300 text-sm mb-4">
              {t('adminZfs.existingFsBodyPrefix')}<span className="text-red-400 font-semibold">{t('adminZfs.existingFsBodyStrong')}</span>{t('adminZfs.existingFsBodySuffix')}
            </p>
            <p className="text-gray-400 text-sm mb-6">{t('adminZfs.areYouSure')}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setForceConfirm(null)}
                className="flex-1 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
              >
                {t('adminZfs.cancel')}
              </button>
              <button
                onClick={handleForceCreate}
                disabled={createPoolMutation.isPending}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
              >
                {createPoolMutation.isPending ? t('adminZfs.creating') : t('adminZfs.overwriteAndCreate')}
              </button>
            </div>
          </div>
        </div>
      )}
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-4 sm:mb-6 lg:mb-8">{t('adminZfs.title')}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2">
          {/* Pools List */}
          <div className="bg-gray-800 rounded-lg shadow mb-4">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
              <h2 className="text-base sm:text-lg font-semibold text-white">{t('adminZfs.poolsN', { count: pools.length })}</h2>
            </div>

            <div className="p-4 sm:p-6 space-y-3">
              {pools.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  <FiAlertCircle className="mx-auto mb-2 text-gray-500" size={32} />
                  <p>{t('adminZfs.noPools')}</p>
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
                    onAddCache={(p) => { setAddCacheTarget(p); setSelectedCacheDisk(''); }}
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
                  <h2 className="text-base sm:text-lg font-semibold text-white">{t('adminZfs.datasets')}</h2>
                  {expandedDatasets ? <FiChevronUp /> : <FiChevronDown />}
                </div>
              </div>

              {expandedDatasets && (
                <div className="px-4 sm:px-6 py-4">
                  {loadingDetail ? (
                    <div className="text-gray-400 text-sm">{t('adminZfs.loadingDatasets')}</div>
                  ) : (
                    <>
                      {poolDetail?.status && (
                        <div className="mb-4">
                          <h3 className="text-sm font-semibold text-gray-300 mb-2">{t('adminZfs.poolStatus')}</h3>
                          <pre className="bg-gray-700 p-3 rounded text-xs text-gray-300 overflow-auto max-h-48 font-mono">
                            {poolDetail.status}
                          </pre>
                        </div>
                      )}
                      <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('adminZfs.datasets')}</h3>
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
              <h2 className="text-base sm:text-lg font-semibold text-white">{t('adminZfs.createPool')}</h2>
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
                {t('adminZfs.createPool')}
              </button>
            ) : (
              <form onSubmit={handleCreatePool} className="space-y-3 sm:space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminZfs.poolName')}</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400"
                    placeholder={t('adminZfs.poolNamePlaceholder')}
                    required
                  />
                  <p className="text-xs text-gray-400 mt-1">{t('adminZfs.poolNameHint')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminZfs.vdevType')}</label>
                  <select
                    value={formData.vdevType}
                    onChange={(e) => setFormData({ ...formData, vdevType: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
                  >
                    <option value="stripe">{t('adminZfs.vdevStripe')}</option>
                    <option value="mirror">{t('adminZfs.vdevMirror')}</option>
                    <option value="raidz">{t('adminZfs.vdevRaidz')}</option>
                    <option value="raidz2">{t('adminZfs.vdevRaidz2')}</option>
                  </select>
                  <p className="text-xs text-gray-400 mt-1">{t('adminZfs.vdevHint')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('adminZfs.selectDevices')}</label>
                  {loadingDisks ? (
                    <div className="text-gray-400 text-xs">{t('adminZfs.loadingDisks')}</div>
                  ) : disks.length === 0 ? (
                    <div className="text-gray-400 text-xs p-3 bg-gray-700 rounded">
                      {t('adminZfs.noDisks')}
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
                  {createPoolMutation.isPending ? t('adminZfs.creating') : t('adminZfs.createPool')}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
