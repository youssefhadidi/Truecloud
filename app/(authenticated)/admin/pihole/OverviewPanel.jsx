/** @format */

'use client';

import { useEffect, useState } from 'react';
import { FiPause, FiPlay, FiRotateCw } from 'react-icons/fi';
import { useTranslation } from '@/components/LanguageProvider';
import { useNotifications } from '@/contexts/NotificationsContext';
import { usePiholeStats, useSetPiholeBlocking, useRestartPiholeDns } from '@/lib/api/pihole';
import {
  SectionCard,
  StatusPill,
  StatTile,
  BarRow,
  EmptyRow,
  formatNumber,
  formatPercent,
  formatDuration,
  errorMessage,
  buttonSecondary,
  buttonPrimary,
} from './ui';

const PAUSE_OPTIONS = [
  { value: 300, labelKey: 'adminPihole.timer5m' },
  { value: 1800, labelKey: 'adminPihole.timer30m' },
  { value: 0, labelKey: 'adminPihole.timerIndefinite' },
];

export default function OverviewPanel({ status }) {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const { data: stats, isLoading } = usePiholeStats();
  const setBlocking = useSetPiholeBlocking();
  const restartDns = useRestartPiholeDns();

  const [pauseSeconds, setPauseSeconds] = useState(300);

  const blockingActive = status?.blocking?.blocking === 'enabled';
  const remaining = useCountdown(status?.blocking?.timer);

  const summary = stats?.summary ?? status?.summary;
  const queries = summary?.queries ?? {};
  const gravity = summary?.gravity ?? {};
  const clients = summary?.clients ?? {};

  const toggleBlocking = async () => {
    const enabling = !blockingActive;
    try {
      await setBlocking.mutateAsync({
        enabled: enabling,
        // A timer only makes sense when pausing; "0" means until resumed.
        timer: enabling || pauseSeconds === 0 ? null : pauseSeconds,
      });
      addNotification('success', t('adminPihole.blockingUpdated'));
    } catch (e) {
      addNotification('error', errorMessage(e, t('adminPihole.blockingFailed')));
    }
  };

  const handleRestart = async () => {
    if (!window.confirm(t('adminPihole.restartDnsConfirm'))) return;
    try {
      await restartDns.mutateAsync();
      addNotification('success', t('adminPihole.restartDnsDone'));
    } catch (e) {
      addNotification('error', errorMessage(e, t('adminPihole.restartDnsFailed')));
    }
  };

  return (
    <div className="space-y-6">
      {/* Service + versions */}
      <SectionCard
        title={t('adminPihole.serviceLabel')}
        action={
          <button type="button" onClick={handleRestart} disabled={restartDns.isPending} className={buttonSecondary}>
            <FiRotateCw size={14} className={restartDns.isPending ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{t('adminPihole.restartDns')}</span>
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            ok={Boolean(status?.service?.active)}
            okLabel={t('adminPihole.serviceActive')}
            badLabel={t('adminPihole.serviceInactive')}
          />
          <StatusPill
            ok={Boolean(status?.service?.enabled)}
            okLabel={t('adminPihole.atBoot')}
            badLabel={t('adminPihole.notAtBoot')}
          />
          <VersionBadges version={status?.version} t={t} />
        </div>
      </SectionCard>

      {/* Blocking */}
      <SectionCard title={t('adminPihole.blockingTitle')}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${blockingActive ? 'bg-green-400' : 'bg-amber-400'}`}
              aria-hidden="true"
            />
            <span className="text-sm text-gray-200">
              {blockingActive
                ? t('adminPihole.blockingOn')
                : remaining
                  ? t('adminPihole.blockingOffTimer', { time: formatDuration(remaining) })
                  : t('adminPihole.blockingOff')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {blockingActive && (
              <>
                <label htmlFor="pihole-pause-for" className="text-xs text-gray-500 hidden sm:inline">
                  {t('adminPihole.pauseFor')}
                </label>
                <select
                  id="pihole-pause-for"
                  value={pauseSeconds}
                  onChange={(e) => setPauseSeconds(Number(e.target.value))}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PAUSE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button
              type="button"
              onClick={toggleBlocking}
              disabled={setBlocking.isPending}
              className={blockingActive ? buttonSecondary : buttonPrimary}
            >
              {blockingActive ? <FiPause size={14} /> : <FiPlay size={14} />}
              {blockingActive ? t('adminPihole.disableBlocking') : t('adminPihole.enableBlocking')}
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <StatTile label={t('adminPihole.statQueries')} value={formatNumber(queries.total)} />
        <StatTile label={t('adminPihole.statBlocked')} value={formatNumber(queries.blocked)} accent="text-red-300" />
        <StatTile label={t('adminPihole.statPercent')} value={formatPercent(queries.percent_blocked)} />
        <StatTile label={t('adminPihole.statDomains')} value={formatNumber(gravity.domains_being_blocked)} />
        <StatTile label={t('adminPihole.statClients')} value={formatNumber(clients.active)} />
      </div>

      {isLoading ? (
        <div className="text-gray-400">{t('adminPihole.loading')}</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <TopList
            title={t('adminPihole.topBlocked')}
            rows={(stats?.topBlocked?.domains ?? []).map((d) => ({ label: d.domain, value: d.count }))}
            emptyLabel={t('adminPihole.noData')}
          />
          <TopList
            title={t('adminPihole.topPermitted')}
            rows={(stats?.topPermitted?.domains ?? []).map((d) => ({ label: d.domain, value: d.count }))}
            emptyLabel={t('adminPihole.noData')}
          />
          <TopList
            title={t('adminPihole.topClients')}
            rows={(stats?.topClients?.clients ?? []).map((c) => ({
              label: c.name || c.ip,
              sublabel: c.name ? c.ip : null,
              value: c.count,
            }))}
            emptyLabel={t('adminPihole.noData')}
          />
          <TopList
            title={t('adminPihole.upstreamsTitle')}
            rows={(stats?.upstreams?.upstreams ?? []).map((u) => ({
              label: u.name || u.ip || t('adminPihole.unknown'),
              sublabel: u.port > 0 ? `${u.ip}#${u.port}` : null,
              value: u.count,
            }))}
            emptyLabel={t('adminPihole.noData')}
          />
          <TopList
            title={t('adminPihole.queryTypesTitle')}
            rows={Object.entries(stats?.queryTypes?.types ?? {})
              .filter(([, count]) => count > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => ({ label: type, value: count }))}
            emptyLabel={t('adminPihole.noData')}
          />
        </div>
      )}
    </div>
  );
}

