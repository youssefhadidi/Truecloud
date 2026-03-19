/** @format */

/**
 * CLI wrapper for module management.
 *
 * Usage:
 *   bun scripts/module-manager.js add <git-url>
 *   bun scripts/module-manager.js remove <module-name>
 *   bun scripts/module-manager.js list
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODULES_JSON = path.join(ROOT, 'modules.json');
const TMP_DIR = path.join(ROOT, '.module-tmp');
const MODULE_NAME_RE = /^[a-z][a-z0-9-]*$/;

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

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    return true;
  }
  return false;
}

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdAdd(repository) {
  if (!repository) {
    console.error('Usage: bun scripts/module-manager.js add <git-url-or-local-path>');
    process.exit(1);
  }

  console.log(`Cloning ${repository}...`);
  rmDir(TMP_DIR);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const cloneTarget = path.join(TMP_DIR, 'repo');

  if (fs.existsSync(repository)) {
    fs.cpSync(repository, cloneTarget, { recursive: true });
  } else {
    execSync(`git clone --depth 1 "${repository}" "${cloneTarget}"`, { stdio: 'inherit', timeout: 60000 });
  }

  const moduleJsonPath = path.join(cloneTarget, 'module.json');
  if (!fs.existsSync(moduleJsonPath)) {
    rmDir(TMP_DIR);
    console.error('Error: module.json not found in repository root');
    process.exit(1);
  }

  const moduleJson = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf-8'));
  if (!moduleJson.name || !MODULE_NAME_RE.test(moduleJson.name)) {
    rmDir(TMP_DIR);
    console.error(`Error: Invalid module name "${moduleJson.name}"`);
    process.exit(1);
  }

  const name = moduleJson.name;
  const manifest = readManifest();
  if (manifest.installedModules[name]) {
    rmDir(TMP_DIR);
    console.error(`Error: Module "${name}" is already installed.`);
    process.exit(1);
  }

  console.log(`Installing "${name}"...`);
  const destinations = {};

  if (copyDir(path.join(cloneTarget, 'app'), path.join(ROOT, 'app', '(authenticated)', 'app', name))) {
    destinations.app = `app/(authenticated)/app/${name}`;
    console.log(`  Pages -> ${destinations.app}`);
  }
  if (copyDir(path.join(cloneTarget, 'api'), path.join(ROOT, 'app', 'api', 'modules', name))) {
    destinations.api = `app/api/modules/${name}`;
    console.log(`  API   -> ${destinations.api}`);
  }
  if (copyDir(path.join(cloneTarget, 'components'), path.join(ROOT, 'modules', name, 'components'))) {
    destinations.components = `modules/${name}/components`;
    console.log(`  Comp  -> ${destinations.components}`);
  }
  if (copyDir(path.join(cloneTarget, 'lib'), path.join(ROOT, 'modules', name, 'lib'))) {
    destinations.lib = `modules/${name}/lib`;
    console.log(`  Lib   -> ${destinations.lib}`);
  }

  fs.mkdirSync(path.join(ROOT, 'db', 'modules'), { recursive: true });

  // Merge dependencies
  if (moduleJson.dependencies && Object.keys(moduleJson.dependencies).length > 0) {
    const pkgPath = path.join(ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const added = [];
    for (const [dep, version] of Object.entries(moduleJson.dependencies)) {
      if (!pkg.dependencies[dep]) {
        pkg.dependencies[dep] = version;
        added.push(`${dep}@${version}`);
      }
    }
    if (added.length > 0) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`  Added deps: ${added.join(', ')}`);
      console.log('  Run "bun install" to install new dependencies.');
    }
  }

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

  rmDir(TMP_DIR);
  console.log(`\nModule "${name}" installed. Run "bun run build" to rebuild.`);
}

function cmdRemove(name) {
  if (!name) {
    console.error('Usage: bun scripts/module-manager.js remove <module-name>');
    process.exit(1);
  }

  const manifest = readManifest();
  if (!manifest.installedModules[name]) {
    console.error(`Error: Module "${name}" is not installed.`);
    process.exit(1);
  }

  rmDir(path.join(ROOT, 'app', '(authenticated)', 'app', name));
  rmDir(path.join(ROOT, 'app', 'api', 'modules', name));
  rmDir(path.join(ROOT, 'modules', name));

  delete manifest.installedModules[name];
  writeManifest(manifest);

  console.log(`Module "${name}" removed. Run "bun run build" to rebuild.`);
}

function cmdList() {
  const manifest = readManifest();
  const modules = Object.values(manifest.installedModules);

  if (modules.length === 0) {
    console.log('No modules installed.');
    return;
  }

  console.log(`\nInstalled modules (${modules.length}):\n`);
  for (const mod of modules) {
    console.log(`  ${mod.name} v${mod.version} (${mod.type})`);
    if (mod.description) console.log(`    ${mod.description}`);
    console.log(`    ${mod.repository}`);
    console.log(`    Installed: ${new Date(mod.installedAt).toLocaleDateString()}`);
    console.log();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [, , command, ...args] = process.argv;

switch (command) {
  case 'add':
    cmdAdd(args[0]);
    break;
  case 'remove':
    cmdRemove(args[0]);
    break;
  case 'list':
    cmdList();
    break;
  default:
    console.log('Truecloud Module Manager\n');
    console.log('Usage:');
    console.log('  bun scripts/module-manager.js add <git-url>      Install a module');
    console.log('  bun scripts/module-manager.js remove <name>      Remove a module');
    console.log('  bun scripts/module-manager.js list                List installed modules');
    process.exit(command ? 1 : 0);
}
