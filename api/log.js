// api/log.js — proxy a Google Sheets con soporte para email y players_json

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxmk8pQG-faOLVDIUtogDaxgadNcPkpouuPsMW4SJBi4pZuQb4dZYLBPBHZXE4fmf07Mw/exec';

  try {
    const body = req.body;
    const r = await fetch(SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        teamName: body.teamName || '',
        userName: body.userName || '',
        email: body.email || '',
        league: body.league || '',
        playerCount: body.playerCount || 0,
        isNew: body.isNew || false,
        players: body.players || '',
        players_json: body.players_json || '',
        timezone: body.timezone || '',
      }),
    });
    const text = await r.text();
    return res.status(200).json({ ok: true, response: text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
