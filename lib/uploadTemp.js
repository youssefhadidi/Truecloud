/** @format */

// Convention for in-flight uploads: stream to a `.upload-tmp-<pid>-<rand>-<name>`
// file in the target directory, then atomically rename to the final name when
// the stream's `finish` event fires. The leading dot keeps the temp file hidden
// from the authenticated list (which already filters dotfiles); the public list
// and thumbnail routes filter the prefix explicitly.

export const UPLOAD_TEMP_PREFIX = '.upload-tmp-';

export function buildTempName(finalName) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${UPLOAD_TEMP_PREFIX}${process.pid}-${rand}-${finalName}`;
}

export function isUploadTempName(name) {
  return typeof name === 'string' && name.startsWith(UPLOAD_TEMP_PREFIX);
}
