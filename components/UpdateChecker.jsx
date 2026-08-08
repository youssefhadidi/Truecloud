/** @format */

'use client';

import { useState, useEffect } from 'react';
import { FiX, FiRefreshCw } from 'react-icons/fi';
import Confirm from '@/components/Confirm';
import Btn from '@/components/ui/Btn';
import IconBtn from '@/components/ui/IconBtn';
import { useCheckUpdates, useRunUpdate } from '@/lib/api/system';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useWebSocket } from '@/contexts/WebSocketContext';

const DISMISSED_VERSION_KEY = 'update_dismissed_version';
const DISMISSED_TORRENT_KEY = 'update_dismissed_torrent_service';

export default function UpdateChecker() {
  const { data: updateInfo } = useCheckUpdates(true);
  const runUpdateMutation = useRunUpdate();
  const [showConfirm, setShowConfirm] = useState(null); // null | 'app' | 'torrent-service'
  const [dismissed, setDismissed] = useState(false);
  const [torrentDismissed, setTorrentDismissed] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const { subscribe } = useWebSocket();
  const { addNotification } = useNotifications();

  const torrentService = updateInfo?.torrentService;
  // torrent-service pins its package.json version, so dismissal is keyed on the
  // remote commit instead.
  const torrentMarker = torrentService?.latestCommit || null;

  const showAppUpdate = Boolean(updateInfo?.hasUpdate) && !dismissed;
  const showTorrentUpdate = Boolean(torrentService?.hasUpdate) && !torrentDismissed;

  useEffect(() => {
    if (updateInfo?.latestVersion) {
      const dismissedVersion = localStorage.getItem(DISMISSED_VERSION_KEY);
      setDismissed(dismissedVersion === updateInfo.latestVersion);
    }
  }, [updateInfo]);

  useEffect(() => {
    if (torrentMarker) {
      setTorrentDismissed(localStorage.getItem(DISMISSED_TORRENT_KEY) === torrentMarker);
    }
  }, [torrentMarker]);

  useEffect(() => {
    const unsubscribe = subscribe('update-status', (message) => {
      try { setUpdateStatus(message.payload); } catch {}
    });
    return unsubscribe;
  }, [subscribe]);

  const handleDismiss = () => {
    if (showAppUpdate) {
      localStorage.setItem(DISMISSED_VERSION_KEY, updateInfo.latestVersion);
      setDismissed(true);
    }
    if (showTorrentUpdate && torrentMarker) {
      localStorage.setItem(DISMISSED_TORRENT_KEY, torrentMarker);
      setTorrentDismissed(true);
    }
  };

  const handleUpdate = async (target) => {
    try {
      const result = await runUpdateMutation.mutateAsync(target);
      if (result.success) {
        addNotification(
          'success',
          target === 'torrent-service'
            ? 'Torrent service update started…'
            : 'Update started. The server will restart shortly…'
        );
        setShowConfirm(null);
      }
    } catch (error) {
      addNotification('error', 'Failed to start update: ' + (error.response?.data?.error || error.message));
      setShowConfirm(null);
    }
  };

  if (!showAppUpdate && !showTorrentUpdate) return null;

  return (
    <div
      className="tc-anim-slide"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 5500,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 'var(--r-md)',
        boxShadow: 'var(--shadow-xl)',
        padding: 14,
        maxWidth: 360,
        width: 'calc(100vw - 32px)',
      }}
    >
      <div style={{ position: 'absolute', top: 6, right: 6 }}>
        <IconBtn icon={FiX} title="Dismiss" onClick={handleDismiss} width={26} height={26} size={13} />
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingRight: 24 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--r-sm)',
            background: 'var(--accent-light)',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <FiRefreshCw size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Update available</div>
          {showAppUpdate && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              Truecloud {updateInfo.currentVersion} → {updateInfo.latestVersion}
            </div>
          )}
          {showTorrentUpdate && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              Torrent service · {torrentService.commitsBehind ?? 'new'} new commit
              {torrentService.commitsBehind === 1 ? '' : 's'}
            </div>
          )}

          {updateStatus?.isRunning && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                background: 'var(--accent-light)',
                border: '1px solid color-mix(in oklab, var(--accent) 30%, transparent)',
                borderRadius: 'var(--r-sm)',
                fontSize: 11,
                color: 'var(--accent)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: 'var(--accent)',
                    animation: 'tc-pulse 1.2s ease infinite',
                  }}
                />
                <span style={{ fontWeight: 600 }}>
                  {updateStatus.targetLabel ? `${updateStatus.targetLabel} update in progress…` : 'Update in progress…'}
                </span>
              </div>
              <div>
                Step {updateStatus.steps.filter((s) => s.status === 'completed').length +
                  (updateStatus.steps.findIndex((s) => s.status === 'running') >= 0 ? 1 : 0)}
                /{updateStatus.steps.length}
              </div>
            </div>
          )}

          {updateInfo.releaseNotes && (
            <details style={{ marginTop: 8, fontSize: 11, color: 'var(--text-2)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--accent)' }}>Release notes</summary>
              <div
                style={{
                  marginTop: 6,
                  padding: 8,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)',
                  maxHeight: 160,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {updateInfo.releaseNotes}
              </div>
            </details>
          )}

          {/* The app and torrent-service are separate repos, so each gets its
              own button — updating one leaves the other untouched. */}
          <div style={{ marginTop: 10 }}>
            {showConfirm ? (
              <Confirm
                message={
                  showConfirm === 'torrent-service'
                    ? 'Update the torrent service? Active torrent downloads will be interrupted.'
                    : 'Update? The server will restart automatically.'
                }
                onCancel={() => setShowConfirm(null)}
                onConfirm={() => handleUpdate(showConfirm)}
                isLoading={runUpdateMutation.isPending}
              />
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {showAppUpdate && (
                  <Btn
                    variant="primary"
                    size="sm"
                    disabled={runUpdateMutation.isPending}
                    onClick={() => setShowConfirm('app')}
                  >
                    {runUpdateMutation.isPending ? 'Updating…' : 'Update now'}
                  </Btn>
                )}
                {showTorrentUpdate && (
                  <Btn
                    variant={showAppUpdate ? 'outline' : 'primary'}
                    size="sm"
                    disabled={runUpdateMutation.isPending}
                    onClick={() => setShowConfirm('torrent-service')}
                  >
                    {runUpdateMutation.isPending ? 'Updating…' : 'Update torrent service'}
                  </Btn>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
