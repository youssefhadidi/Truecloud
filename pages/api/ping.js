/** @format */

export default function handler(req, res) {
  console.log('GET /api/ping');
  res.status(200).json({ ok: true });
}
