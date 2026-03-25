// api/extract.js
// Extrae jugadores de una imagen usando Claude Vision

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { images } = req.body;

  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'No images provided' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  try {
    const imgBlocks = images.map(({ data, mediaType }) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType || 'image/jpeg',
        data
      }
    }));

    const promptText = `Estas son capturas de un equipo de Biwenger (fantasy fútbol).
Extraé TODOS los jugadores visibles.
Devolvé SOLO un array JSON válido, sin texto extra, sin markdown y sin bloques de código.

Formato:
[
  {
    "name": "nombre completo",
    "team": "club o null",
    "position": "POR/DEF/MED/DEL",
    "price": "precio o null",
    "points": "puntos o null"
  }
]`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1200,
        messages: [
          {
            role: 'user',
            content: [
              ...imgBlocks,
              { type: 'text', text: promptText }
            ]
          }
        ]
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Anthropic extract error ${r.status}: ${errText}`);
    }

    const d = await r.json();
    const raw = d.content?.find((b) => b.type === 'text')?.text || '[]';

    const cleaned = String(raw)
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/gi, '')
      .trim();

    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');

    if (start === -1 || end === -1 || end < start) {
      throw new Error('Claude no devolvió un JSON array válido');
    }

    const players = JSON.parse(cleaned.slice(start, end + 1));

    return res.status(200).json({ players });
  } catch (e) {
    console.error('api/extract error:', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}
