/** @format */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authCheck';
import { getLists, addList, updateList, deleteList } from '@/lib/pihole';
import { piholeError, readJson } from '../respond';

// Adlists are addressed by their URL rather than an id, so the address travels
// in the body (writes) or the query string (delete) instead of the path.

export async function GET(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const type = new URL(req.url).searchParams.get('type') || 'block';

  try {
    return NextResponse.json(await getLists(type));
  } catch (e) {
    return piholeError(e, 'Failed to load blocklists');
  }
}

export async function POST(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { body, response } = await readJson(req);
  if (response) return response;

  try {
    const result = await addList(body.address, {
      type: body.type || 'block',
      comment: body.comment ?? '',
      enabled: body.enabled ?? true,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return piholeError(e, 'Failed to add the list');
  }
}

export async function PUT(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { body, response } = await readJson(req);
  if (response) return response;

  try {
    const result = await updateList(body.address, {
      type: body.type || 'block',
      comment: body.comment,
      enabled: body.enabled,
      groups: body.groups,
    });
    return NextResponse.json(result);
  } catch (e) {
    return piholeError(e, 'Failed to update the list');
  }
}

export async function DELETE(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const address = params.get('address');
  if (!address) {
    return NextResponse.json({ error: 'Missing "address" parameter' }, { status: 400 });
  }

  try {
    await deleteList(address, params.get('type') || 'block');
    return NextResponse.json({ success: true });
  } catch (e) {
    return piholeError(e, 'Failed to remove the list');
  }
}
