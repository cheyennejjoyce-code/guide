const PERSON = { first: 'First name', last: 'Last name', email: 'Email' };
const FORMS = {
  work_with_us: { title: 'Work with us', subject: 'biz', fields: Object.assign({}, PERSON, { biz: 'Business or shop', msg: 'What they have in mind' }), required: ['first', 'last', 'email', 'biz', 'msg'] },
  submit_event: { title: 'Event submission', subject: 'event', fields: Object.assign({}, PERSON, { event: 'Event name', date: 'Date', start: 'Start time', end: 'End time', where: 'Address', ig: 'Instagram', msg: 'Details' }), required: ['first', 'last', 'email', 'event', 'date', 'start', 'where', 'msg'] },
  recommend_store: { title: 'Store recommendation', subject: 'store', fields: Object.assign({}, PERSON, { store: 'Store name', where: 'Address', msg: 'Why feature it' }), required: ['first', 'last', 'email', 'store', 'where', 'msg'] }
};
const esc = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmtTime = t => { if (!t) return ''; const p = t.split(':'); let h = Number(p[0]); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + p[1] + ' ' + ap; };
const fmtDate = d => { if (!d) return ''; return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); };
const isEmail = v => typeof v === 'string' && v.indexOf('@') > 0 && v.lastIndexOf('.') > v.indexOf('@') + 1;

async function places(q) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({ input: q, includedRegionCodes: ['us'], locationBias: { circle: { center: { latitude: 33.749, longitude: -84.388 }, radius: 50000 } } })
  });
  if (r.ok) {
    const j = await r.json();
    return (j.suggestions || []).map(s => s.placePrediction && s.placePrediction.text && s.placePrediction.text.text).filter(Boolean).slice(0, 5);
  }
  const r2 = await fetch('https://maps.googleapis.com/maps/api/place/autocomplete/json?components=country:us&location=33.749,-84.388&radius=50000&input=' + encodeURIComponent(q) + '&key=' + key);
  const j2 = await r2.json();
  return (j2.predictions || []).map(p => p.description).slice(0, 5);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const q = String((req.query && req.query.q) || '').slice(0, 200);
    if (q.trim().length < 3) return res.status(200).json({ results: [] });
    try { return res.status(200).json({ results: await places(q) }); }
    catch (e) { console.error(e); return res.status(200).json({ results: [] }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const type = body.type;
  const f = body.fields || {};
  if (!f.first || !f.last) return res.status(400).json({ error: 'Please add your first and last name.' });
  if (!isEmail(f.email)) return res.status(400).json({ error: 'Please enter a valid email.' });

  if (type === 'newsletter') {
    const auth = 'Basic ' + Buffer.from(process.env.FLODESK_API_KEY + ':').toString('base64');
    const sub = { email: f.email, first_name: f.first, last_name: f.last };
    if (process.env.FLODESK_SEGMENT_ID) sub.segment_ids = [process.env.FLODESK_SEGMENT_ID];
    try {
      const r = await fetch('https://api.flodesk.com/v1/subscribers', { method: 'POST', headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'User-Agent': 'ATL Thrift Guide (atlthriftguide.com)' }, body: JSON.stringify(sub) });
      if (!r.ok) { console.error('Flodesk', r.status, await r.text()); return res.status(502).json({ error: 'Could not subscribe right now. Please try again.' }); }
      return res.status(200).json({ ok: true });
    } catch (e) { console.error(e); return res.status(500).json({ error: 'Could not subscribe right now. Please try again.' }); }
  }

  const cfg = FORMS[type];
  if (!cfg) return res.status(400).json({ error: 'Something is missing. Please try again.' });
  const missing = cfg.required.filter(k => !String(f[k] || '').trim());
  if (missing.length) return res.status(400).json({ error: 'Please fill in: ' + missing.map(k => cfg.fields[k]).join(', ') + '.' });

  const show = Object.assign({}, f, { date: fmtDate(f.date), start: fmtTime(f.start), end: fmtTime(f.end) });
  const rows = Object.keys(cfg.fields).map(k => '<tr><td style="padding:8px 16px 8px 0;color:#6B6470;vertical-align:top;white-space:nowrap">' + cfg.fields[k] + '</td><td style="padding:8px 0;color:#221D24">' + (esc(show[k]) || '—') + '</td></tr>').join('');
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px"><h2 style="margin:0 0 16px">' + cfg.title + '</h2><table style="border-collapse:collapse">' + rows + '</table></div>';
  let subject = 'New ' + cfg.title.toLowerCase() + ': ' + f[cfg.subject];
  if (type === 'submit_event') subject += ' (' + show.date + ')';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'ATL Thrift Guide <onboarding@resend.dev>', to: ['info@atlthriftguide.com'], reply_to: f.email, subject: subject, html: html })
    });
    if (!r.ok) { console.error('Resend', r.status, await r.text()); return res.status(502).json({ error: 'Could not send right now. Please try again.' }); }
    return res.status(200).json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Could not send right now. Please try again.' }); }
}
