const LABELS = {
  work_with_us: { title: 'Work with us', fields: { name: 'Name', biz: 'Business or shop', email: 'Email', msg: 'What they have in mind' } },
  submit_event: { title: 'Event submission', fields: { event: 'Event name', when: 'Date & time', where: 'Address', ig: 'Instagram', msg: 'Details' } },
  recommend_store: { title: 'Store recommendation', fields: { store: 'Store name', where: 'Neighborhood or address', msg: 'Why feature it' } }
};
const esc = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { type, fields } = req.body || {};
  const cfg = LABELS[type];
  if (!cfg || !fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'Something is missing. Please try again.' });
  }
  const first = fields.event || fields.store || fields.biz || fields.name || '';
  const rows = Object.entries(cfg.fields)
    .map(([k, label]) => '<tr><td style="padding:8px 16px 8px 0;color:#6B6470;vertical-align:top;white-space:nowrap">' + label + '</td><td style="padding:8px 0;color:#221D24">' + (esc(fields[k]) || '—') + '</td></tr>')
    .join('');
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px"><h2 style="margin:0 0 16px">' + cfg.title + '</h2><table style="border-collapse:collapse">' + rows + '</table></div>';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'ATL Thrift Guide <onboarding@resend.dev>',
        to: ['info@atlthriftguide.com'],
        reply_to: fields.email || undefined,
        subject: 'New ' + cfg.title.toLowerCase() + (first ? ': ' + first : ''),
        html
      })
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('Resend error', r.status, t);
      return res.status(502).json({ error: 'Could not send right now. Please try again.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Could not send right now. Please try again.' });
  }
}
