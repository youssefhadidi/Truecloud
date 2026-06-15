/** @format */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FiPlus,
  FiPlay,
  FiSquare,
  FiTrash2,
  FiTerminal,
  FiSettings,
  FiUploadCloud,
  FiRefreshCw,
  FiX,
  FiServer,
} from 'react-icons/fi';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import {
  useMinecraftServers,
  useCreateMinecraftServer,
  useDeleteMinecraftServer,
  useStartMinecraftServer,
  useStopMinecraftServer,
  useSendMinecraftCommand,
  useImportMinecraftWorld,
  useMinecraftServer,
  useUpdateMinecraftServer,
  useMinecraftLogs,
  usePaperVersions,
} from '@/lib/api/minecraft';
import { useTranslation } from '@/components/LanguageProvider';

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const colors = {
    running: 'bg-green-900 text-green-300',
    starting: 'bg-yellow-900 text-yellow-300',
    stopping: 'bg-orange-900 text-orange-300',
    stopped: 'bg-gray-700 text-gray-400',
  };
  const labels = {
    running: t('adminMinecraft.statusRunning'),
    starting: t('adminMinecraft.statusStarting'),
    stopping: t('adminMinecraft.statusStopping'),
    stopped: t('adminMinecraft.statusStopped'),
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? colors.stopped}`}>
      {labels[status] ?? labels.stopped}
    </span>
  );
}

// ─── Create Server Form ───────────────────────────────────────────────────────

function CreateServerForm({ onClose }) {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const createMutation = useCreateMinecraftServer();
  const { data: paperVersions, isPending: versionsLoading } = usePaperVersions();
  const [form, setForm] = useState({
    name: '',
    port: '25565',
    maxRam: '2048',
    minRam: '512',
    paperVersion: 'latest',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync(form);
      addNotification('success', t('adminMinecraft.serverCreated', { name: form.name }));
      onClose();
    } catch (err) {
      addNotification('error', err.response?.data?.error || t('adminMinecraft.createFailed'));
    }
  };

  const inputClass =
    'w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white placeholder-gray-400';

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs text-gray-400 mb-1">{t('adminMinecraft.serverName')}</label>
        <input
          type="text"
          placeholder={t('adminMinecraft.serverNamePlaceholder')}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          pattern="[a-zA-Z0-9\-_]+"
          title={t('adminMinecraft.serverNameTitle')}
          required
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('adminMinecraft.port')}</label>
          <input
            type="number"
            min="1024"
            max="65535"
            value={form.port}
            onChange={(e) => setForm({ ...form, port: e.target.value })}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('adminMinecraft.paperVersion')}</label>
          <select
            value={form.paperVersion}
            onChange={(e) => setForm({ ...form, paperVersion: e.target.value })}
            disabled={versionsLoading}
            className={inputClass}
          >
            <option value="latest">latest</option>
            {paperVersions.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('adminMinecraft.minRam')}</label>
          <input
            type="number"
            min="256"
            value={form.minRam}
            onChange={(e) => setForm({ ...form, minRam: e.target.value })}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('adminMinecraft.maxRam')}</label>
          <input
            type="number"
            min="512"
            value={form.maxRam}
            onChange={(e) => setForm({ ...form, maxRam: e.target.value })}
            required
            className={inputClass}
          />
        </div>
      </div>

      <p className="text-xs text-gray-500">
        {t('adminMinecraft.jarNote')}
      </p>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="flex-1 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
        >
          {createMutation.isPending ? t('adminMinecraft.creating') : t('adminMinecraft.createServer')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
        >
          {t('adminMinecraft.cancel')}
        </button>
      </div>
    </form>
  );
}

// ─── Console Tab ──────────────────────────────────────────────────────────────

function ConsoleTab({ server, wsConsoleLines }) {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const { data: initialLogs } = useMinecraftLogs(server.id);
  const sendCommand = useSendMinecraftCommand(server.id);
  const [input, setInput] = useState('');
  const [lines, setLines] = useState([]);
  const bottomRef = useRef(null);
  const initialLoaded = useRef(false);

  // Seed with buffered logs on mount
  useEffect(() => {
    if (!initialLoaded.current && initialLogs?.length) {
      setLines(initialLogs);
      initialLoaded.current = true;
    }
  }, [initialLogs]);

  // Append new lines from WebSocket
  useEffect(() => {
    const relevant = wsConsoleLines.filter((m) => m.serverId === server.id);
    if (relevant.length === 0) return;
    const newLines = relevant.flatMap((m) => m.lines);
    setLines((prev) => {
      const combined = [...prev, ...newLines];
      return combined.slice(-200);
    });
  }, [wsConsoleLines, server.id]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    try {
      await sendCommand.mutateAsync(input.trim());
      setInput('');
    } catch (err) {
      addNotification('error', err.response?.data?.error || t('adminMinecraft.sendCommandFailed'));
    }
  };

  return (
    <div className="flex flex-col h-96">
      <div className="flex-1 bg-gray-950 rounded-lg p-3 overflow-y-auto font-mono text-xs text-gray-300 space-y-0.5">
        {lines.length === 0 ? (
          <p className="text-gray-600 italic">{t('adminMinecraft.consoleEmpty')}</p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="leading-5 whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex gap-2 mt-2">
        <span className="self-center text-gray-500 font-mono text-sm">{'>'}</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={server.isRunning ? t('adminMinecraft.typeCommand') : t('adminMinecraft.serverStopped')}
          disabled={!server.isRunning}
          className="flex-1 px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 font-mono"
        />
        <button
          type="submit"
          disabled={!server.isRunning || !input.trim()}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg transition-colors"
        >
          {t('adminMinecraft.send')}
        </button>
      </form>
    </div>
  );
}

// ─── Config Tab ───────────────────────────────────────────────────────────────

function ConfigTab({ server }) {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const { data } = useMinecraftServer(server.id);
  const updateMutation = useUpdateMinecraftServer(server.id);

  const [form, setForm] = useState({
    minRam: server.minRam,
    maxRam: server.maxRam,
    autoStart: server.autoStart,
  });

  const [propsForm, setPropsForm] = useState({});

  useEffect(() => {
    if (data?.properties) {
      setPropsForm({
        motd: data.properties['motd'] ?? '',
        'max-players': data.properties['max-players'] ?? '20',
        difficulty: data.properties['difficulty'] ?? 'normal',
        gamemode: data.properties['gamemode'] ?? 'survival',
        pvp: data.properties['pvp'] ?? 'true',
        'online-mode': data.properties['online-mode'] ?? 'true',
        'server-port': data.properties['server-port'] ?? String(server.port),
      });
    }
  }, [data?.properties, server.port]);

  const inputClass =
    'w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white';

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await updateMutation.mutateAsync({ ...form, properties: propsForm });
      addNotification('success', t('adminMinecraft.configSaved'));
    } catch {
      addNotification('error', t('adminMinecraft.configSaveFailed'));
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('adminMinecraft.minRam')}</label>
          <input
            type="number"
            min="256"
            value={form.minRam}
            onChange={(e) => setForm({ ...form, minRam: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('adminMinecraft.maxRam')}</label>
          <input
            type="number"
            min="512"
            value={form.maxRam}
            onChange={(e) => setForm({ ...form, maxRam: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={form.autoStart}
          onClick={() => setForm({ ...form, autoStart: !form.autoStart })}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${
            form.autoStart ? 'bg-blue-600' : 'bg-gray-600'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
              form.autoStart ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
        <span className="text-sm text-gray-300">{t('adminMinecraft.autoStart')}</span>
      </div>

      <hr className="border-gray-700" />

      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{t('adminMinecraft.serverProperties')}</p>

      <div>
        <label className="block text-xs text-gray-400 mb-1">{t('adminMinecraft.motd')}</label>
        <input
          type="text"
          value={propsForm.motd ?? ''}
          onChange={(e) => setPropsForm({ ...propsForm, motd: e.target.value })}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('adminMinecraft.maxPlayers')}</label>
          <input
            type="number"
            min="1"
            value={propsForm['max-players'] ?? '20'}
            onChange={(e) => setPropsForm({ ...propsForm, 'max-players': e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('adminMinecraft.difficulty')}</label>
          <select
            value={propsForm.difficulty ?? 'normal'}
            onChange={(e) => setPropsForm({ ...propsForm, difficulty: e.target.value })}
            className={inputClass}
          >
            <option value="peaceful">{t('adminMinecraft.diffPeaceful')}</option>
            <option value="easy">{t('adminMinecraft.diffEasy')}</option>
            <option value="normal">{t('adminMinecraft.diffNormal')}</option>
            <option value="hard">{t('adminMinecraft.diffHard')}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('adminMinecraft.gamemode')}</label>
          <select
            value={propsForm.gamemode ?? 'survival'}
            onChange={(e) => setPropsForm({ ...propsForm, gamemode: e.target.value })}
            className={inputClass}
          >
            <option value="survival">{t('adminMinecraft.gmSurvival')}</option>
            <option value="creative">{t('adminMinecraft.gmCreative')}</option>
            <option value="adventure">{t('adminMinecraft.gmAdventure')}</option>
            <option value="spectator">{t('adminMinecraft.gmSpectator')}</option>
          </select>
        </div>
        <div className="flex items-end pb-1 gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={propsForm.pvp === 'true'}
              onChange={(e) => setPropsForm({ ...propsForm, pvp: e.target.checked ? 'true' : 'false' })}
              className="w-4 h-4 rounded accent-blue-600"
            />
            <span className="text-sm text-gray-300">{t('adminMinecraft.pvp')}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={propsForm['online-mode'] === 'true'}
              onChange={(e) =>
                setPropsForm({ ...propsForm, 'online-mode': e.target.checked ? 'true' : 'false' })
              }
              className="w-4 h-4 rounded accent-blue-600"
            />
            <span className="text-sm text-gray-300">{t('adminMinecraft.onlineMode')}</span>
          </label>
        </div>
      </div>

      <button
        type="submit"
        disabled={updateMutation.isPending}
        className="w-full py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
      >
        {updateMutation.isPending ? t('adminMinecraft.savingConfig') : t('adminMinecraft.saveConfig')}
      </button>
    </form>
  );
}

// ─── World Tab ────────────────────────────────────────────────────────────────

function WorldTab({ server }) {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const importMutation = useImportMinecraftWorld(server.id);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = useCallback(
    async (file) => {
      if (!file || !file.name.endsWith('.zip')) {
        addNotification('error', t('adminMinecraft.selectZip'));
        return;
      }
      try {
        await importMutation.mutateAsync(file);
        addNotification('success', t('adminMinecraft.worldImported'));
      } catch (err) {
        addNotification('error', err.response?.data?.error || t('adminMinecraft.importFailed'));
      }
    },
    [importMutation, addNotification, t]
  );

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  return (
    <div className="space-y-4">
      {server.isRunning && (
        <div className="p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg text-yellow-300 text-sm">
          {t('adminMinecraft.stopBeforeImport')}
        </div>
      )}

      <p className="text-sm text-gray-400">
        {t('adminMinecraft.worldImportInfoPrefix')}
        <code className="bg-gray-700 px-1 rounded text-xs">{t('adminMinecraft.worldFolder')}</code>
        {t('adminMinecraft.worldImportInfoSuffix')}
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragging ? 'border-blue-500 bg-blue-900/20' : 'border-gray-600 hover:border-gray-500'
        } ${server.isRunning || importMutation.isPending ? 'pointer-events-none opacity-40' : ''}`}
      >
        <FiUploadCloud size={32} className="mx-auto mb-2 text-gray-500" />
        <p className="text-sm text-gray-400">
          {importMutation.isPending ? t('adminMinecraft.importing') : t('adminMinecraft.dropWorldZip')}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

