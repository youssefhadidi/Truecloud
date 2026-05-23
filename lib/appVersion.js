/** @format */

import pkg from '../package.json';

// Inlined into the client bundle at build time. Sent to the server on
// WebSocket connect so it can compare against its own running version and
// decide whether this client is on a stale bundle.
export const APP_VERSION = pkg.version;