function TopList({ title, rows, emptyLabel }) {
  const max = rows.reduce((acc, r) => Math.max(acc, Number(r.value) || 0), 0);
  return (
    <SectionCard title={title}>
      {rows.length === 0 ? (
        <EmptyRow>{emptyLabel}</EmptyRow>
      ) : (
        <div className="space-y-1 -mx-1">
          {rows.map((row) => (
            <BarRow key={row.label} label={row.label} sublabel={row.sublabel} value={row.value} max={max} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function VersionBadges({ version, t }) {
  // FTL nests versions as version.<component>.local.version; tolerate a flatter
  // shape from older builds rather than rendering nothing.
  const pick = (component) => {
    const node = version?.version?.[component] ?? version?.[component];
    return node?.local?.version ?? node?.version ?? (typeof node === 'string' ? node : null);
  };

  const entries = [
    [t('adminPihole.versionCore'), pick('core')],
    [t('adminPihole.versionFtl'), pick('ftl')],
    [t('adminPihole.versionWeb'), pick('web')],
  ].filter(([, value]) => value);

  return entries.map(([label, value]) => (
    <span key={label} className="px-2 py-1 text-xs rounded-full bg-gray-700 text-gray-300">
      {label} {value}
    </span>
  ));
}

/**
 * Tick a pause countdown locally so it visibly runs down between refetches.
 * The value is re-seeded during render whenever the server reports a different
 * timer, and decremented from the interval callback.
 */
function useCountdown(timer) {
  const seconds = Number(timer);
  const initial = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;

  const [state, setState] = useState({ timer, remaining: initial });
  if (state.timer !== timer) {
    setState({ timer, remaining: initial });
  }

  useEffect(() => {
    if (initial === null) return undefined;
    const id = setInterval(() => {
      setState((prev) => {
        if (prev.remaining === null) return prev;
        return { ...prev, remaining: prev.remaining > 1 ? prev.remaining - 1 : null };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timer, initial]);

  return state.remaining;
}
