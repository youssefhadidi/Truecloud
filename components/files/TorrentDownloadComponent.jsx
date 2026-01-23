/** @format */

'use client';

import { useState, useRef } from 'react';
import { FiUpload, FiLink, FiPlay } from 'react-icons/fi';
import { useStartTorrentDownload } from '@/lib/api/downloads';

export default function TorrentDownloadComponent({ onDownloadStart }) {
  const [magnetLink, setMagnetLink] = useState('');
  const [torrentFile, setTorrentFile] = useState(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const startDownloadMutation = useStartTorrentDownload();

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.torrent')) {
        setError('Only .torrent files are supported');
        return;
      }
      setTorrentFile(file);
      setError('');
      setMagnetLink('');
    }
  };

  const handleMagnetLinkChange = (e) => {
    const value = e.target.value;
    setMagnetLink(value);
    if (value) {
      setTorrentFile(null);
      setError('');
    }
  };

  const handleStartDownload = async () => {
    if (!torrentFile && !magnetLink) {
      setError('Please select a torrent file or enter a magnet link');
      return;
    }

    setError('');

    try {
      const formData = new FormData();

      if (torrentFile) {
        formData.append('torrentFile', torrentFile);
      } else {
        formData.append('magnetLink', magnetLink);
      }

      const data = await startDownloadMutation.mutateAsync(formData);
      onDownloadStart?.(data);

      // Reset form
      setMagnetLink('');
      setTorrentFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to start download');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Start New Download</h2>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">{error}</div>}

      <div className="space-y-6">
        {/* Torrent File Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <FiUpload className="inline mr-2" />
            Upload Torrent File
          </label>
          <div
            className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".torrent" onChange={handleFileSelect} className="hidden" />
            {torrentFile ? (
              <div>
                <p className="text-sm font-medium text-green-600 dark:text-green-400">{torrentFile.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Selected</p>
              </div>
            ) : (
              <div>
                <FiUpload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-600 dark:text-gray-400">Drag and drop or click to select a .torrent file</p>
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600"></div>
          <span className="text-sm text-gray-500 dark:text-gray-400">OR</span>
          <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600"></div>
        </div>

        {/* Magnet Link */}
        <div>
          <label htmlFor="magnet" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <FiLink className="inline mr-2" />
            Magnet Link
          </label>
          <input
            id="magnet"
            type="text"
            value={magnetLink}
            onChange={handleMagnetLinkChange}
            placeholder="magnet:?xt=urn:btih:..."
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
          />
        </div>

        {/* Start Download Button */}
        <button
          onClick={handleStartDownload}
          disabled={startDownloadMutation.isPending || (!torrentFile && !magnetLink)}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          <FiPlay size={18} />
          {startDownloadMutation.isPending ? 'Starting Download...' : 'Start Download'}
        </button>
      </div>
    </div>
  );
}
