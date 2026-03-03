/**
 * webrtc-polyfill stub
 *
 * Replaces the real webrtc-polyfill (which imports node-datachannel) with no-op
 * classes. Bun's ESM-CJS interop loses __dirname for node-datachannel's native
 * addon, causing a fatal load error. WebRTC (browser-to-server peers) is not
 * needed for a server-side torrent downloader — only TCP/UDP peers are used.
 */

export class RTCPeerConnection {
  constructor() {}
  createOffer() { return Promise.reject(new Error('WebRTC not supported')); }
  createAnswer() { return Promise.reject(new Error('WebRTC not supported')); }
  setLocalDescription() { return Promise.reject(new Error('WebRTC not supported')); }
  setRemoteDescription() { return Promise.reject(new Error('WebRTC not supported')); }
  addIceCandidate() { return Promise.reject(new Error('WebRTC not supported')); }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

export class RTCSessionDescription {
  constructor(init = {}) { Object.assign(this, init); }
}

export class RTCIceCandidate {
  constructor(init = {}) { Object.assign(this, init); }
}

export class RTCIceTransport {}
export class RTCDataChannel {}
export class RTCSctpTransport {}
export class RTCDtlsTransport {}
export class RTCCertificate {}
export class MediaStream { getTracks() { return []; } }

export default {};
