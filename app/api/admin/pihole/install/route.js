/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { preflight, seedConfig, runInstaller, setApiPassword, InstallerError } from '@/lib/piholeInstaller';
import { writePiholeConfig } from '@/lib/piholeConfig';
import { invalidatePiholeSession } from '@/lib/pihole';
import { createJob, startJob, addJobLog, setJobProgress, setJobChild, completeJob } from '@/lib/jobManager';
import { readJson } from '../respond';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    return NextResponse.json(await preflight());
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Preflight failed' }, { status: 500 });
  }
}

/**
 * Install Pi-hole. Requires `confirmed: true` — preflight lists the changes the
 * installer will make to this host, and none of them happen without an
 * explicit acknowledgement from the admin.
 */
export async function POST(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { body, response } = await readJson(req);
  if (response) return response;

  if (body?.confirmed !== true) {
    return NextResponse.json({ error: 'Installation must be explicitly confirmed.' }, { status: 400 });
  }

  let checks;
  try {
    checks = await preflight();
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Preflight failed' }, { status: 500 });
  }

  // Re-check rather than trusting the client's view of preflight — the box may
  // have changed since the confirmation screen was rendered.
  if (checks.alreadyInstalled) {
    return NextResponse.json({ error: 'Pi-hole is already installed on this server.' }, { status: 409 });
  }
  if (!checks.canInstall) {
    return NextResponse.json(
      { error: 'Preflight blockers must be resolved first.', blockers: checks.blockers },
      { status: 409 },
    );
  }

  const webPort = String(body.webPort ?? '8080');
  const upstreams = Array.isArray(body.upstreams) && body.upstreams.length ? body.upstreams : ['1.1.1.1', '1.0.0.1'];

  const jobId = createJob('Pi-hole installation', 'pihole-install');
  startJob(jobId);

  runInstall({ jobId, webPort, upstreams, interfaceName: checks.facts.interface }).catch(() => {
    // runInstall reports into the job itself; nothing to add here.
  });

  return NextResponse.json({ jobId }, { status: 202 });
}

async function runInstall({ jobId, webPort, upstreams, interfaceName }) {
  try {
    addJobLog(jobId, 'Seeding /etc/pihole/pihole.toml so the installer can run unattended...');
    const seeded = await seedConfig({ interfaceName, upstreams, webPort });
    addJobLog(jobId, `Web interface will listen on ${seeded.port}`);
    setJobProgress(jobId, 5, true);

    // The installer emits a few hundred lines; creep the bar so it visibly moves.
    let lines = 0;
    await runInstaller(
      (line, level) => {
        lines += 1;
        addJobLog(jobId, line, level === 'warn' ? 'warn' : 'info');
        setJobProgress(jobId, Math.min(85, 5 + Math.round((lines / 300) * 80)));
      },
      (child) => setJobChild(jobId, child),
    );

    setJobProgress(jobId, 90, true);
    addJobLog(jobId, 'Setting an API password for Truecloud...');

    const password = await setApiPassword();
    await writePiholeConfig({ baseUrl: `http://127.0.0.1:${webPort}`, password });
    invalidatePiholeSession();

    addJobLog(jobId, 'Pi-hole installed and connected to Truecloud.');
    completeJob(jobId, true);
  } catch (e) {
    const message = e instanceof InstallerError ? e.message : (e?.message ?? 'Installation failed');
    addJobLog(jobId, message, 'error');
    completeJob(jobId, false, message);
  }
}
