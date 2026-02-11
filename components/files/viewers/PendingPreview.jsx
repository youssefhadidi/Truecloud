/** @format */

import { FiBox, FiVideo, FiMusic, FiFileText, FiFile, FiImage } from 'react-icons/fi';
import { getFileType } from '@/lib/getFileType';
import { useShareAwareThumbnail } from '../hooks/useShareAwareThumbnail';

export function PendingPreview({ file, currentPath, compact = false, shareToken, sharePassword }) {
  const fileType = getFileType(file);

  const canThumbnail = fileType === 'image' || fileType === 'video' || fileType === 'pdf';
  const { data: thumbnailData } = useShareAwareThumbnail(file, currentPath, canThumbnail, shareToken, sharePassword);
  const hasThumbnail = canThumbnail && thumbnailData?.data;

  const iconSize = compact ? 28 : 64;
  const iconMap = {
    '3d': <FiBox size={iconSize} className="text-orange-400" />,
    video: <FiVideo size={iconSize} className="text-blue-400" />,
    audio: <FiMusic size={iconSize} className="text-purple-400" />,
    pdf: <FiFileText size={iconSize} className="text-red-400" />,
    xlsx: <FiFile size={iconSize} className="text-green-400" />,
    image: <FiImage size={iconSize} className="text-green-400" />,
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-900">
      {hasThumbnail ? (
        <img src={thumbnailData.data} alt={file.name} className="w-full h-full object-contain" draggable={false} />
      ) : (
        <div className="flex flex-col items-center gap-2">
          {iconMap[fileType] || <FiFile size={iconSize} className="text-gray-500" />}
          {!compact && <p className="text-gray-300 text-sm truncate max-w-[300px]">{file.name}</p>}
        </div>
      )}
    </div>
  );
}
