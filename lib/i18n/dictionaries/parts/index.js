/** @format */

// Barrel for per-panel dictionary fragments. Each module under ./parts exports
// `ns` (top-level namespace key), `en`, and `fr`. They are aggregated here and
// spread into the main en/fr dictionaries. Keeping one module per panel lets
// translation work proceed in parallel without contending on a shared file.

import * as accounts from './accounts';
import * as security from './security';
import * as indexation from './indexation';
import * as minecraft from './minecraft';
import * as monitoring from './monitoring';
import * as storage from './storage';
import * as zfs from './zfs';
import * as smb from './smb';
import * as media from './media';
import * as power from './power';
import * as health from './health';
import * as extensions from './extensions';
import * as extra from './extra';

const modules = [
  accounts, security, indexation, minecraft, monitoring, storage,
  zfs, smb, media, power, health, extensions, extra,
];

export const partsEn = Object.fromEntries(modules.map((m) => [m.ns, m.en]));
export const partsFr = Object.fromEntries(modules.map((m) => [m.ns, m.fr]));
