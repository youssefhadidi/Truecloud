/** @format */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FiAlertTriangle, FiAlertCircle, FiArrowRight, FiRefreshCw, FiDownload, FiCheck, FiX } from 'react-icons/fi';
import { useTranslation } from '@/components/LanguageProvider';
import { useNotifications } from '@/contexts/NotificationsContext';
import { usePiholePreflight, useInstallPihole, piholeKeys } from '@/lib/api/pihole';
import { useJob } from '@/lib/api/jobs';
import { useQueryClient } from '@tanstack/react-query';
import { SectionCard, errorMessage, inputClass, buttonPrimary, buttonSecondary } from './ui';

// Server-side check keys → dictionary keys. Explicit so the strings stay greppable.
const CHECK_LABELS = {
  alreadyInstalled: 'adminPihole.checkAlreadyInstalled',
  noBash: 'adminPihole.checkNoBash',
  noCurl: 'adminPihole.checkNoCurl',
  port53Unknown: 'adminPihole.checkPort53Unknown',
  port53Occupied: 'adminPihole.checkPort53Occupied',
  port80Busy: 'adminPihole.checkPort80Busy',
  noInterface: 'adminPihole.checkNoInterface',
  staticIp: 'adminPihole.checkStaticIp',
  configExists: 'adminPihole.checkConfigExists',
  disableStubListener: 'adminPihole.actionDisableStubListener',
  seedConfig: 'adminPihole.actionSeedConfig',
  installPackages: 'adminPihole.actionInstallPackages',
  bindWebserver: 'adminPihole.actionBindWebserver',
};

export default function InstallPanel() {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const queryClient = useQueryClient();

  const { data: preflight, isLoading, refetch, isFetching } = usePiholePreflight();
  const install = useInstallPihole();

  const [webPort, setWebPort] = useState('8080');
  const [confirmed, setConfirmed] = useState(false);
  const [jobId, setJobId] = useState(null);

  const { data: job } = useJob(jobId);
  const running = Boolean(jobId) && (job?.status === 'running' || job?.status === 'pending');
  const succeeded = job?.status === 'completed';
  const failed = job?.status === 'failed';

  // The status query drives the whole page; refresh it once the job lands so
  // the tabs switch over to the real panels without a manual reload.
  const [settledJob, setSettledJob] = useState(null);
  if (jobId && (succeeded || failed) && settledJob !== jobId) {
    setSettledJob(jobId);
    queryClient.invalidateQueries({ queryKey: piholeKeys.status });
    queryClient.invalidateQueries({ queryKey: piholeKeys.preflight });
  }

  const handleInstall = async () => {
    try {
      const result = await install.mutateAsync({ webPort });
      setJobId(result.jobId);
      addNotification('success', t('adminPihole.installStarted'));
    } catch (e) {
      addNotification('error', errorMessage(e, t('adminPihole.installFailedToStart')));
    }
  };

  if (isLoading) {
    return <div className="text-gray-400">{t('adminPihole.loading')}</div>;
  }

  const blockers = preflight?.blockers ?? [];
  const warnings = preflight?.warnings ?? [];
  const actions = preflight?.actions ?? [];
  const canInstall = Boolean(preflight?.canInstall) && confirmed && !running;

  return (
    <div className="space-y-6 max-w-3xl">
      <SectionCard
        title={t('adminPihole.installTitle')}
        action={
          <button type="button" onClick={() => refetch()} disabled={isFetching || running} className={buttonSecondary}>
            <FiRefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{t('adminPihole.recheck')}</span>
          </button>
        }
      >
        <p className="text-sm text-gray-400">{t('adminPihole.installIntro')}</p>
        <p className="text-xs text-gray-500 border-l-2 border-gray-700 pl-3">
          {t('adminPihole.installUnattendedNote')}
        </p>

        {blockers.length > 0 && (
          <CheckGroup
            title={t('adminPihole.blockersTitle')}
            items={blockers}
            tone="blocker"
            icon={FiAlertCircle}
            t={t}
          />
        )}

        {warnings.length > 0 && (
          <CheckGroup
            title={t('adminPihole.warningsTitle')}
            items={warnings}
            tone="warning"
            icon={FiAlertTriangle}
            t={t}
          />
        )}

        {actions.length > 0 && (
          <CheckGroup title={t('adminPihole.actionsTitle')} items={actions} tone="action" icon={FiArrowRight} t={t} />
        )}

        <div>
          <label htmlFor="pihole-install-port" className="block text-sm font-medium text-gray-300 mb-1">
            {t('adminPihole.webPortLabel')}
          </label>
          <input
            id="pihole-install-port"
            type="number"
            min="1"
            max="65535"
            value={webPort}
            onChange={(e) => setWebPort(e.target.value)}
            disabled={running}
            className={`${inputClass} max-w-[12rem]`}
          />
          <p className="mt-1 text-xs text-gray-500">{t('adminPihole.webPortHint')}</p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={!preflight?.canInstall || running}
            className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800 disabled:opacity-50"
          />
          <span className="text-sm text-gray-200">{t('adminPihole.confirmLabel')}</span>
        </label>

        <div className="flex items-center gap-3">
          <button type="button" onClick={handleInstall} disabled={!canInstall || install.isPending} className={buttonPrimary}>
            <FiDownload size={14} />
            {running ? t('adminPihole.installRunning') : t('adminPihole.installAction')}
          </button>
          {jobId && (
            <Link href="/admin/activity" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              {t('adminPihole.viewInActivity')}
            </Link>
          )}
        </div>
      </SectionCard>

      {jobId && <InstallProgress job={job} running={running} succeeded={succeeded} failed={failed} t={t} />}
    </div>
  );
}

function CheckGroup({ title, items, tone, icon: Icon, t }) {
  const tones = {
    blocker: 'text-red-300 bg-red-900/20 border-red-800/60',
    warning: 'text-amber-200 bg-amber-900/20 border-amber-800/60',
    action: 'text-gray-300 bg-gray-900/40 border-gray-700',
  };

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">{title}</h3>
      <ul className={`rounded-lg border divide-y divide-white/5 ${tones[tone]}`}>
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 px-3 py-2 text-sm">
            <Icon size={14} className="mt-0.5 shrink-0" />
            <span>{t(CHECK_LABELS[item.key] ?? item.key, { detail: item.detail ?? '' })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InstallProgress({ job, running, succeeded, failed, t }) {
  const progress = Math.min(100, Math.max(0, Number(job?.progress) || 0));

  return (
    <SectionCard title={t('adminPihole.installRunning')}>
      <div className="flex items-center gap-3">
        {succeeded && <FiCheck className="text-green-400 shrink-0" />}
        {failed && <FiX className="text-red-400 shrink-0" />}
        <span className="text-sm text-gray-300">
          {succeeded
            ? t('adminPihole.installSucceeded')
            : failed
              ? t('adminPihole.installFailed')
              : t('adminPihole.installRunning')}
        </span>
      </div>

      <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            failed ? 'bg-red-600' : succeeded ? 'bg-green-600' : 'bg-blue-600'
          }`}
          style={{ width: `${succeeded ? 100 : progress}%` }}
        />
      </div>

      {job?.lastLog?.message && (
        <pre className="text-xs text-gray-400 bg-gray-900 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
          {job.lastLog.message}
        </pre>
      )}

      {job?.error && (
        <pre className="text-xs text-red-300 bg-red-900/20 border border-red-800/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
          {job.error}
        </pre>
      )}

      {running && <p className="text-xs text-gray-500">{t('adminPihole.installStarted')}</p>}
    </SectionCard>
  );
}
