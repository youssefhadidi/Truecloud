/** @format */

const USB_PREFIX = '__usb__';

export function isUsbPath(path) {
  if (!path) return false;
  return path === USB_PREFIX || path.startsWith(`${USB_PREFIX}/`);
}

export function makeUsbPath(mountpoint, subPath = '') {
  const enc = encodeURIComponent(mountpoint);
  const sub = (subPath || '').replace(/^\/+/, '');
  return sub ? `${USB_PREFIX}/${enc}/${sub}` : `${USB_PREFIX}/${enc}`;
}

export function parseUsbPath(path) {
  if (!isUsbPath(path)) return null;
  const rest = path.slice(USB_PREFIX.length).replace(/^\/+/, '');
  if (!rest) return { mountpoint: '', subPath: '' };
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) {
    return { mountpoint: decodeURIComponent(rest), subPath: '' };
  }
  return {
    mountpoint: decodeURIComponent(rest.slice(0, slashIdx)),
    subPath: rest.slice(slashIdx + 1),
  };
}

export { USB_PREFIX };
