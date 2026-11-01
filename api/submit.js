export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { type, fields } = req.body || {};
  const allowed = ['work_with_us', 'submit_event', 'recommend_store'];
  if (!allowed.includes(type) || !fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'Something is missing. Please try again.' });
  }
  const url = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Setup issue: missing ' + (!url ? 'SUPABASE_URL' : 'SUPABASE_SERVICE_ROLE_KEY') });
  try {
    const r = await fetch(url + '/rest/v1/website_submissions', {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ type, email: fields.email || null, data: fields })
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('Supabase error', r.status, t);
      return res.status(502).json({ error: 'Could not send (' + r.status + '): ' + t.slice(0, 160) });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Could not send: ' + e.message });
  }
}
