/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { readComponentsConfig, writeComponentsConfig } from '@/lib/componentsConfig';
import { enableService, disableService } from '@/lib/systemctl';

// Systemd service name for each component key
const SERVICES = {
  zfs: 'zfs-zed',
  smb: 'smbd',
};

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const config = await readComponentsConfig();
    return NextResponse.json({ config });
  } catch {
    return NextResponse.json({ error: 'Failed to read components config' }, { status: 500 });
  }
}

export async function PUT(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json();
    const previous = await readComponentsConfig();
    const config = await writeComponentsConfig(body);

    // Apply systemctl changes for anything that toggled
    const serviceErrors = [];
    for (const [key, service] of Object.entries(SERVICES)) {
      if (previous[key] === config[key]) continue;
      try {
        if (config[key]) {
          await enableService(service);
        } else {
          await disableService(service);
        }
      } catch (err) {
        console.error(`Failed to ${config[key] ? 'enable' : 'disable'} ${service}:`, err);
        serviceErrors.push({ service, error: err.message });
      }
    }

    return NextResponse.json({ config, serviceErrors: serviceErrors.length ? serviceErrors : undefined });
  } catch {
    return NextResponse.json({ error: 'Failed to save components config' }, { status: 500 });
  }
}
