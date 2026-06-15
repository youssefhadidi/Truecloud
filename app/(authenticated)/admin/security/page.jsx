/** @format */

'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  FiLock, FiX, FiShield, FiPlus, FiFolder, FiChevronRight, FiHome, FiArrowUp,
  FiAlertTriangle,
} from 'react-icons/fi';
import {
  useFolderLocks,
  useSetFolderLock,
  useChangeFolderLockPin,
  useDeleteFolderLock,
  useBrowseLockableFolders,
} from '@/lib/api/folderLocks';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTranslation } from '@/components/LanguageProvider';

function PinInput({ value, onChange, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={4}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      className="w-full text-center text-3xl tracking-[0.5em] font-mono px-3 py-3 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700 text-white"
      placeholder="••••"
    />
  );
}

function PinSetModal({ title, subtitle, submitLabel, onSubmit, onClose, busy }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin.length !== 4) return setError(t('adminSecurity.pinMustBe4'));
    if (pin !== confirm) return setError(t('adminSecurity.pinsDoNotMatch'));
    setError('');
    onSubmit(pin);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <FiX size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {subtitle && (
            <div className="text-sm text-gray-400 break-all">
              {t('adminSecurity.folderLabel')} <span className="font-mono text-gray-200">{subtitle}</span>
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-300 mb-2">{t('adminSecurity.newPin')}</label>
            <PinInput value={pin} onChange={setPin} autoFocus />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-2">{t('adminSecurity.confirmPin')}</label>
            <PinInput value={confirm} onChange={setConfirm} />
          </div>
          {error && <div className="text-red-400 text-sm">{error}</div>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700">
              {t('adminSecurity.cancel')}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? t('adminSecurity.saving') : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmRemoveModal({ folder, onConfirm, onClose, busy }) {
  const { t } = useTranslation();
  const bodyParts = t('adminSecurity.removeLockBody').split('{folder}');
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{t('adminSecurity.removeLockTitle')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <FiX size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-300">
            {bodyParts[0]}
            <span className="font-mono text-white break-all">{folder}</span>
            {bodyParts[1]}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700">
              {t('adminSecurity.cancel')}
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? t('adminSecurity.removing') : t('adminSecurity.removeLock')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Folder picker that lets the admin walk the tree and choose a path to lock.
// Folders that would violate the no-nested-locks rule are shown disabled
// (with a reason) instead of hidden — admins should see why a path is
// off-limits rather than have it silently missing.
function PickFolderModal({ onPicked, onClose }) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const { data, isFetching } = useBrowseLockableFolders(path);

  const breadcrumb = useMemo(() => (path ? path.split('/') : []), [path]);

  const current = data?.current;
  const canLockHere =
    current?.isLockable &&
    !current?.isLocked &&
    !current?.hasAncestorLock &&
    !current?.hasDescendantLock &&
    path.length > 0;

  const lockHereReason = !path
    ? t('adminSecurity.reasonPickFirst')
    : !current?.isLockable
      ? t('adminSecurity.reasonNotLockable')
      : current?.isLocked
        ? t('adminSecurity.reasonAlreadyLocked')
        : current?.hasAncestorLock
          ? t('adminSecurity.reasonHasAncestor', { path: current.ancestorLockPath })
          : current?.hasDescendantLock
            ? t('adminSecurity.reasonHasDescendant', { path: current.descendantLockPath })
            : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{t('adminSecurity.pickFolderTitle')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <FiX size={20} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {/* Breadcrumb */}
          <div className="flex items-center flex-wrap gap-1 text-sm">
            <button
              onClick={() => setPath('')}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded ${path === '' ? 'text-white bg-gray-700' : 'text-gray-400 hover:text-white'}`}
            >
              <FiHome size={13} /> {t('adminSecurity.root')}
            </button>
            {breadcrumb.map((part, i) => {
              const subPath = breadcrumb.slice(0, i + 1).join('/');
              const isLast = i === breadcrumb.length - 1;
              return (
                <span key={`${part}-${i}`} className="inline-flex items-center gap-1">
                  <FiChevronRight size={12} className="text-gray-500" />
                  <button
                    onClick={() => setPath(subPath)}
                    className={`px-2 py-1 rounded ${isLast ? 'text-white bg-gray-700' : 'text-gray-400 hover:text-white'}`}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}
              disabled={!path}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-600 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40"
            >
              <FiArrowUp size={13} /> {t('adminSecurity.upOneLevel')}
            </button>
            <button
              onClick={() => onPicked(path)}
              disabled={!canLockHere}
              title={lockHereReason || ''}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('adminSecurity.lockThisFolder')}
            </button>
          </div>
          {lockHereReason && path && (
            <div className="flex items-start gap-2 text-xs text-amber-400">
              <FiAlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{lockHereReason}</span>
            </div>
          )}

          {/* Folder list */}
          <div className="border border-gray-700 rounded bg-gray-900/40 max-h-80 overflow-y-auto">
            {isFetching ? (
              <div className="p-6 text-center text-sm text-gray-400">{t('adminSecurity.pickerLoading')}</div>
            ) : !data?.folders?.length ? (
              <div className="p-6 text-center text-sm text-gray-400">{t('adminSecurity.noSubFolders')}</div>
            ) : (
              data.folders.map((f) => {
                const disabledReason = f.hasAncestorLock
                  ? t('adminSecurity.insideLockedFolder')
                  : null;
                // Folders WITH ancestor locks can't be navigated (admin would
                // need the PIN to see their contents). All others are navigable;
                // locked folders themselves are navigable (to remove the lock
                // or to manage what's inside via the actions row, just not via
                // this picker).
                const navigable = !f.hasAncestorLock;
                return (
                  <div
                    key={f.path}
                    className={`flex items-center gap-2 px-3 py-2 border-b border-gray-700 last:border-0 ${navigable ? 'hover:bg-gray-700/50 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                    onClick={() => navigable && setPath(f.path)}
                  >
                    <FiFolder
                      size={16}
                      className={f.isLocked ? 'text-amber-400' : 'text-blue-400'}
                    />
                    <span className="text-sm text-white flex-1 truncate">{f.name}</span>
                    {f.isLocked && (
                      <span className="text-xs bg-amber-900/50 text-amber-200 px-2 py-0.5 rounded">
                        {t('adminSecurity.lockedBadge')}
                      </span>
                    )}
                    {f.hasDescendantLock && !f.isLocked && (
                      <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                        {t('adminSecurity.containsLocks')}
                      </span>
                    )}
                    {disabledReason ? (
                      <span className="text-xs text-gray-500" title={disabledReason}>
                        —
                      </span>
                    ) : (
                      <FiChevronRight size={14} className="text-gray-500" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const { data: locks = [], isLoading: locksLoading } = useFolderLocks();
  const setLock = useSetFolderLock();
  const changePin = useChangeFolderLockPin();
  const deleteLock = useDeleteFolderLock();

  const [pickingPath, setPickingPath] = useState(false);
  const [pendingNewLock, setPendingNewLock] = useState(null); // path being locked
  const [changingPinFor, setChangingPinFor] = useState(null);
  const [removing, setRemoving] = useState(null);

  const handlePicked = useCallback((path) => {
    setPickingPath(false);
    setPendingNewLock(path);
  }, []);

  const handleSubmitNewLock = useCallback(
    async (pin) => {
      try {
        await setLock.mutateAsync({ path: pendingNewLock, pin });
        addNotification('success', t('adminSecurity.nowLocked', { path: pendingNewLock }));
        setPendingNewLock(null);
      } catch (err) {
        addNotification('error', err.response?.data?.error || t('adminSecurity.setLockFailed'));
      }
    },
    [pendingNewLock, setLock, addNotification, t],
  );

  const handleSubmitChangePin = useCallback(
    async (pin) => {
      try {
        await changePin.mutateAsync({ path: changingPinFor, pin });
        addNotification('success', t('adminSecurity.pinUpdatedFor', { path: changingPinFor }));
        setChangingPinFor(null);
      } catch (err) {
        addNotification('error', err.response?.data?.error || t('adminSecurity.changePinFailed'));
      }
    },
    [changingPinFor, changePin, addNotification, t],
  );

  const handleRemove = useCallback(async () => {
    try {
      await deleteLock.mutateAsync(removing);
      addNotification('success', t('adminSecurity.lockRemovedFrom', { path: removing }));
      setRemoving(null);
    } catch (err) {
      addNotification('error', err.response?.data?.error || t('adminSecurity.removeLockFailed'));
    }
  }, [removing, deleteLock, addNotification, t]);

  if (locksLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">{t('adminSecurity.loading')}</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-2 gap-4">
        <div className="flex items-center gap-3">
          <FiShield className="text-blue-400" size={28} />
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">{t('adminSecurity.title')}</h1>
        </div>
        <button
          onClick={() => setPickingPath(true)}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <FiPlus size={16} /> {t('adminSecurity.addLock')}
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-6 max-w-2xl">
        {t('adminSecurity.intro')}
      </p>

      <div className="bg-gray-800 rounded-lg shadow">
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-700">
          <h2 className="text-base sm:text-lg font-semibold text-white">
            {t('adminSecurity.activeLocksN', { count: locks.length })}
          </h2>
        </div>

        {locks.length === 0 ? (
          <div className="px-4 sm:px-6 py-8 text-sm text-gray-400 text-center">
            {t('adminSecurity.noLocks').split('{addLock}').flatMap((part, i) =>
              i === 0 ? [part] : [<span key={i} className="text-blue-400">{t('adminSecurity.addLock')}</span>, part],
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {locks.map((lock) => (
              <div
                key={lock.id}
                className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <FiLock className="text-amber-400 flex-shrink-0" size={20} />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-white text-sm break-all">{lock.path}</div>
                  <div className="text-xs text-gray-400">
                    {t('adminSecurity.locked')}
                    {lock.createdByUsername && <>{t('adminSecurity.lockedBy', { user: lock.createdByUsername })}</>}
                    {lock.updatedAt && (
                      <>{t('adminSecurity.updatedOn', { date: new Date(lock.updatedAt).toLocaleDateString() })}</>
                    )}
                    {lock.pinFailures > 0 && (
                      <> · <span className="text-amber-400">{t('adminSecurity.recentMisses', { count: lock.pinFailures })}</span></>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setChangingPinFor(lock.path)}
                    className="px-3 py-1.5 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700"
                  >
                    {t('adminSecurity.changePin')}
                  </button>
                  <button
                    onClick={() => setRemoving(lock.path)}
                    className="px-3 py-1.5 text-sm bg-red-900/40 text-red-300 border border-red-900 rounded-lg hover:bg-red-900/60"
                  >
                    {t('adminSecurity.remove')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pickingPath && (
        <PickFolderModal onPicked={handlePicked} onClose={() => setPickingPath(false)} />
      )}
      {pendingNewLock && (
        <PinSetModal
          title={t('adminSecurity.setPinTitle')}
          subtitle={pendingNewLock}
          submitLabel={t('adminSecurity.lockFolder')}
          busy={setLock.isPending}
          onClose={() => setPendingNewLock(null)}
          onSubmit={handleSubmitNewLock}
        />
      )}
      {changingPinFor && (
        <PinSetModal
          title={t('adminSecurity.changePinTitle')}
          subtitle={changingPinFor}
          submitLabel={t('adminSecurity.updatePin')}
          busy={changePin.isPending}
          onClose={() => setChangingPinFor(null)}
          onSubmit={handleSubmitChangePin}
        />
      )}
      {removing && (
        <ConfirmRemoveModal
          folder={removing}
          busy={deleteLock.isPending}
          onClose={() => setRemoving(null)}
          onConfirm={handleRemove}
        />
      )}
    </>
  );
}
