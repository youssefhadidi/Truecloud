/** @format */

'use client';

import { FiCheckCircle, FiXCircle, FiUpload } from 'react-icons/fi';

export default function UploadStatus({ uploads }) {
  if (uploads.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-h-96 overflow-y-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white">Uploads</h3>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {uploads.map((upload) => (
            <div key={upload.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  {upload.status === 'uploading' && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>}
                  {upload.status === 'success' && <FiCheckCircle className="text-green-500" size={20} />}
                  {upload.status === 'error' && <FiXCircle className="text-red-500" size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className=" font-medium text-gray-900 dark:text-white truncate">{upload.fileName}</p>
                  {upload.status === 'uploading' && (
                    <>
                      <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div className="bg-indigo-600 h-2 rounded-full transition-all duration-300" style={{ width: `${upload.progress}%` }}></div>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{upload.progress}%</p>
                    </>
                  )}
                  {upload.status === 'success' && <p className="text-xs text-green-600 dark:text-green-400 mt-1">Upload complete</p>}
                  {upload.status === 'error' && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{upload.error || 'Upload failed'}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
