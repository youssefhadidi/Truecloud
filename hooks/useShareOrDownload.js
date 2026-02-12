/** @format */

import { useCallback } from 'react';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTransfersDispatch } from '@/lib/redux/hooks';

/**
 * Hook for handling file downloads with Web Share API fallback
 * - Uses Web Share API (navigator.share) if available and device supports it
 * - Falls back to direct browser download without fetching
 * - Works on iOS, Android, and Desktop
 */
export function useShareOrDownload() {
  const { addNotification } = useNotifications();
  const { addTransfer, updateTransfer, removeTransfer } = useTransfersDispatch();

  const handleShareOrDownload = useCallback(
    async (fileUrl, fileName) => {
      const downloadId = Date.now() + Math.random();

      try {
        // Add download to transfer list
        addTransfer({
          id: downloadId,
          fileName,
          progress: 0,
          status: 'downloading',
          type: 'download',
        });

        // Check if Web Share API is available on this device
        const hasShareAPI = !!navigator.share;

        if (hasShareAPI) {
          // Only fetch if we're going to use Web Share API
          try {
            const response = await fetch(fileUrl);
            if (!response.ok) {
              throw new Error(`Failed to fetch file: ${response.status}`);
            }

            // Validate Content-Type - reject JSON/XML error responses
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json') || contentType.includes('application/xml') || contentType.includes('text/xml')) {
              throw new Error(`Invalid content type: ${contentType}. Server may have returned an error response.`);
            }

            // For large files, ensure we have a reasonable size
            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength, 10) < 1024) {
              // Likely an error response, not the actual file
              throw new Error('Response size too small, likely an error response');
            }

            const blob = await fetchWithProgress(response, downloadId, updateTransfer);
            const file = new File([blob], fileName, { type: blob.type });

            // Check if this device can share files
            // Note: canShare is not available in all browsers, so we wrap in try-catch
            if (navigator.canShare && !navigator.canShare({ files: [file] })) {
              // Device doesn't support file sharing, fall back to direct browser download
              performDirectDownload(fileUrl, fileName);
              updateTransfer(downloadId, { status: 'success', progress: 100 });
              setTimeout(() => removeTransfer(downloadId), 3000);
            } else {
              // Attempt to share
              try {
                await navigator.share({
                  files: [file],
                });
                // Share was successful
                updateTransfer(downloadId, { status: 'success', progress: 100 });
                setTimeout(() => {
                  removeTransfer(downloadId);
                }, 3000);
              } catch (shareError) {
                // Share API cancelled by user, fall back to direct download
                if (shareError.name !== 'AbortError') {
                  console.warn('Share failed, falling back to download:', shareError);
                }
                performDirectDownload(fileUrl, fileName);
                updateTransfer(downloadId, { status: 'success', progress: 100 });
                setTimeout(() => removeTransfer(downloadId), 3000);
              }
            }
          } catch (fetchError) {
            console.error('Failed to fetch file for sharing:', fetchError);
            addNotification('error', `Failed to download ${fileName}`);
            updateTransfer(downloadId, { status: 'error', error: fetchError.message });
          }
        } else {
          // Web Share API not available, use direct browser download (no fetch needed)
          performDirectDownload(fileUrl, fileName);
          updateTransfer(downloadId, { status: 'success', progress: 100 });
          setTimeout(() => removeTransfer(downloadId), 3000);
        }
      } catch (error) {
        console.error('Download/share error:', error);
        addNotification('error', `Failed to download ${fileName}`);
        updateTransfer(downloadId, { status: 'error', error: error.message });
      }
    },
    [addNotification, addTransfer, updateTransfer, removeTransfer]
  );

  return { handleShareOrDownload };
}

/**
 * Fetch blob while tracking download progress
 * Reports progress as chunks are downloaded
 */
async function fetchWithProgress(response, downloadId, dispatchUpdateTransfer) {
  const contentLength = response.headers.get('content-length');
  const mimeType = response.headers.get('content-type') || 'application/octet-stream';
  const total = parseInt(contentLength, 10);

  if (!dispatchUpdateTransfer || !contentLength) {
    // No progress tracking, just return the blob
    return response.blob();
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      chunks.push(value);
      received += value.length;

      // Calculate and report progress percentage
      const progress = Math.round((received / total) * 100);
      dispatchUpdateTransfer(downloadId, { progress });
    }
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks, { type: mimeType });
}

/**
 * Perform direct browser download via link (no blob fetching)
 * Browser handles the download, respects Content-Disposition headers
 */
function performDirectDownload(fileUrl, fileName) {
  const link = document.createElement('a');
  link.href = fileUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
