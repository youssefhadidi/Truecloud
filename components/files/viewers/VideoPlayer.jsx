/** @format */

export function VideoPlayer({ file, getFileUrl }) {
  return (
    <video
      key={file.id}
      src={getFileUrl(file, 'video')}
      controls
      className="w-full h-full"
      onClick={(e) => e.stopPropagation()}
    />
  );
}
