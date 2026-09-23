/** @format */

import { resolve } from 'node:path';

// The Android build of the Truecloud Sync app lives outside git (it's a large
// binary) in a gitignored folder next to the app. Drop a new build there to
// update it — no rebuild or restart needed, the routes read it per request.
export const APK_PATH = resolve(process.cwd(), process.env.TRUECLOUD_SYNC_APK || './downloads/truecloudsync.apk');

export const APK_FILENAME = 'truecloudsync.apk';
