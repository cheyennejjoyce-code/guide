export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { type, fields } = req.body || {};
  const allowed = ['work_with_us', 'submit_event', 'recommend_store'];
  if (!allowed.includes(type) || !fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'Something is missing. Please try again.' });
  }
  try {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/website_submissions', {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ type, email: fields.email || null, data: fields })
    });
    if (!r.ok) return res.status(502).json({ error: 'Could not send right now. Please try again.' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Could not send right now. Please try again.' });
  }
}
