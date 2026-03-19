/** @format */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createJob, startJob, addJobLog, completeJob, setJobProgress } from '@/lib/jobManager';

const ROOT = process.cwd();
const MODULES_JSON = path.join(ROOT, 'modules.json');
const TMP_DIR = path.join(ROOT, '.module-tmp');
const MODULE_NAME_RE = /^[a-z][a-z0-9-]*$/;

// ─── Helpers ────────────────────────────────────────────────────────────────

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MODULES_JSON, 'utf-8'));
  } catch {
    return { installedModules: {} };
  }
}

function writeManifest(manifest) {
  fs.writeFileSync(MODULES_JSON, JSON.stringify(manifest, null, 2) + '\n');
}

function copyDirIfExists(src, dest) {
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    return true;
  }
  return false;
}

function rmDirIfExists(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * List all installed modules.
 */
export function listModules() {
  const manifest = readManifest();
  return Object.values(manifest.installedModules);
}

/**
 * Install a module from a git URL (or local path).
 * Returns the module metadata on success.
 */
export async function addModule(repository) {
  const jobId = createJob('Install module', 'module-install');
  startJob(jobId);

  try {
    // 1. Clone to temp directory
    addJobLog(jobId, `Cloning ${repository}...`);
    setJobProgress(jobId, 10, true);

    rmDirIfExists(TMP_DIR);
    fs.mkdirSync(TMP_DIR, { recursive: true });

    const cloneTarget = path.join(TMP_DIR, 'repo');

    const isLocalPath = fs.existsSync(repository);
    if (isLocalPath) {
      fs.cpSync(repository, cloneTarget, { recursive: true });
    } else {
      execSync(`git clone --depth 1 "${repository}" "${cloneTarget}"`, {
        stdio: 'pipe',
        timeout: 60000,
      });
    }

    // 2. Read and validate module.json
    addJobLog(jobId, 'Validating module.json...');
    setJobProgress(jobId, 30, true);

    const moduleJsonPath = path.join(cloneTarget, 'module.json');
    if (!fs.existsSync(moduleJsonPath)) {
      throw new Error('module.json not found in repository root');
    }

    const moduleJson = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf-8'));

    if (!moduleJson.name || !MODULE_NAME_RE.test(moduleJson.name)) {
      throw new Error(
        `Invalid module name "${moduleJson.name}". Must be lowercase alphanumeric with hyphens (e.g. "my-module")`
      );
    }

    const name = moduleJson.name;

    // 3. Check if already installed
    const manifest = readManifest();
    if (manifest.installedModules[name]) {
      throw new Error(`Module "${name}" is already installed. Remove it first or use update.`);
    }

    // 4. Copy directories to destinations
    addJobLog(jobId, `Installing module "${name}"...`);
    setJobProgress(jobId, 50, true);

    const destinations = {};

    // Pages -> app/(authenticated)/app/{name}/
    const appSrc = path.join(cloneTarget, 'app');
    const appDest = path.join(ROOT, 'app', '(authenticated)', 'app', name);
    if (copyDirIfExists(appSrc, appDest)) {
      destinations.app = `app/(authenticated)/app/${name}`;
      addJobLog(jobId, `  Copied pages to ${destinations.app}`);
    }

    // API routes -> app/api/modules/{name}/
    const apiSrc = path.join(cloneTarget, 'api');
    const apiDest = path.join(ROOT, 'app', 'api', 'modules', name);
    if (copyDirIfExists(apiSrc, apiDest)) {
      destinations.api = `app/api/modules/${name}`;
      addJobLog(jobId, `  Copied API routes to ${destinations.api}`);
    }

    // Components -> modules/{name}/components/
    const compSrc = path.join(cloneTarget, 'components');
    const compDest = path.join(ROOT, 'modules', name, 'components');
    if (copyDirIfExists(compSrc, compDest)) {
      destinations.components = `modules/${name}/components`;
      addJobLog(jobId, `  Copied components to ${destinations.components}`);
    }

    // Lib -> modules/{name}/lib/
    const libSrc = path.join(cloneTarget, 'lib');
    const libDest = path.join(ROOT, 'modules', name, 'lib');
    if (copyDirIfExists(libSrc, libDest)) {
      destinations.lib = `modules/${name}/lib`;
      addJobLog(jobId, `  Copied lib to ${destinations.lib}`);
    }

    // 5. Create module database directory
    const dbDir = path.join(ROOT, 'db', 'modules');
    fs.mkdirSync(dbDir, { recursive: true });

    setJobProgress(jobId, 70, true);

    // 6. Merge dependencies into package.json if any
    if (moduleJson.dependencies && Object.keys(moduleJson.dependencies).length > 0) {
      addJobLog(jobId, 'Merging dependencies into package.json...');
      const pkgPath = path.join(ROOT, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      let added = [];
      for (const [dep, version] of Object.entries(moduleJson.dependencies)) {
        if (!pkg.dependencies[dep]) {
          pkg.dependencies[dep] = version;
          added.push(`${dep}@${version}`);
        }
      }
      if (added.length > 0) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        addJobLog(jobId, `  Added dependencies: ${added.join(', ')}`);
        addJobLog(jobId, '  Run "bun install" to install new dependencies', 'warn');
      }
    }

    // 7. Update manifest
    addJobLog(jobId, 'Updating modules.json...');
    setJobProgress(jobId, 90, true);

    const type = destinations.api ? 'nextjs' : 'react';
    manifest.installedModules[name] = {
      name,
      version: moduleJson.version || '0.0.0',
      type,
      description: moduleJson.description || '',
      repository,
      installedAt: new Date().toISOString(),
      destinations,
    };
    writeManifest(manifest);

    // 8. Cleanup
    rmDirIfExists(TMP_DIR);

    addJobLog(jobId, `Module "${name}" installed successfully. Rebuild required.`);
    completeJob(jobId, true);

    return manifest.installedModules[name];
  } catch (err) {
    rmDirIfExists(TMP_DIR);
    addJobLog(jobId, err.message, 'error');
    completeJob(jobId, false, err.message);
    throw err;
  }
}

/**
 * Remove an installed module by name.
 */
export function removeModule(name, { deleteDatabase = false } = {}) {
  const manifest = readManifest();
  const mod = manifest.installedModules[name];
  if (!mod) {
    throw new Error(`Module "${name}" is not installed.`);
  }

  // Remove copied directories
  rmDirIfExists(path.join(ROOT, 'app', '(authenticated)', 'app', name));
  rmDirIfExists(path.join(ROOT, 'app', 'api', 'modules', name));
  rmDirIfExists(path.join(ROOT, 'modules', name));

  // Optionally remove database
  if (deleteDatabase) {
    const dbFile = path.join(ROOT, 'db', 'modules', `${name}.db`);
    rmDirIfExists(dbFile);
    rmDirIfExists(`${dbFile}-journal`);
    rmDirIfExists(`${dbFile}-wal`);
  }

  // Update manifest
  delete manifest.installedModules[name];
  writeManifest(manifest);

  return { name, removed: true };
}

/**
 * Update a module by re-cloning from its stored repository URL.
 */
export async function updateModule(name) {
  const manifest = readManifest();
  const mod = manifest.installedModules[name];
  if (!mod) {
    throw new Error(`Module "${name}" is not installed.`);
  }

  const repository = mod.repository;

  // Remove existing files (keep database)
  removeModule(name, { deleteDatabase: false });

  // Re-install from same repository
  return addModule(repository);
}
