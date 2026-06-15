/** @format */

'use client';

import { use, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  FiLock, FiFile, FiFolder, FiUpload, FiDownload, FiGrid, FiList,
  FiHome, FiChevronRight, FiCheckSquare, FiSquare, FiTrash2,
} from 'react-icons/fi';
import { useSharePage } from '@/hooks/useSharePage';
import { useShareOperations } from '@/hooks/useShareOperations';
import { isImage, isVideo, isAudio, isPdf, isXlsx, is3dFile } from '@/lib/clientFileUtils';
import { useShare, useShareFiles, useGetShareFolders, useDeleteShareFile } from '@/lib/api/publicShares';
import Btn from '@/components/ui/Btn';
import IconBtn from '@/components/ui/IconBtn';
import Divider from '@/components/ui/Divider';
import Spinner from '@/components/ui/Spinner';
import { useTranslation } from '@/components/LanguageProvider';

// Lazy load heavy components
const MediaViewer = lazy(() => import('@/components/files/MediaViewer'));
const ContextMenu = lazy(() => import('@/components/files/ContextMenu'));
const Viewer3D = dynamic(() => import('@/components/files/Viewer3D'), { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-gray-400">Loading 3D viewer...</div> });
const XlsxViewer = dynamic(() => import('@/components/files/XlsxViewer'), { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-gray-400">Loading spreadsheet...</div> });
const ShareGrid = lazy(() => import('@/components/files/ShareGrid'));
const ShareList = lazy(() => import('@/components/files/ShareList'));
const MoveModal = lazy(() => import('@/components/files/MoveModal'));

function LoadingPanel({ label = 'Loading…' }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-3)' }}>
      <Spinner size={28} color="var(--accent)" borderColor="var(--border)" thickness={3} />
      <p style={{ fontSize: 13 }}>{label}</p>
    </div>
  );
}

function EmptyState({ label }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-3)' }}>
      <FiFolder size={36} />
      <p style={{ fontSize: 14, fontWeight: 600 }}>{label}</p>
    </div>
  );
}

