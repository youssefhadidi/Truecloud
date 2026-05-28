/** @format */

// Helpers for replacing `user_<id>` segments with usernames in admin views.
// The map is passed in (built once on the client from /api/users) so each
// helper is a pure string transform.

export function prettifyTopSegment(segment, usernames) {
  if (!segment || !segment.startsWith('user_') || !usernames) return segment;
  const id = segment.slice('user_'.length);
  return usernames.get(id) || segment;
}

export function prettifyPath(path, usernames) {
  if (!path || !path.startsWith('user_') || !usernames) return path;
  const slash = path.indexOf('/');
  if (slash === -1) return prettifyTopSegment(path, usernames);
  return prettifyTopSegment(path.slice(0, slash), usernames) + path.slice(slash);
}
