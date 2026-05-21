/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import {
  listDisks,
  getHdIdleStatus,
  writeHdIdleConfig,
  getGovernorStatus,
  applyGovernor,
  getPowertopStatus,
  setPowertopAutotune,
  getMountAudit,
} from '@/lib/powerManagement';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const [disks, hdIdle, governor, powertop, mounts] = await Promise.all([
      listDisks(),
      getHdIdleStatus(),
      getGovernorStatus(),
      getPowertopStatus(),
      getMountAudit(),
    ]);
    return NextResponse.json({ disks, hdIdle, governor, powertop, mounts });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to read power management status' }, { status: 500 });
  }
}

export async function PUT(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const applied = [];
  const errors = [];

  if (body.hdIdle) {
    try {
      const { enabled, defaultIdleSeconds, overrides } = body.hdIdle;
      await writeHdIdleConfig({
        enabled: !!enabled,
        defaultIdleSeconds: Number(defaultIdleSeconds),
        overrides: Array.isArray(overrides)
          ? overrides.map((o) => ({ device: String(o.device), idleSeconds: Number(o.idleSeconds) }))
          : [],
      });
      applied.push('hdIdle');
    } catch (e) {
      errors.push({ section: 'hdIdle', message: e.message });
    }
  }

  if (body.governor) {
    try {
      await applyGovernor(String(body.governor.value), { persist: !!body.governor.persist });
      applied.push('governor');
    } catch (e) {
      errors.push({ section: 'governor', message: e.message });
    }
  }

  if (body.powertop) {
    try {
      await setPowertopAutotune(!!body.powertop.enabled);
      applied.push('powertop');
    } catch (e) {
      errors.push({ section: 'powertop', message: e.message });
    }
  }

  // Return fresh state regardless of partial errors
  const [disks, hdIdle, governor, powertop, mounts] = await Promise.all([
    listDisks(),
    getHdIdleStatus(),
    getGovernorStatus(),
    getPowertopStatus(),
    getMountAudit(),
  ]);

  return NextResponse.json(
    { disks, hdIdle, governor, powertop, mounts, applied, errors: errors.length ? errors : undefined },
    { status: errors.length ? 207 : 200 },
  );
}