export default function SharePage({ params }) {
  const { token } = use(params);
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const [password, setPassword] = useState('');
  const [submittedPassword, setSubmittedPassword] = useState('');
  const [shareFiles, setShareFiles] = useState([]);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [bulkDeleteConfirming, setBulkDeleteConfirming] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Fetch share metadata
  const {
    data: shareResponse,
    isLoading: loading,
    error: shareError,
  } = useShare(token, submittedPassword);

  // Use share hooks for state management
  const shareState = useSharePage(token, shareResponse ? { ...shareResponse, files: shareFiles } : null);

  // Fetch directory listing
  const { data: directoryFiles = null } = useShareFiles(
    token,
    submittedPassword,
    shareState.currentSubPath,
    !!shareResponse && !shareResponse.requiresPassword && !!shareResponse.isDirectory
  );

  useEffect(() => {
    if (directoryFiles) {
      setShareFiles(directoryFiles);
      return;
    }
    if (directoryFiles === null) {
      setShareFiles([]);
    }
  }, [directoryFiles]);

  // Create operations hook
  const operations = useShareOperations({
    token,
    sharePassword: submittedPassword,
    currentSubPath: shareState.currentSubPath,
    setCurrentSubPath: shareState.setCurrentSubPath,
    setPathHistory: shareState.setPathHistory,
    setHistoryIndex: shareState.setHistoryIndex,
    pathHistory: shareState.pathHistory,
    historyIndex: shareState.historyIndex,
    setCreatingFolder: shareState.setCreatingFolder,
    setNewFolderName: shareState.setNewFolderName,
    newFolderName: shareState.newFolderName,
    setDeletingFile: shareState.setDeletingFile,
    setRenamingFile: shareState.setRenamingFile,
    setNewFileName: shareState.setNewFileName,
    setProcessingFile: shareState.setProcessingFile,
    setViewerFile: shareState.setViewerFile,
    viewerFile: shareState.viewerFile,
    viewableFiles: shareState.viewableFiles,
    setContextMenu: shareState.setContextMenu,
    setSelectedContextFile: shareState.setSelectedContextFile,
    setUploadingFiles: shareState.setUploadingFiles,
    addNotification: shareState.addNotification,
    allowEditing: shareResponse?.allowEditing ?? false,
    setIsDragging: shareState.setIsDragging,
  });

  const selectedFileSet = useMemo(() => new Set(shareState.selectedFiles), [shareState.selectedFiles]);

  const toggleSelection = useCallback((file) => {
    const newSelected = shareState.selectedFiles.includes(file.name)
      ? shareState.selectedFiles.filter((name) => name !== file.name)
      : [...shareState.selectedFiles, file.name];
    shareState.setSelectedFiles(newSelected);
  }, [shareState.selectedFiles, shareState.setSelectedFiles]);

  const getShareFoldersMutation = useGetShareFolders();
  const deleteShareFileMutation = useDeleteShareFile();

  // Reset bulk-delete confirmation whenever selection mode is toggled off
  useEffect(() => {
    if (!shareState.selectionMode) setBulkDeleteConfirming(false);
  }, [shareState.selectionMode]);

  const selectableFiles = useMemo(
    () => shareState.sortedFilteredFiles || [],
    [shareState.sortedFilteredFiles],
  );
  const allSelected =
    selectableFiles.length > 0 && shareState.selectedFiles.length >= selectableFiles.length;

  const handleToggleSelectAll = useCallback(() => {
    if (allSelected) {
      shareState.setSelectedFiles([]);
    } else {
      shareState.setSelectedFiles(selectableFiles.map((f) => f.name));
    }
  }, [allSelected, selectableFiles, shareState]);

  const handleBulkDownload = useCallback(async () => {
    const filesToDownload = selectableFiles.filter((f) => shareState.selectedFiles.includes(f.name));
    for (let i = 0; i < filesToDownload.length; i++) {
      await operations.handleDownload(filesToDownload[i]);
      if (i < filesToDownload.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
    shareState.setSelectionMode(false);
    shareState.setSelectedFiles([]);
  }, [selectableFiles, operations, shareState]);

  const handleBulkDelete = useCallback(async () => {
    if (bulkDeleting) return;
    setBulkDeleting(true);
    setBulkDeleteConfirming(false);
    let succeeded = 0;
    let failed = 0;
    for (const name of shareState.selectedFiles) {
      try {
        await deleteShareFileMutation.mutateAsync({
          token,
          sharePassword: submittedPassword,
          fileName: name,
          currentSubPath: shareState.currentSubPath,
        });
        succeeded++;
      } catch {
        failed++;
      }
    }
    setBulkDeleting(false);
    shareState.setSelectionMode(false);
    shareState.setSelectedFiles([]);
    if (failed === 0) shareState.addNotification('success', t('notify.deletedItems', { count: succeeded }));
    else shareState.addNotification('warning', t('notify.deletedSomeFailed', { succeeded, failed }));
  }, [bulkDeleting, deleteShareFileMutation, token, submittedPassword, shareState, t]);

  const fetchShareFolders = useCallback(async (path) => {
    return getShareFoldersMutation.mutateAsync({
      token,
      submittedPassword,
      path,
    });
  }, [getShareFoldersMutation, token, submittedPassword]);

  const handleConfirmMove = async (destinationPath) => {
    if (destinationPath === shareState.currentSubPath) {
      shareState.addNotification('error', t('notify.selectDifferentDestination'));
      return;
    }
    const ok = await operations.moveFiles(shareState.selectedFiles, destinationPath);
    if (ok) {
      shareState.setSelectionMode(false);
      setMoveModalOpen(false);
    }
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    setSubmittedPassword(password);
  };

  // Loading state
  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <LoadingPanel />
      </div>
    );
  }

  // Error state
  if (shareError) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-md)',
            padding: 32,
            textAlign: 'center',
            maxWidth: 420,
            width: '100%',
          }}
        >
          <div
            style={{
              width: 64, height: 64,
              background: 'var(--danger-light)',
              borderRadius: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <FiFile color="var(--danger)" size={32} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{t('sharePage.notFound')}</h2>
          <p style={{ color: 'var(--text-2)', fontSize: 13 }}>{shareError.message}</p>
        </div>
      </div>
    );
  }

  // Password entry form
  if (shareResponse?.requiresPassword) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-md)',
            padding: 32,
            maxWidth: 420,
            width: '100%',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div
              style={{
                width: 64, height: 64,
                background: 'var(--accent-light)',
                borderRadius: 999,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <FiLock color="var(--accent)" size={32} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{t('sharePage.passwordProtected')}</h2>
            <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
              {shareResponse?.isDirectory ? t('sharePage.passwordBodyFolder') : t('sharePage.passwordBodyFile')}
            </p>
            {shareResponse?.fileName && (
              <p style={{ fontSize: 13, color: 'var(--text)', marginTop: 8, fontWeight: 500 }}>{shareResponse.fileName}</p>
            )}
          </div>

          <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label
                htmlFor="password"
                style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 6 }}
              >
                {t('share.password')}
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('share.enterPassword')}
                autoFocus
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
            </div>
            <Btn type="submit" variant="primary" size="lg" style={{ width: '100%' }}>
              {t('sharePage.unlock')}
            </Btn>
          </form>
        </div>
      </div>
    );
  }

  // Single file view
  if (shareResponse && !shareResponse.isDirectory) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16, overflow: 'auto' }}>
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-md)',
            padding: 32,
            maxWidth: 720,
            width: '100%',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{shareResponse.fileName}</h2>
            <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 20 }}>
              {shareResponse.size ? `${Math.round(shareResponse.size / 1024 / 1024)}MB` : t('sharePage.unknownSize')}
            </p>

            {isImage(shareResponse.fileName) && (
              <img
                src={`/api/public/${token}/optimize-image?quality=85&w=1200&h=1200${submittedPassword ? `&pwd=${encodeURIComponent(submittedPassword)}` : ''}`}
                alt={shareResponse.fileName}
                style={{ maxWidth: '100%', maxHeight: 500, margin: '0 auto 20px', objectFit: 'contain', borderRadius: 'var(--r-sm)' }}
              />
            )}

            {(isVideo(shareResponse.fileName) || isAudio(shareResponse.fileName) || isPdf(shareResponse.fileName)) && (
              <div style={{ marginBottom: 20, borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                {isVideo(shareResponse.fileName) && (
                  <video controls style={{ width: '100%', maxHeight: 500 }} src={`/api/public/${token}/stream${submittedPassword ? `?pwd=${encodeURIComponent(submittedPassword)}` : ''}`}>
                    {t('sharePage.videoNotSupported')}
                  </video>
                )}
                {isAudio(shareResponse.fileName) && (
                  <audio controls style={{ width: '100%' }} src={`/api/public/${token}/stream${submittedPassword ? `?pwd=${encodeURIComponent(submittedPassword)}` : ''}`}>
                    {t('sharePage.audioNotSupported')}
                  </audio>
                )}
                {isPdf(shareResponse.fileName) && (
                  <iframe
                    src={`/api/public/${token}/stream${submittedPassword ? `?pwd=${encodeURIComponent(submittedPassword)}` : ''}`}
                    style={{ width: '100%', height: 500, border: 'none' }}
                    title={shareResponse.fileName}
                  />
                )}
              </div>
            )}

            {is3dFile(shareResponse.fileName) && (
              <div style={{ marginBottom: 20, borderRadius: 'var(--r-sm)', overflow: 'hidden', height: 500 }}>
                <Viewer3D fileName={shareResponse.fileName} currentPath="" shareToken={token} sharePassword={submittedPassword} />
              </div>
            )}

            {isXlsx(shareResponse.fileName) && (
              <div style={{ marginBottom: 20, borderRadius: 'var(--r-sm)', overflow: 'hidden', height: 500 }}>
                <XlsxViewer fileName={shareResponse.fileName} currentPath="" shareToken={token} sharePassword={submittedPassword} />
              </div>
            )}

            <Btn
              variant="primary"
              size="lg"
              onClick={() => operations.handleDownload({ name: shareResponse.fileName })}
              style={{ width: '100%' }}
            >
              <FiDownload size={16} />
              {t('common.download')}
            </Btn>
          </div>
        </div>
      </div>
    );
  }

  // Directory view
  if (shareResponse?.isDirectory && directoryFiles) {
    const breadcrumbItems = (shareState.currentSubPath || '').split('/').filter(Boolean);

    return (
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', minHeight: 0, position: 'relative', overflow: 'hidden' }}
        onClick={operations.closeContextMenu}
        onDragOver={operations.handleDragOver}
        onDragLeave={operations.handleDragLeave}
        onDrop={operations.handleDropEvent}
      >
        {/* Drag overlay */}
        {shareState.isDragging && shareResponse.allowEditing && (
          <div className="tc-drag-overlay">
            <div style={{ textAlign: 'center', color: 'var(--accent)' }}>
              <FiUpload size={40} style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 18, fontWeight: 700 }}>{t('files.dropToUpload')}</div>
              <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
                {t('files.filesUploadedToCurrent')}
              </div>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div
          style={{
            minHeight: 52,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text)',
              maxWidth: 280,
            }}
            title={shareResponse.fileName}
          >
            <FiFolder size={14} color="var(--accent)" />
            <span className="tc-truncate" style={{ maxWidth: 220 }}>{shareResponse.fileName}</span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }} className="tc-share-owner">
            {t('sharePage.sharedBy', { owner: shareResponse.ownerUsername })}
          </span>

          <Divider vertical />

          {shareResponse.allowEditing && (
            <>
              <Btn variant="primary" size="sm" onClick={() => fileInputRef.current?.click()}>
                <FiUpload size={13} />
                {t('common.upload')}
              </Btn>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                multiple
                onChange={operations.handleUploadFromInput}
              />
            </>
          )}

          <Btn
            variant={shareState.selectionMode ? 'primary' : 'surface'}
            size="sm"
            onClick={() => shareState.setSelectionMode(!shareState.selectionMode)}
          >
            <FiCheckSquare size={13} />
            {shareState.selectionMode ? t('files.selecting') : t('common.select')}
          </Btn>

          {shareState.selectionMode && (
            <>
              <Divider vertical />
              <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }}>
                {t('files.nSelected', { count: shareState.selectedFiles.length })}
              </span>
              <Btn
                variant="surface"
                size="sm"
                onClick={handleToggleSelectAll}
                disabled={selectableFiles.length === 0 || bulkDeleting}
              >
                {allSelected ? <FiSquare size={13} /> : <FiCheckSquare size={13} />}
                {allSelected ? t('files.deselectAll') : t('files.selectAll')}
              </Btn>
              <IconBtn
                icon={FiDownload}
                title={t('files.downloadSelected')}
                disabled={shareState.selectedFiles.length === 0 || bulkDeleting}
                onClick={handleBulkDownload}
              />
              {shareResponse.allowEditing && (
                <>
                  <IconBtn
                    icon={FiFolder}
                    title={t('files.moveSelected')}
                    disabled={shareState.selectedFiles.length === 0 || bulkDeleting}
                    onClick={() => setMoveModalOpen(true)}
                  />
                  {bulkDeleteConfirming ? (
                    <>
                      <span style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                        {t('files.deleteN', { count: shareState.selectedFiles.length })}
                      </span>
                      <Btn variant="danger" size="sm" onClick={handleBulkDelete} disabled={bulkDeleting}>
                        {bulkDeleting ? t('files.deleting') : t('common.confirm')}
                      </Btn>
                      <Btn variant="ghost" size="sm" onClick={() => setBulkDeleteConfirming(false)} disabled={bulkDeleting}>
                        {t('common.cancel')}
                      </Btn>
                    </>
                  ) : (
                    <IconBtn
                      icon={FiTrash2}
                      title={t('files.deleteSelected')}
                      danger
                      disabled={shareState.selectedFiles.length === 0 || bulkDeleting}
                      onClick={() => setBulkDeleteConfirming(true)}
                    />
                  )}
                </>
              )}
            </>
          )}

          <div style={{ flex: 1 }} />

          <select
            value={shareState.sortBy}
            onChange={(e) => shareState.setSortBy(e.target.value)}
            style={{
              fontFamily: 'inherit',
              fontSize: 12,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
            }}
          >
            <option value="name-asc">{t('files.sortNameAsc')}</option>
            <option value="name-desc">{t('files.sortNameDesc')}</option>
            <option value="date-desc">{t('files.sortDateNew')}</option>
            <option value="date-asc">{t('files.sortDateOld')}</option>
            <option value="size-desc">{t('files.sortSizeBig')}</option>
            <option value="size-asc">{t('files.sortSizeSmall')}</option>
          </select>

          <Divider vertical />

          <div
            style={{
              display: 'flex',
              background: 'var(--surface-2)',
              borderRadius: 'var(--r-sm)',
              padding: 2,
              gap: 2,
            }}
          >
            <IconBtn
              icon={FiGrid}
              title={t('files.gridView')}
              onClick={() => shareState.setViewMode('grid')}
              active={shareState.viewMode === 'grid'}
              width={26}
              height={26}
              size={14}
            />
            <IconBtn
              icon={FiList}
              title={t('files.listView')}
              onClick={() => shareState.setViewMode('list')}
              active={shareState.viewMode === 'list'}
              width={26}
              height={26}
              size={14}
            />
          </div>
        </div>

        {/* Breadcrumb */}
        <div
          style={{
            padding: '0 16px',
            height: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => operations.navigateToBreadcrumb(0)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 13,
              fontWeight: breadcrumbItems.length === 0 ? 600 : 500,
              color: breadcrumbItems.length === 0 ? 'var(--text)' : 'var(--text-3)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 6px',
              borderRadius: 'var(--r-xs)',
              fontFamily: 'inherit',
            }}
          >
            <FiHome size={13} />
            {shareResponse.fileName}
          </button>
          {breadcrumbItems.map((folder, i) => {
            const isLast = i === breadcrumbItems.length - 1;
            return (
              <span key={`${folder}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FiChevronRight size={13} color="var(--text-3)" />
                <button
                  onClick={() => operations.navigateToBreadcrumb(i + 1)}
                  style={{
                    fontSize: 13,
                    fontWeight: isLast ? 600 : 500,
                    color: isLast ? 'var(--text)' : 'var(--text-3)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 6px',
                    borderRadius: 'var(--r-xs)',
                    fontFamily: 'inherit',
                  }}
                >
                  {folder}
                </button>
              </span>
            );
          })}
        </div>

        {/* Files area */}
        <div className="files-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <div
            style={{
              flex: 1,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              boxShadow: 'var(--shadow-sm)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {(shareState.sortedFilteredFiles || []).length === 0 ? (
              <EmptyState label={t('sharePage.thisFolderEmpty')} />
            ) : (
              <Suspense fallback={<LoadingPanel />}>
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  {shareState.viewMode === 'list' && (
                    <div
                      style={{
                        flexShrink: 0,
                        background: 'var(--surface-2)',
                        borderBottom: '1px solid var(--border)',
                      }}
                      className="tc-share-list-header"
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 150px 150px 200px',
                          gap: 16,
                          padding: '10px 24px',
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>{t('common.name')}</div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>{t('common.size')}</div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>{t('common.modified')}</div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase', textAlign: 'right' }}>{t('common.actions')}</div>
                      </div>
                    </div>
                  )}
                  {shareState.viewMode === 'grid' ? (
                    <ShareGrid
                      files={shareState.sortedFilteredFiles || []}
                      token={token}
                      submittedPassword={submittedPassword}
                      currentSubPath={shareState.currentSubPath}
                      allowEditing={shareResponse.allowEditing}
                      deletingFile={shareState.deletingFile}
                      renamingFile={shareState.renamingFile}
                      newFileName={shareState.newFileName}
                      onNewFileNameChange={shareState.setNewFileName}
                      onCancelRename={operations.cancelRename}
                      onConfirmRename={() => operations.confirmRename(shareState.renamingFile, shareState.newFileName)}
                      onCancelDelete={operations.cancelDelete}
                      onConfirmDelete={() => operations.confirmDelete(shareState.deletingFile)}
                      processingFile={shareState.processingFile}
                      onFileClick={(file) => {
                        if (file.isDirectory) {
                          operations.navigateToSubFolder(file.name);
                        } else if (isImage(file.name) || isVideo(file.name) || isAudio(file.name) || isPdf(file.name) || is3dFile(file.name) || isXlsx(file.name)) {
                          operations.openMediaViewer(file);
                        }
                      }}
                      onContextMenu={operations.handleContextMenu}
                      onDownload={operations.handleDownload}
                      onInitiateRename={operations.initiateRename}
                      onInitiateDelete={operations.initiateDelete}
                      onOpenMediaViewer={operations.openMediaViewer}
                      formatFileSize={operations.formatFileSize}
                      selectionMode={shareState.selectionMode}
                      selectedFiles={selectedFileSet}
                      onToggleSelect={toggleSelection}
                    />
                  ) : (
                    <ShareList
                      files={shareState.sortedFilteredFiles || []}
                      allowEditing={shareResponse.allowEditing}
                      deletingFile={shareState.deletingFile}
                      renamingFile={shareState.renamingFile}
                      newFileName={shareState.newFileName}
                      setNewFileName={shareState.setNewFileName}
                      cancelDelete={operations.cancelDelete}
                      confirmDelete={() => operations.confirmDelete(shareState.deletingFile)}
                      cancelRename={operations.cancelRename}
                      confirmRename={() => operations.confirmRename(shareState.renamingFile, shareState.newFileName)}
                      processingFile={shareState.processingFile}
                      onFileClick={(file) => {
                        if (file.isDirectory) {
                          operations.navigateToSubFolder(file.name);
                        } else if (isImage(file.name) || isVideo(file.name) || isAudio(file.name) || isPdf(file.name) || is3dFile(file.name) || isXlsx(file.name)) {
                          operations.openMediaViewer(file);
                        }
                      }}
                      onDownload={operations.handleDownload}
                      onContextMenu={operations.handleContextMenu}
                      onInitiateRename={operations.initiateRename}
                      onInitiateDelete={operations.initiateDelete}
                      onOpenMediaViewer={operations.openMediaViewer}
                      formatFileSize={operations.formatFileSize}
                      selectionMode={shareState.selectionMode}
                      selectedFiles={selectedFileSet}
                      onToggleSelect={toggleSelection}
                    />
                  )}
                </div>
              </Suspense>
            )}
          </div>
        </div>

        {/* Media Viewer Modal */}
        {shareState.viewerFile && (
          <Suspense fallback={null}>
            <MediaViewer
              viewerFile={shareState.viewerFile}
              viewableFiles={shareState.viewableFiles}
              currentPath={shareState.currentSubPath}
              shareToken={token}
              sharePassword={submittedPassword}
              onClose={operations.closeMediaViewer}
              onNavigate={operations.navigateViewer}
              onSelectFile={operations.selectViewerFile}
            />
          </Suspense>
        )}

        {/* Context Menu */}
        {shareState.contextMenu && (
          <Suspense fallback={null}>
            <ContextMenu
              contextMenu={shareState.contextMenu}
              file={shareState.selectedContextFile}
              onClose={operations.closeContextMenu}
              onNavigateToFolder={() => {
                if (shareState.selectedContextFile?.isDirectory) {
                  operations.navigateToSubFolder(shareState.selectedContextFile.name);
                }
                operations.closeContextMenu();
              }}
              onDownload={() => {
                if (shareState.selectedContextFile) {
                  operations.handleDownload(shareState.selectedContextFile);
                }
                operations.closeContextMenu();
              }}
              onView={() => {
                if (shareState.selectedContextFile) {
                  operations.openMediaViewer(shareState.selectedContextFile);
                }
                operations.closeContextMenu();
              }}
              onRename={
                shareResponse.allowEditing
                  ? () => {
                      if (shareState.selectedContextFile) {
                        operations.initiateRename(shareState.selectedContextFile);
                      }
                      operations.closeContextMenu();
                    }
                  : undefined
              }
              onDelete={
                shareResponse.allowEditing
                  ? () => {
                      if (shareState.selectedContextFile) {
                        operations.initiateDelete(shareState.selectedContextFile);
                      }
                      operations.closeContextMenu();
                    }
                  : undefined
              }
            />
          </Suspense>
        )}

        {/* Move Modal */}
        {moveModalOpen && (
          <Suspense fallback={null}>
            <MoveModal
              open={moveModalOpen}
              title={t('sharePage.moveNItems', { count: shareState.selectedFiles.length })}
              initialPath={shareState.currentSubPath}
              fetchFolders={fetchShareFolders}
              onConfirm={handleConfirmMove}
              onClose={() => setMoveModalOpen(false)}
            />
          </Suspense>
        )}

        {/* Upload Progress */}
        {shareState.uploadingFiles.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              right: 24,
              background: 'var(--surface)',
              borderRadius: 'var(--r-md)',
              boxShadow: 'var(--shadow-lg)',
              padding: 20,
              width: 320,
              border: '1px solid var(--border)',
              zIndex: 40,
            }}
          >
            <h3 style={{ fontWeight: 600, marginBottom: 12, color: 'var(--text)', fontSize: 14 }}>
              {t('sharePage.uploadingN', { count: shareState.uploadingFiles.length })}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 192, overflow: 'auto' }}>
              {shareState.uploadingFiles.map((file) => (
                <div key={file.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  {file.status === 'uploading' && <Spinner size={14} color="var(--accent)" borderColor="var(--border)" thickness={2} />}
                  {file.status === 'success' && <span style={{ color: 'var(--success)' }}>✓</span>}
                  {file.status === 'error' && <span style={{ color: 'var(--danger)' }}>✗</span>}
                  <span className="tc-truncate" style={{ color: 'var(--text-2)' }}>{file.fileName}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <style jsx>{`
          .tc-share-owner { display: none; }
          @media (min-width: 640px) {
            .tc-share-owner { display: inline; }
          }
        `}</style>
      </div>
    );
  }

  return null;
}
