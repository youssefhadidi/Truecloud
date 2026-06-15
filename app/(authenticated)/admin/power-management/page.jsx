/** @format */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { FiCheck, FiX, FiAlertTriangle, FiInfo, FiSave, FiRefreshCw } from 'react-icons/fi';
import { usePowerManagement, useApplyPowerManagement } from '@/lib/api/powerManagement';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTranslation } from '@/components/LanguageProvider';

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function StatusPill({ ok, okLabel, badLabel }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full ${
        ok ? 'bg-green-900 text-green-200' : 'bg-gray-700 text-gray-300'
      }`}
    >
      {ok ? <FiCheck size={12} /> : <FiX size={12} />}
      {ok ? okLabel : badLabel}
    </span>
  );
}

function SectionCard({ title, children, footer }) {
  return (
    <div className="bg-gray-800 rounded-lg shadow">
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
        <h2 className="text-base sm:text-lg font-semibold text-white">{title}</h2>
      </div>
      <div className="p-4 sm:p-6 space-y-4">{children}</div>
      {footer && <div className="px-4 sm:px-6 py-3 border-t border-gray-700 flex justify-end">{footer}</div>}
    </div>
  );
}

export default function PowerManagementPage() {
  const { t } = useTranslation();
  const { data, isLoading, refetch, isFetching } = usePowerManagement();
  const applyMutation = useApplyPowerManagement();
  const { addNotification } = useNotifications();

  // Local editable state
  const [hdIdleEnabled, setHdIdleEnabled] = useState(false);
  const [defaultIdleMinutes, setDefaultIdleMinutes] = useState(10);
  const [overrides, setOverrides] = useState({}); // { sda: minutes, sdb: 0 (=never), ... }

  const [governorValue, setGovernorValue] = useState('');
  const [governorPersist, setGovernorPersist] = useState(true);

  const [powertopEnabled, setPowertopEnabled] = useState(false);

  // Hydrate local state from server
  useEffect(() => {
    if (!data) return;
    setHdIdleEnabled(!!data.hdIdle.enabledAtBoot || !!data.hdIdle.active);
    setDefaultIdleMinutes(Math.round((data.hdIdle.defaultIdleSeconds ?? 600) / 60));
    const ov = {};
    for (const o of data.hdIdle.overrides || []) {
      ov[o.device] = Math.round(o.idleSeconds / 60);
    }
    setOverrides(ov);
    if (data.governor.supported && data.governor.current && data.governor.current !== 'mixed') {
      setGovernorValue(data.governor.current);
    } else if (data.governor.supported && data.governor.available?.length) {
      setGovernorValue(data.governor.available[0]);
    }
    setGovernorPersist(!!data.governor.persistedAtBoot);
    setPowertopEnabled(!!data.powertop.enabledAtBoot);
  }, [data]);

  const rotationalDisks = useMemo(
    () => (data?.disks ?? []).filter((d) => d.rotational),
    [data],
  );
  const ssdDisks = useMemo(
    () => (data?.disks ?? []).filter((d) => d.rotational === false),
    [data],
  );

  const nonAtimeMounts = useMemo(
    () => (data?.mounts ?? []).filter((m) => !m.hasNoatime),
    [data],
  );

  const buildHdIdlePayload = () => {
    const overridesArr = Object.entries(overrides)
      .filter(([dev, mins]) => dev && Number.isFinite(Number(mins)))
      .map(([dev, mins]) => ({ device: dev, idleSeconds: Math.max(0, Math.round(Number(mins) * 60)) }));
    return {
      enabled: hdIdleEnabled,
      defaultIdleSeconds: Math.max(0, Math.round(defaultIdleMinutes * 60)),
      overrides: overridesArr,
    };
  };

  const applyHdIdle = async () => {
    try {
      const result = await applyMutation.mutateAsync({ hdIdle: buildHdIdlePayload() });
      if (result.errors?.length) throw new Error(result.errors[0].message);
      addNotification('success', t('adminPower.hdIdleApplied'));
    } catch (e) {
      addNotification('error', e.response?.data?.error || e.message || t('adminPower.hdIdleApplyFailed'));
    }
  };

  const applyGovernorSettings = async () => {
    try {
      const result = await applyMutation.mutateAsync({
        governor: { value: governorValue, persist: governorPersist },
      });
      if (result.errors?.length) throw new Error(result.errors[0].message);
      addNotification('success', t('adminPower.governorSet', { value: governorValue }));
    } catch (e) {
      addNotification('error', e.response?.data?.error || e.message || t('adminPower.governorSetFailed'));
    }
  };

  const applyPowertop = async () => {
    try {
      const result = await applyMutation.mutateAsync({ powertop: { enabled: powertopEnabled } });
      if (result.errors?.length) throw new Error(result.errors[0].message);
      addNotification('success', powertopEnabled ? t('adminPower.powertopEnabled') : t('adminPower.powertopDisabledMsg'));
    } catch (e) {
      addNotification('error', e.response?.data?.error || e.message || t('adminPower.powertopApplyFailed'));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">{t('adminPower.loading')}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-200">{t('adminPower.loadFailed')}</div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4 sm:mb-6 lg:mb-8 gap-2 flex-wrap">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">{t('adminPower.title')}</h1>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 disabled:opacity-50"
        >
          <FiRefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          {t('adminPower.refresh')}
        </button>
      </div>

      <p className="text-sm text-gray-400 mb-4 sm:mb-6">
        {t('adminPower.intro')}
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        {/* ---------------- HDD spindown ---------------- */}
        <SectionCard
          title={t('adminPower.hdIdleTitle')}
          footer={
            <button
              onClick={applyHdIdle}
              disabled={applyMutation.isPending || !data.hdIdle.installed}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600"
            >
              <FiSave size={14} />
              {applyMutation.isPending ? t('adminPower.applying') : t('adminPower.apply')}
            </button>
          }
        >
          {!data.hdIdle.installed ? (
            <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 text-sm text-yellow-200 flex items-start gap-2">
              <FiAlertTriangle className="mt-0.5 flex-shrink-0" />
              <span>
                <code className="bg-gray-900 px-1.5 py-0.5 rounded">hd-idle</code>{t('adminPower.notInstalledPrefix')}
                <strong>{t('adminPower.systemHealthRequirements')}</strong>{t('adminPower.notInstalledSuffix')}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <StatusPill ok={data.hdIdle.active} okLabel={t('adminPower.serviceActive')} badLabel={t('adminPower.serviceInactive')} />
              <StatusPill ok={data.hdIdle.enabledAtBoot} okLabel={t('adminPower.enabledAtBoot')} badLabel={t('adminPower.notAtBoot')} />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={hdIdleEnabled}
              onChange={(e) => setHdIdleEnabled(e.target.checked)}
              disabled={!data.hdIdle.installed}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>{t('adminPower.enableHdIdle')}</span>
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminPower.defaultIdle')}</label>
            <input
              type="number"
              min="0"
              max="1440"
              value={defaultIdleMinutes}
              onChange={(e) => setDefaultIdleMinutes(Math.max(0, Number(e.target.value) || 0))}
              disabled={!data.hdIdle.installed}
              className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white disabled:opacity-50"
            />
            <p className="text-xs text-gray-400 mt-1">{t('adminPower.defaultIdleHint')}</p>
          </div>

          {rotationalDisks.length > 0 && (
            <div>
              <div className="text-sm font-medium text-gray-300 mb-2">{rotationalDisks.length === 1 ? t('adminPower.perDiskOverrides', { count: rotationalDisks.length }) : t('adminPower.perDiskOverridesPlural', { count: rotationalDisks.length })}</div>
              <div className="space-y-2">
                {rotationalDisks.map((d) => (
                  <div key={d.name} className="flex items-center gap-3 p-2 bg-gray-900 rounded">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm text-white">/dev/{d.name}</div>
                      <div className="text-xs text-gray-400 truncate">{d.model || t('adminPower.unknown')} · {formatBytes(d.sizeBytes)}</div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="1440"
                      placeholder={t('adminPower.defaultPlaceholder')}
                      value={overrides[d.name] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setOverrides((prev) => {
                          const next = { ...prev };
                          if (v === '') delete next[d.name];
                          else next[d.name] = Math.max(0, Number(v) || 0);
                          return next;
                        });
                      }}
                      disabled={!data.hdIdle.installed}
                      className="w-24 px-2 py-1 text-sm border border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white disabled:opacity-50"
                    />
                    <span className="text-xs text-gray-400 w-8">{t('adminPower.min')}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">{t('adminPower.overridesHint')}</p>
            </div>
          )}

          {ssdDisks.length > 0 && (
            <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
              {t('adminPower.nonRotational', { list: ssdDisks.map((d) => `/dev/${d.name}`).join(', ') })}
            </div>
          )}
        </SectionCard>

        {/* ---------------- CPU governor ---------------- */}
        <SectionCard
          title={t('adminPower.governorTitle')}
          footer={
            <button
              onClick={applyGovernorSettings}
              disabled={applyMutation.isPending || !data.governor.supported || !governorValue}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600"
            >
              <FiSave size={14} />
              {applyMutation.isPending ? t('adminPower.applying') : t('adminPower.apply')}
            </button>
          }
        >
          {!data.governor.supported ? (
            <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 text-sm text-yellow-200 flex items-start gap-2">
              <FiAlertTriangle className="mt-0.5 flex-shrink-0" />
              <span>{t('adminPower.governorNotSupported')}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-400">{t('adminPower.current')}</span>
                <code className="text-sm bg-gray-900 px-2 py-1 rounded text-white">{data.governor.current ?? t('adminPower.unknownLower')}</code>
                <StatusPill ok={data.governor.persistedAtBoot} okLabel={t('adminPower.persistedAtBoot')} badLabel={t('adminPower.notPersisted')} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('adminPower.governor')}</label>
                <select
                  value={governorValue}
                  onChange={(e) => setGovernorValue(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
                >
                  {data.governor.available.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  {t('adminPower.governorHint').split(/\{(schedutil|ondemand|powersave|performance)\}/).map((part, i) =>
                    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
                  )}
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={governorPersist}
                  onChange={(e) => setGovernorPersist(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>{t('adminPower.persistGovernor')}</span>
              </label>
            </>
          )}
        </SectionCard>

        {/* ---------------- PowerTOP ---------------- */}
        <SectionCard
          title={t('adminPower.powertopTitle')}
          footer={
            <button
              onClick={applyPowertop}
              disabled={applyMutation.isPending || !data.powertop.installed}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600"
            >
              <FiSave size={14} />
              {applyMutation.isPending ? t('adminPower.applying') : t('adminPower.apply')}
            </button>
          }
        >
          {!data.powertop.installed ? (
            <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 text-sm text-yellow-200 flex items-start gap-2">
              <FiAlertTriangle className="mt-0.5 flex-shrink-0" />
              <span>
                <code className="bg-gray-900 px-1.5 py-0.5 rounded">powertop</code>{t('adminPower.notInstalledPrefix')}
                <strong>{t('adminPower.systemHealthRequirements')}</strong>{t('adminPower.notInstalledSuffix')}
              </span>
            </div>
          ) : (
            <StatusPill ok={data.powertop.enabledAtBoot} okLabel={t('adminPower.enabledAtBoot')} badLabel={t('adminPower.powertopDisabled')} />
          )}

          <p className="text-sm text-gray-400">
            {t('adminPower.powertopInfoPrefix')}<code className="bg-gray-900 px-1 rounded">powertop --auto-tune</code>{t('adminPower.powertopInfoSuffix')}
          </p>

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={powertopEnabled}
              onChange={(e) => setPowertopEnabled(e.target.checked)}
              disabled={!data.powertop.installed}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>{t('adminPower.enablePowertop')}</span>
          </label>
        </SectionCard>

        {/* ---------------- Mount audit ---------------- */}
        <SectionCard title={t('adminPower.mountAuditTitle')}>
          <p className="text-sm text-gray-400">
            {t('adminPower.mountAuditInfoPrefix')}<code className="bg-gray-900 px-1 rounded">noatime</code>{t('adminPower.mountAuditInfoMid')}<code className="bg-gray-900 px-1 rounded">/etc/fstab</code>{t('adminPower.mountAuditInfoSuffix')}
          </p>

          {nonAtimeMounts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-300">
              <FiCheck /> {t('adminPower.allNoatime')}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-yellow-300">
                <FiInfo /> {nonAtimeMounts.length === 1 ? t('adminPower.mountsMissingNoatime', { count: nonAtimeMounts.length }) : t('adminPower.mountsMissingNoatimePlural', { count: nonAtimeMounts.length })} <code>noatime</code>:
              </div>
              <div className="space-y-1">
                {nonAtimeMounts.map((m) => (
                  <div key={m.target} className="text-xs font-mono p-2 bg-gray-900 rounded text-gray-300">
                    <div className="text-white">{m.target}</div>
                    <div className="text-gray-500 truncate">{m.source} · {m.fstype} · {m.opts}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