// ─── Server Detail Panel ──────────────────────────────────────────────────────

function ServerDetail({ server, wsConsoleLines, onDeleted }) {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const startMutation = useStartMinecraftServer();
  const stopMutation = useStopMinecraftServer();
  const deleteMutation = useDeleteMinecraftServer();
  const [tab, setTab] = useState('console');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleStart = async () => {
    try {
      await startMutation.mutateAsync(server.id);
    } catch (err) {
      addNotification('error', err.response?.data?.error || t('adminMinecraft.startFailed'));
    }
  };

  const handleStop = async () => {
    try {
      await stopMutation.mutateAsync(server.id);
    } catch (err) {
      addNotification('error', err.response?.data?.error || t('adminMinecraft.stopFailed'));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(server.id);
      addNotification('success', t('adminMinecraft.serverDeleted', { name: server.name }));
      onDeleted();
    } catch (err) {
      addNotification('error', err.response?.data?.error || t('adminMinecraft.deleteFailed'));
    }
  };

  const tabs = [
    { id: 'console', label: t('adminMinecraft.tabConsole'), icon: FiTerminal },
    { id: 'config', label: t('adminMinecraft.tabConfig'), icon: FiSettings },
    { id: 'world', label: t('adminMinecraft.tabWorld'), icon: FiUploadCloud },
  ];

  const isTransitioning = server.status === 'starting' || server.status === 'stopping';

  return (
    <div className="bg-gray-800 rounded-lg p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{server.name}</h2>
          <p className="text-sm text-gray-400">
            {t('adminMinecraft.serverInfo', { port: server.port, version: server.paperVersion, ram: server.maxRam })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={server.status} />
          {server.isRunning ? (
            <button
              onClick={handleStop}
              disabled={stopMutation.isPending || isTransitioning}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              <FiSquare size={14} />
              {t('adminMinecraft.stop')}
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={startMutation.isPending || isTransitioning}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              <FiPlay size={14} />
              {t('adminMinecraft.start')}
            </button>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
            title={t('adminMinecraft.deleteServer')}
          >
            <FiTrash2 size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-700">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'console' && <ConsoleTab server={server} wsConsoleLines={wsConsoleLines} />}
        {tab === 'config' && <ConfigTab server={server} />}
        {tab === 'world' && <WorldTab server={server} />}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">{t('adminMinecraft.deleteConfirmTitle', { name: server.name })}</h3>
            <p className="text-sm text-gray-400">
              {t('adminMinecraft.deleteConfirmBody')}
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
              >
                {deleteMutation.isPending ? t('adminMinecraft.deleting') : t('adminMinecraft.delete')}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
              >
                {t('adminMinecraft.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MinecraftPage() {
  const { t } = useTranslation();
  const { data: servers = [], isLoading, refetch } = useMinecraftServers();
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  // WebSocket: collect minecraft-console messages
  const [wsConsoleLines, setWsConsoleLines] = useState([]);
  // WebSocket: status overrides (serverId → status)
  const [wsStatuses, setWsStatuses] = useState({});

  const { subscribe } = useWebSocket();

  useEffect(() => {
    const unsubConsole = subscribe('minecraft-console', (msg) => {
      setWsConsoleLines((prev) => [...prev.slice(-500), msg.payload]);
    });

    const unsubStatus = subscribe('minecraft-status', (msg) => {
      const { serverId, status } = msg.payload;
      setWsStatuses((prev) => ({ ...prev, [serverId]: status }));
      refetch();
    });

    return () => {
      unsubConsole();
      unsubStatus();
    };
  }, [subscribe, refetch]);

  // Merge WS status overrides into server list
  const enrichedServers = servers.map((s) => ({
    ...s,
    status: wsStatuses[s.id] ?? s.status,
    isRunning: wsStatuses[s.id]
      ? wsStatuses[s.id] === 'running' || wsStatuses[s.id] === 'starting'
      : s.isRunning,
  }));

  const selectedServer = enrichedServers.find((s) => s.id === selectedId);

  // Auto-select first server
  useEffect(() => {
    if (!selectedId && enrichedServers.length > 0) {
      setSelectedId(enrichedServers[0].id);
    }
  }, [enrichedServers, selectedId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">{t('adminMinecraft.title')}</h1>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50"
          >
            <FiRefreshCw className={isLoading ? 'animate-spin' : ''} size={16} />
            <span className="hidden sm:inline text-sm">{t('adminMinecraft.refresh')}</span>
          </button>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm"
          >
            {showCreate ? <FiX size={16} /> : <FiPlus size={16} />}
            <span className="hidden sm:inline">{showCreate ? t('adminMinecraft.cancel') : t('adminMinecraft.newServer')}</span>
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-gray-800 rounded-lg p-4 sm:p-6 mb-6">
          <h2 className="text-base font-semibold text-white mb-4">{t('adminMinecraft.newServerHeading')}</h2>
          <CreateServerForm onClose={() => setShowCreate(false)} />
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-400 text-sm">{t('adminMinecraft.loadingServers')}</div>
      ) : enrichedServers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FiServer size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400">{t('adminMinecraft.noServers')}</p>
          <p className="text-gray-500 text-sm mt-1">{t('adminMinecraft.noServersHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Server list */}
          <div className="space-y-2">
            {enrichedServers.map((server) => (
              <button
                key={server.id}
                onClick={() => setSelectedId(server.id)}
                className={`w-full text-left p-4 rounded-lg border transition-colors ${
                  selectedId === server.id
                    ? 'border-blue-500 bg-gray-700'
                    : 'border-gray-700 bg-gray-800 hover:bg-gray-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">{server.name}</span>
                  <StatusBadge status={server.status} />
                </div>
                <p className="text-xs text-gray-400 mt-1">{t('adminMinecraft.portLabel', { port: server.port })}</p>
              </button>
            ))}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {selectedServer ? (
              <ServerDetail
                server={selectedServer}
                wsConsoleLines={wsConsoleLines}
                onDeleted={() => setSelectedId(null)}
              />
            ) : (
              <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-500 text-sm">
                {t('adminMinecraft.selectServer')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
