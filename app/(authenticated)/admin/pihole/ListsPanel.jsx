/** @format */

'use client';

import { useState } from 'react';
import { FiPlus, FiTrash2, FiDownloadCloud } from 'react-icons/fi';
import { useTranslation } from '@/components/LanguageProvider';
import { useNotifications } from '@/contexts/NotificationsContext';
import {
  usePiholeLists,
  useAddPiholeList,
  useUpdatePiholeList,
  useDeletePiholeList,
  usePiholeDomains,
  useAddPiholeDomain,
  useDeletePiholeDomain,
  useRunGravity,
} from '@/lib/api/pihole';
import {
  SectionCard,
  EmptyRow,
  formatNumber,
  errorMessage,
  inputClass,
  iconButtonDanger,
  buttonPrimary,
  buttonSecondary,
} from './ui';

const DOMAIN_SECTIONS = [
  { type: 'deny', kind: 'exact', titleKey: 'adminPihole.denyExactTitle' },
  { type: 'deny', kind: 'regex', titleKey: 'adminPihole.denyRegexTitle' },
  { type: 'allow', kind: 'exact', titleKey: 'adminPihole.allowExactTitle' },
  { type: 'allow', kind: 'regex', titleKey: 'adminPihole.allowRegexTitle' },
];

export default function ListsPanel() {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();

  const { data, isLoading } = usePiholeLists('block');
  const addList = useAddPiholeList();
  const updateList = useUpdatePiholeList();
  const deleteList = useDeletePiholeList();
  const runGravity = useRunGravity();

  const [address, setAddress] = useState('');
  const [comment, setComment] = useState('');

  const lists = data?.lists ?? [];

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!address.trim()) return;
    try {
      await addList.mutateAsync({ address: address.trim(), type: 'block', comment: comment.trim() });
      setAddress('');
      setComment('');
      addNotification('success', t('adminPihole.listAdded'));
    } catch (err) {
      addNotification('error', errorMessage(err, t('adminPihole.listAddFailed')));
    }
  };

  const handleToggle = async (list) => {
    try {
      // PUT replaces the entry, so carry the fields we are not changing
      // through or Pi-hole drops the comment and group membership.
      await updateList.mutateAsync({
        address: list.address,
        type: 'block',
        enabled: !list.enabled,
        comment: list.comment ?? '',
        groups: list.groups ?? [0],
      });
      addNotification('success', t('adminPihole.listUpdated'));
    } catch (err) {
      addNotification('error', errorMessage(err, t('adminPihole.listUpdateFailed')));
    }
  };

  const handleDelete = async (list) => {
    if (!window.confirm(t('adminPihole.removeListConfirm', { address: list.address }))) return;
    try {
      await deleteList.mutateAsync({ address: list.address, type: 'block' });
      addNotification('success', t('adminPihole.listRemoved'));
    } catch (err) {
      addNotification('error', errorMessage(err, t('adminPihole.listRemoveFailed')));
    }
  };

  const handleGravity = async () => {
    try {
      await runGravity.mutateAsync();
      addNotification('success', t('adminPihole.gravityStarted'));
    } catch (err) {
      addNotification('error', errorMessage(err, t('adminPihole.gravityFailed')));
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title={t('adminPihole.adlistsTitle')}
        action={
          <button type="button" onClick={handleGravity} disabled={runGravity.isPending} className={buttonSecondary}>
            <FiDownloadCloud size={14} />
            <span className="hidden sm:inline">{t('adminPihole.updateGravity')}</span>
          </button>
        }
      >
        <p className="text-sm text-gray-400">{t('adminPihole.adlistsIntro')}</p>

        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t('adminPihole.addListPlaceholder')}
            className={`${inputClass} sm:flex-[2]`}
            required
          />
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('adminPihole.commentPlaceholder')}
            className={`${inputClass} sm:flex-1`}
          />
          <button type="submit" disabled={addList.isPending || !address.trim()} className={buttonPrimary}>
            <FiPlus size={14} />
            {t('adminPihole.addListAction')}
          </button>
        </form>

        {isLoading ? (
          <div className="text-gray-400 text-sm">{t('adminPihole.loading')}</div>
        ) : lists.length === 0 ? (
          <EmptyRow>{t('adminPihole.noLists')}</EmptyRow>
        ) : (
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-gray-700/60">
            {/* Phones get stacked cards: the table below needs 640px, which on a
                narrow screen is a sideways scroll under the thumb. */}
            <ul className="divide-y divide-gray-700/60 md:hidden">
              {lists.map((list) => (
                <li key={list.address} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm text-gray-200 break-all">{list.address}</span>
                    <RemoveButton
                      onClick={() => handleDelete(list)}
                      disabled={deleteList.isPending}
                      label={t('adminPihole.remove')}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <ListToggle list={list} onToggle={handleToggle} pending={updateList.isPending} t={t} />
                    <span className="text-xs text-gray-500 tabular-nums">
                      {t('adminPihole.colDomainCount')}: {formatNumber(list.number)}
                    </span>
                  </div>
                  {list.comment && <p className="text-xs text-gray-500 break-words">{list.comment}</p>}
                </li>
              ))}
            </ul>

            <table className="hidden md:table w-full text-sm min-w-[640px]">
              <thead className="sticky top-0 z-10 bg-gray-800">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-700">
                  <th className="px-3 py-2 font-semibold">{t('adminPihole.colAddress')}</th>
                  <th className="px-3 py-2 font-semibold w-28">{t('adminPihole.colDomainCount')}</th>
                  <th className="px-3 py-2 font-semibold w-28">{t('adminPihole.colStatus')}</th>
                  <th className="px-3 py-2 font-semibold">{t('adminPihole.colComment')}</th>
                  <th className="px-3 py-2 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/60">
                {lists.map((list) => (
                  <tr key={list.address} className="text-gray-300">
                    <td className="px-3 py-2.5 max-w-md">
                      <span className="block truncate" title={list.address}>
                        {list.address}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{formatNumber(list.number)}</td>
                    <td className="px-3 py-2.5">
                      <ListToggle list={list} onToggle={handleToggle} pending={updateList.isPending} t={t} />
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 max-w-xs">
                      <span className="block truncate">{list.comment || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end">
                        <RemoveButton
                          onClick={() => handleDelete(list)}
                          disabled={deleteList.isPending}
                          label={t('adminPihole.remove')}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {DOMAIN_SECTIONS.map((section) => (
          <DomainSection key={`${section.type}-${section.kind}`} {...section} />
        ))}
      </div>
    </div>
  );
}

function DomainSection({ type, kind, titleKey }) {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const { data, isLoading } = usePiholeDomains(type, kind);
  const addDomain = useAddPiholeDomain();
  const deleteDomain = useDeletePiholeDomain();

  const [value, setValue] = useState('');
  const domains = data?.domains ?? [];

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    try {
      await addDomain.mutateAsync({ domain: value.trim(), type, kind });
      setValue('');
      addNotification('success', t('adminPihole.domainAdded'));
    } catch (err) {
      addNotification('error', errorMessage(err, t('adminPihole.domainAddFailed')));
    }
  };

  const handleDelete = async (domain) => {
    if (!window.confirm(t('adminPihole.removeDomainConfirm', { domain }))) return;
    try {
      await deleteDomain.mutateAsync({ domain, type, kind });
      addNotification('success', t('adminPihole.domainRemoved'));
    } catch (err) {
      addNotification('error', errorMessage(err, t('adminPihole.domainRemoveFailed')));
    }
  };

  return (
    <SectionCard title={t(titleKey)}>
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={kind === 'regex' ? t('adminPihole.regexPlaceholder') : t('adminPihole.domainPlaceholder')}
          className={inputClass}
          required
        />
        <button type="submit" disabled={addDomain.isPending || !value.trim()} className={buttonPrimary}>
          <FiPlus size={14} />
          <span className="hidden sm:inline">{t('adminPihole.add')}</span>
        </button>
      </form>

      {isLoading ? (
        <div className="text-gray-400 text-sm">{t('adminPihole.loading')}</div>
      ) : domains.length === 0 ? (
        <EmptyRow>{t('adminPihole.noEntries')}</EmptyRow>
      ) : (
        <ul className="divide-y divide-gray-700/60">
          {domains.map((entry) => (
            <li key={entry.domain} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-gray-300 font-mono truncate" title={entry.domain}>
                {entry.domain}
              </span>
              <RemoveButton
                onClick={() => handleDelete(entry.domain)}
                disabled={deleteDomain.isPending}
                label={t('adminPihole.remove')}
              />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* The adlist rows render twice — as phone cards and as table rows — so their
   two interactive bits live here rather than being written out in both. */

function ListToggle({ list, onToggle, pending, t }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(list.enabled)}
      onClick={() => onToggle(list)}
      disabled={pending}
      className={`px-2.5 py-1 text-xs font-semibold rounded-full transition-colors disabled:opacity-50 ${
        list.enabled
          ? 'bg-green-900 text-green-200 hover:bg-green-800'
          : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
      }`}
    >
      {list.enabled ? t('adminPihole.enabled') : t('adminPihole.disabled')}
    </button>
  );
}

function RemoveButton({ onClick, disabled, label }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={iconButtonDanger} aria-label={label}>
      <FiTrash2 size={16} />
    </button>
  );
}
