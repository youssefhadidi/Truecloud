/** @format */

'use client';

import { useState } from 'react';
import { FiPlus, FiTrash2, FiSave, FiLink, FiEyeOff, FiAlertTriangle } from 'react-icons/fi';
import { useTranslation } from '@/components/LanguageProvider';
import { useNotifications } from '@/contexts/NotificationsContext';
import { usePiholeConfig, useSavePiholeConnection, useSavePiholeConfig } from '@/lib/api/pihole';
import {
  SectionCard,
  StatusPill,
  errorMessage,
  inputClass,
  iconButtonDanger,
  buttonPrimary,
  buttonSecondary,
} from './ui';

const LISTENING_MODES = ['LOCAL', 'SINGLE', 'BIND', 'ALL', 'NONE'];

export default function SettingsPanel({ status }) {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();

  const connected = Boolean(status?.connection?.ok);
  const { data: config, isLoading } = usePiholeConfig({ enabled: connected });
  const saveConnection = useSavePiholeConnection();
  const saveConfig = useSavePiholeConfig();

  /* ---------------- Connection ---------------- */

  const serverBaseUrl = status?.connection?.baseUrl ?? '';
  const [baseUrl, setBaseUrl] = useState(serverBaseUrl);
  const [password, setPassword] = useState('');

  // Re-seed the field when the server's value changes, without an effect —
  // see "adjusting state when a prop changes" in the React docs.
  const [seededBaseUrl, setSeededBaseUrl] = useState(serverBaseUrl);
  if (serverBaseUrl !== seededBaseUrl) {
    setSeededBaseUrl(serverBaseUrl);
    setBaseUrl(serverBaseUrl);
  }

  const handleSaveConnection = async (e) => {
    e.preventDefault();
    try {
      const result = await saveConnection.mutateAsync({
        baseUrl: baseUrl.trim(),
        // Blank means "keep what's stored" — the password never comes back to
        // the browser, so it cannot be round-tripped.
        ...(password ? { password } : {}),
      });
      setPassword('');
      if (result?.connection?.ok) {
        addNotification('success', t('adminPihole.connectionOk'));
      } else {
        addNotification('error', result?.connection?.error || t('adminPihole.connectionFailed'));
      }
    } catch (err) {
      addNotification('error', errorMessage(err, t('adminPihole.connectionFailed')));
    }
  };

  /* ---------------- DNS ---------------- */

  const [upstreams, setUpstreams] = useState(['']);
  const [dnssec, setDnssec] = useState(false);
  const [listeningMode, setListeningMode] = useState('LOCAL');
  const [revServers, setRevServers] = useState([]);

  // Same pattern as above: React Query hands back a stable object reference
  // until the data actually changes, so an identity check re-seeds the form
  // exactly once per fetch that returned something new.
  const [seededConfig, setSeededConfig] = useState(null);
  if (config?.dns && config !== seededConfig) {
    setSeededConfig(config);
    setUpstreams(config.dns.upstreams?.length ? config.dns.upstreams : ['']);
    setDnssec(Boolean(config.dns.dnssec));
    setListeningMode(config.dns.listeningMode || 'LOCAL');
    setRevServers(config.dns.revServers ?? []);
  }

  const handleSaveDns = async () => {
    try {
      await saveConfig.mutateAsync({
        dns: {
          upstreams: upstreams.map((u) => u.trim()).filter(Boolean),
          dnssec,
          listeningMode,
          revServers: revServers.map((r) => r.trim()).filter(Boolean),
        },
      });
      addNotification('success', t('adminPihole.configSaved'));
    } catch (err) {
      addNotification('error', errorMessage(err, t('adminPihole.configSaveFailed')));
    }
  };

  /* ---------------- Built-in GUI ---------------- */

  const currentPort = config?.webserver?.port ?? '';
  const localOnly = isLocalOnly(currentPort);
  const apiPort = portFromUrl(status?.connection?.baseUrl) || '8080';
  const targetPort = `127.0.0.1:${apiPort},[::1]:${apiPort}`;
  const portMismatch = connected && currentPort && !portMatches(currentPort, apiPort);

  const handleHideGui = async () => {
    if (!window.confirm(t('adminPihole.hideGuiConfirm', { port: targetPort }))) return;
    try {
      await saveConfig.mutateAsync({ webserver: { port: targetPort } });
      addNotification('success', t('adminPihole.hideGuiDone'));
    } catch (err) {
      addNotification('error', errorMessage(err, t('adminPihole.hideGuiFailed')));
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Connection */}
      <SectionCard title={t('adminPihole.connectionTitle')}>
        <p className="text-sm text-gray-400">{t('adminPihole.connectionIntro')}</p>

        <form onSubmit={handleSaveConnection} className="space-y-4">
          <div>
            <label htmlFor="pihole-base-url" className="block text-sm font-medium text-gray-300 mb-1">
              {t('adminPihole.baseUrlLabel')}
            </label>
            <input
              id="pihole-base-url"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:8080"
              className={inputClass}
              required
            />
            <p className="mt-1 text-xs text-gray-500">{t('adminPihole.baseUrlHint')}</p>
          </div>

          <div>
            <label htmlFor="pihole-password" className="block text-sm font-medium text-gray-300 mb-1">
              {t('adminPihole.passwordLabel')}
            </label>
            <input
              id="pihole-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('adminPihole.passwordPlaceholder')}
              autoComplete="new-password"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-500">
              {status?.connection?.hasPassword ? t('adminPihole.passwordStored') : t('adminPihole.passwordHint')}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusPill
              ok={connected}
              okLabel={t('adminPihole.connectionOk')}
              badLabel={t('adminPihole.connectionFailed')}
            />
            <button type="submit" disabled={saveConnection.isPending} className={buttonPrimary}>
              <FiLink size={14} />
              {saveConnection.isPending ? t('adminPihole.saving') : t('adminPihole.testConnection')}
            </button>
          </div>

          {status?.connection?.error && (
            <pre className="text-xs text-red-300 bg-red-900/20 border border-red-800/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
              {status.connection.error}
            </pre>
          )}
        </form>
      </SectionCard>

      {!connected ? null : isLoading ? (
        <div className="text-gray-400">{t('adminPihole.loading')}</div>
      ) : (
        <>
          {/* DNS resolution */}
          <SectionCard
            title={t('adminPihole.dnsTitle')}
            footer={
              <button type="button" onClick={handleSaveDns} disabled={saveConfig.isPending} className={buttonPrimary}>
                <FiSave size={14} />
                {saveConfig.isPending ? t('adminPihole.saving') : t('adminPihole.save')}
              </button>
            }
          >
            <ListEditor
              label={t('adminPihole.upstreamsLabel')}
              hint={t('adminPihole.upstreamsHint')}
              placeholder={t('adminPihole.upstreamPlaceholder')}
              addLabel={t('adminPihole.addUpstream')}
              values={upstreams}
              onChange={setUpstreams}
              removeAriaLabel={t('adminPihole.remove')}
            />

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={dnssec}
                onChange={(e) => setDnssec(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
              />
              <span>
                <span className="block text-sm text-gray-200">{t('adminPihole.dnssecLabel')}</span>
                <span className="block text-xs text-gray-500">{t('adminPihole.dnssecHint')}</span>
              </span>
            </label>

            <div>
              <label htmlFor="pihole-listening-mode" className="block text-sm font-medium text-gray-300 mb-1">
                {t('adminPihole.listeningModeLabel')}
              </label>
              <select
                id="pihole-listening-mode"
                value={listeningMode}
                onChange={(e) => setListeningMode(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {LISTENING_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`adminPihole.mode${mode}`)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">{t('adminPihole.listeningModeHint')}</p>
            </div>

            <ListEditor
              label={t('adminPihole.revServersLabel')}
              hint={t('adminPihole.revServersHint')}
              placeholder={t('adminPihole.revServerPlaceholder')}
              addLabel={t('adminPihole.addRevServer')}
              values={revServers}
              onChange={setRevServers}
              removeAriaLabel={t('adminPihole.remove')}
              allowEmpty
            />
          </SectionCard>

          {/* Built-in web UI */}
          <SectionCard title={t('adminPihole.guiTitle')}>
            <p className="text-sm text-gray-400">{t('adminPihole.guiIntro')}</p>

            <div className="flex flex-wrap items-center gap-3">
              <StatusPill
                ok={localOnly}
                okLabel={t('adminPihole.guiLocalOnly')}
                badLabel={t('adminPihole.guiExposed')}
              />
              <span className="text-xs text-gray-500">
                {t('adminPihole.guiCurrentPort')} <code className="text-gray-400">{currentPort || '—'}</code>
              </span>
            </div>

            {portMismatch && (
              <div className="flex items-start gap-2 text-xs text-amber-200 bg-amber-900/20 border border-amber-800/60 rounded-lg p-3">
                <FiAlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {t('adminPihole.guiPortMismatch', {
                    baseUrl: status?.connection?.baseUrl ?? '',
                    port: currentPort,
                  })}
                </span>
              </div>
            )}

            {!localOnly && (
              <button type="button" onClick={handleHideGui} disabled={saveConfig.isPending} className={buttonSecondary}>
                <FiEyeOff size={14} />
                {t('adminPihole.hideGui')}
              </button>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

/** A repeatable text input list — used for upstreams and conditional forwarding. */
function ListEditor({ label, hint, placeholder, addLabel, values, onChange, removeAriaLabel, allowEmpty = false }) {
  const setAt = (index, value) => onChange(values.map((v, i) => (i === index ? value : v)));
  const removeAt = (index) => {
    const next = values.filter((_, i) => i !== index);
    onChange(allowEmpty || next.length ? next : ['']);
  };

  return (
    <div>
      <span className="block text-sm font-medium text-gray-300 mb-1">{label}</span>
      <div className="space-y-2">
        {values.map((value, index) => (
          // Index keys are correct here: rows are positional and have no id.
          <div key={index} className="flex gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => setAt(index, e.target.value)}
              placeholder={placeholder}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => removeAt(index)}
              className={iconButtonDanger}
              aria-label={removeAriaLabel}
            >
              <FiTrash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        <FiPlus size={13} />
        {addLabel}
      </button>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Port helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * FTL's `webserver.port` is a comma-separated list like "80,[::]:80,443s".
 * A binding is local-only when every entry names a loopback address.
 */
function isLocalOnly(portSpec) {
  const entries = String(portSpec)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return false;
  return entries.every((entry) => entry.startsWith('127.0.0.1:') || entry.startsWith('[::1]:'));
}

function portFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.port) return parsed.port;
    return parsed.protocol === 'https:' ? '443' : '80';
  } catch {
    return null;
  }
}

/** Does any entry in the spec listen on the port Truecloud connects to? */
function portMatches(portSpec, apiPort) {
  return String(portSpec)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((entry) => {
      const match = entry.match(/(\d+)s?$/);
      return match ? match[1] === String(apiPort) : false;
    });
}
