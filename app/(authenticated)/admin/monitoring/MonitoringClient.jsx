/** @format */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FiActivity, FiCpu, FiHardDrive, FiWifi, FiDatabase,
  FiArrowUp, FiArrowDown, FiCheckCircle, FiAlertTriangle,
  FiXCircle, FiClock, FiThermometer,
} from 'react-icons/fi';
import { useWebSocket } from '@/contexts/WebSocketContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const HISTORY_LEN = 60; // 60 × 2s = 2 minutes of history

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(decimals)} ${units[i]}`;
}

function formatBytesPerSec(bps) {
  return `${formatBytes(bps)}/s`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function pct(used, total) {
  if (!total) return 0;
  return Math.round((used / total) * 100);
}

function usageColor(pct) {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-yellow-500';
  return 'bg-blue-500';
}

function usageTextColor(pct) {
  if (pct >= 90) return 'text-red-400';
  if (pct >= 70) return 'text-yellow-400';
  return 'text-blue-400';
}

function tempTextColor(celsius, driveTresholds = false) {
  const [warn, crit] = driveTresholds ? [45, 55] : [60, 80];
  if (celsius >= crit) return 'text-red-400';
  if (celsius >= warn) return 'text-yellow-400';
  return 'text-green-400';
}

function tempBadgeClass(celsius, driveThresholds = false) {
  const [warn, crit] = driveThresholds ? [45, 55] : [60, 80];
  if (celsius >= crit) return 'bg-red-500/20 border-red-500/40 text-red-400';
  if (celsius >= warn) return 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400';
  return 'bg-green-500/20 border-green-500/40 text-green-400';
}

function zfsHealthColor(health) {
  if (health === 'ONLINE') return 'text-green-400';
  if (health === 'DEGRADED') return 'text-yellow-400';
  return 'text-red-400';
}

function zfsHealthIcon(health) {
  if (health === 'ONLINE') return FiCheckCircle;
  if (health === 'DEGRADED') return FiAlertTriangle;
  return FiXCircle;
}

// ─── SVG Sparkline ────────────────────────────────────────────────────────────

function Sparkline({ data, color = '#3b82f6', max: maxOverride, height = 48 }) {
  if (!data || data.length < 2) {
    return <div className="w-full bg-gray-800/40 rounded" style={{ height }} />;
  }

  const w = 300;
  const h = height;
  const maxVal = maxOverride ?? Math.max(...data, 0.001);
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - Math.max(0, Math.min(1, v / maxVal)) * h,
  ]);

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const fillPath = `${linePath} L${w},${h} L0,${h} Z`;

  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="overflow-visible"
    >
      <path d={fillPath} fill={color} fillOpacity="0.12" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function DualSparkline({ dataA, dataB, colorA = '#3b82f6', colorB = '#10b981', height = 48 }) {
  if (!dataA || !dataB || (dataA.length < 2 && dataB.length < 2)) {
    return <div className="w-full bg-gray-800/40 rounded" style={{ height }} />;
  }

  const w = 300;
  const h = height;
  const maxVal = Math.max(...dataA, ...dataB, 0.001);

  const makePath = (data) => {
    const pts = data.map((v, i) => [
      (i / (data.length - 1)) * w,
      h - Math.max(0, Math.min(1, v / maxVal)) * h,
    ]);
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  };

  const lineA = makePath(dataA);
  const lineB = makePath(dataB);
  const fillA = `${lineA} L${w},${h} L0,${h} Z`;
  const fillB = `${lineB} L${w},${h} L0,${h} Z`;

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={fillA} fill={colorA} fillOpacity="0.12" />
      <path d={fillB} fill={colorB} fillOpacity="0.12" />
      <path d={lineA} fill="none" stroke={colorA} strokeWidth="1.5" />
      <path d={lineB} fill="none" stroke={colorB} strokeWidth="1.5" />
    </svg>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ title, icon: Icon, children, className = '' }) {
  return (
    <div className={`bg-gray-800 rounded-xl border border-gray-700 p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} className="text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function UsageBar({ label, used, total, color }) {
  const p = pct(used, total);
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{label}</span>
        <span className={usageTextColor(p)}>
          {formatBytes(used)} / {formatBytes(total)} ({p}%)
        </span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color || usageColor(p)}`}
          style={{ width: `${Math.min(100, p)}%` }}
        />
      </div>
    </div>
  );
}

function CoreGrid({ cores }) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1.5 mt-3">
      {cores.map((core, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5">
          <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${usageColor(core.usage)}`}
              style={{ width: `${Math.min(100, core.usage)}%` }}
            />
          </div>
          <span className={`text-[10px] font-mono ${usageTextColor(core.usage)}`}>
            {core.usage.toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function TemperaturesCard({ cpuTemp, driveTemps }) {
  const hasCpu = cpuTemp && typeof cpuTemp.packageTemp === 'number';
  const driveEntries = Object.entries(driveTemps ?? {});

  if (!hasCpu && driveEntries.length === 0) return null;

  // Sensors to show as badges: exclude the one already shown as the headline
  const pkgLabel = cpuTemp?.sensors?.find(
    (s) => s.value === cpuTemp.packageTemp
  )?.label;
  const coreSensors = cpuTemp?.sensors?.filter((s) => s.label !== pkgLabel) ?? [];

  return (
    <Card title="Temperatures" icon={FiThermometer}>
      {hasCpu && (
        <div className={driveEntries.length > 0 ? 'mb-4' : ''}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400 uppercase tracking-wide">CPU Package</span>
            <span className={`text-2xl font-bold font-mono ${tempTextColor(cpuTemp.packageTemp)}`}>
              {cpuTemp.packageTemp.toFixed(1)}°C
            </span>
          </div>
          {coreSensors.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {coreSensors.map((s, i) => (
                <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${tempBadgeClass(s.value)}`}>
                  {s.label}: {s.value.toFixed(0)}°C
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {driveEntries.length > 0 && (
        <div>
          <span className="text-xs text-gray-400 uppercase tracking-wide block mb-2">Drives</span>
          <div className="flex flex-wrap gap-2">
            {driveEntries.map(([disk, temp]) => (
              <span key={disk} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono ${tempBadgeClass(temp, true)}`}>
                <FiThermometer size={11} />
                {disk}: {temp}°C
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MonitoringClient() {
  const { subscribe, connected } = useWebSocket();

  // Rolling history arrays, keyed by metric path
  const historyRef = useRef({
    cpuOverall: [],
    ram: [],
    swap: [],
    net: {}, // iface → { rx: [], tx: [] }
    disk: {}, // name → { read: [], write: [] }
  });

  const [latest, setLatest] = useState(null);
  const [, forceRender] = useState(0);

  const push = useCallback((arr, val) => {
    arr.push(val);
    if (arr.length > HISTORY_LEN) arr.shift();
  }, []);

  useEffect(() => {
    const unsub = subscribe('system-metrics', (msg) => {
      const m = msg.payload;
      const h = historyRef.current;

      push(h.cpuOverall, m.cpu.overall);
      push(h.ram, pct(m.ram.used, m.ram.total));
      if (m.ram.swapTotal > 0) push(h.swap, pct(m.ram.swapUsed, m.ram.swapTotal));

      for (const [iface, stats] of Object.entries(m.network.interfaces)) {
        if (!h.net[iface]) h.net[iface] = { rx: [], tx: [] };
        push(h.net[iface].rx, stats.rxRate);
        push(h.net[iface].tx, stats.txRate);
      }

      for (const [disk, stats] of Object.entries(m.disks)) {
        if (!h.disk[disk]) h.disk[disk] = { read: [], write: [] };
        push(h.disk[disk].read, stats.readRate);
        push(h.disk[disk].write, stats.writeRate);
      }

      setLatest(m);
      forceRender((n) => n + 1);
    });
    return unsub;
  }, [subscribe, push]);

  const h = historyRef.current;

  // ── Render ──
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FiActivity className="text-blue-400" />
            System Monitoring
          </h1>
          {latest && (
            <p className="text-sm text-gray-400 mt-1 flex items-center gap-3">
              <span className="flex items-center gap-1">
                <FiClock size={13} />
                Uptime: {formatUptime(latest.uptime)}
              </span>
              <span>
                Load: {latest.cpu.loadAvg.map((v) => v.toFixed(2)).join('  ')}
              </span>
            </p>
          )}
        </div>
        <div className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border ${
          connected
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-gray-700/50 border-gray-600 text-gray-400'
        }`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
          {connected ? 'Live' : 'Connecting…'}
        </div>
      </div>

      {!latest && (
        <div className="text-center text-gray-500 py-16">Waiting for metrics…</div>
      )}

      {latest && (
        <>
          {/* CPU + RAM row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* CPU */}
            <Card title="CPU" icon={FiCpu}>
              <div className="flex items-end justify-between mb-2">
                <span className={`text-3xl font-bold font-mono ${usageTextColor(latest.cpu.overall)}`}>
                  {latest.cpu.overall.toFixed(1)}%
                </span>
                <div className="text-right">
                  {latest.cpu.freq > 0 && (
                    <div className="text-lg font-mono text-blue-300 leading-tight">
                      {latest.cpu.freq >= 1000
                        ? `${(latest.cpu.freq / 1000).toFixed(2)} GHz`
                        : `${latest.cpu.freq} MHz`}
                    </div>
                  )}
                  <div className="text-xs text-gray-500">{latest.cpu.cores.length} cores</div>
                </div>
              </div>
              <Sparkline data={h.cpuOverall} color="#3b82f6" max={100} height={48} />
              <CoreGrid cores={latest.cpu.cores} />
            </Card>

            {/* Memory */}
            <Card title="Memory" icon={FiHardDrive}>
              <div className="flex items-end justify-between mb-3">
                <span className={`text-3xl font-bold font-mono ${usageTextColor(pct(latest.ram.used, latest.ram.total))}`}>
                  {pct(latest.ram.used, latest.ram.total)}%
                </span>
                <span className="text-xs text-gray-500">
                  {formatBytes(latest.ram.free)} free
                </span>
              </div>
              <Sparkline data={h.ram} color="#8b5cf6" max={100} height={48} />
              <div className="mt-3 space-y-2">
                <UsageBar label="RAM" used={latest.ram.used} total={latest.ram.total} />
                {latest.ram.swapTotal > 0 && (
                  <UsageBar label="Swap" used={latest.ram.swapUsed} total={latest.ram.swapTotal} color="bg-purple-500" />
                )}
              </div>
            </Card>
          </div>

          {/* Temperatures */}
          <TemperaturesCard cpuTemp={latest.cpuTemp} driveTemps={latest.driveTemps} />

          {/* Network */}
          {Object.keys(latest.network.interfaces).length > 0 && (
            <Card title="Network" icon={FiWifi}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Object.entries(latest.network.interfaces).map(([iface, stats]) => (
                  <div key={iface}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-mono text-gray-300">{iface}</span>
                      <div className="flex gap-3 text-xs">
                        <span className="text-blue-400 flex items-center gap-1">
                          <FiArrowDown size={11} /> {formatBytesPerSec(stats.rxRate)}
                        </span>
                        <span className="text-green-400 flex items-center gap-1">
                          <FiArrowUp size={11} /> {formatBytesPerSec(stats.txRate)}
                        </span>
                      </div>
                    </div>
                    <DualSparkline
                      dataA={h.net[iface]?.rx ?? []}
                      dataB={h.net[iface]?.tx ?? []}
                      colorA="#3b82f6"
                      colorB="#10b981"
                      height={48}
                    />
                    <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-2 h-0.5 bg-blue-400 rounded" /> RX
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-2 h-0.5 bg-green-400 rounded" /> TX
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Disk I/O + ZFS row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Disk I/O */}
            {Object.keys(latest.disks).length > 0 && (
              <Card title="Disk I/O" icon={FiHardDrive}>
                <div className="space-y-4">
                  {Object.entries(latest.disks).map(([disk, stats]) => (
                    <div key={disk}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-mono text-gray-300">{disk}</span>
                        <div className="flex gap-3 text-xs">
                          <span className="text-orange-400 flex items-center gap-1">
                            <FiArrowDown size={11} /> {formatBytesPerSec(stats.readRate)}
                          </span>
                          <span className="text-pink-400 flex items-center gap-1">
                            <FiArrowUp size={11} /> {formatBytesPerSec(stats.writeRate)}
                          </span>
                        </div>
                      </div>
                      <DualSparkline
                        dataA={h.disk[disk]?.read ?? []}
                        dataB={h.disk[disk]?.write ?? []}
                        colorA="#f97316"
                        colorB="#ec4899"
                        height={48}
                      />
                      <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-2 h-0.5 bg-orange-400 rounded" /> Read
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-2 h-0.5 bg-pink-400 rounded" /> Write
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* ZFS Pools */}
            {latest.zfs.pools.length > 0 && (
              <Card title="ZFS Pools" icon={FiDatabase}>
                <div className="space-y-3">
                  {latest.zfs.pools.map((pool) => {
                    const usedPct = pct(pool.allocBytes, pool.sizeBytes);
                    const HealthIcon = zfsHealthIcon(pool.health);
                    return (
                      <div key={pool.name} className="bg-gray-700/40 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-sm text-white">{pool.name}</span>
                          <span className={`flex items-center gap-1 text-xs font-medium ${zfsHealthColor(pool.health)}`}>
                            <HealthIcon size={13} />
                            {pool.health}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-600 rounded-full overflow-hidden mb-1.5">
                          <div
                            className={`h-full rounded-full ${usageColor(usedPct)}`}
                            style={{ width: `${Math.min(100, usedPct)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[11px] text-gray-400">
                          <span>{pool.alloc} used</span>
                          <span>{usedPct}%</span>
                          <span>{pool.free} free / {pool.size}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
