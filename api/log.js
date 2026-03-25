// api/log.js
// Registra usuarios en Google Sheets via Apps Script

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxmk8pQG-faOLVDIUtogDaxgadNcPkpouuPsMW4SJBi4pZuQb4dZYLBPBHZXE4fmf07Mw/exec';

  try {
    const body = req.body;

    const r = await fetch(SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Log error:', e);
    return res.status(500).json({ error: e.message });
  }
}
