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

    const promptText = `
Estas son capturas de pantalla de un equipo de fantasy fútbol (Biwenger o similar).

Tu tarea:
- Detectar TODOS los jugadores visibles en las capturas.
- Leer cada tarjeta de jugador visible.
- Extraer solo información que realmente se vea en la imagen.
- No inventar datos.
- Si no podés leer un dato, usar null.

Campos esperados por jugador:
- name
- team
- position  (solo: POR, DEF, MED, DEL)
- price
- points

Reglas:
- Devuelve SOLO un array JSON válido.
- No escribas explicación.
- No escribas markdown.
- No uses bloques de código.
- Un jugador por objeto.
- Si aparece abreviado, devolvelo como se ve en la captura.
- Mantener el orden visual aproximado de izquierda a derecha y de arriba hacia abajo.

Formato exacto:
[
  {
    "name": "Ter Stegen",
    "team": "Barcelona",
    "position": "POR",
    "price": "19M",
    "points": "88"
  }
]

Si no encontrás ningún jugador visible, devolvé:
[]
`.trim();

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1600,
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

    const parsed = JSON.parse(cleaned.slice(start, end + 1));

    const players = Array.isArray(parsed)
      ? parsed
          .filter(Boolean)
          .map((p) => ({
            name: normalizeString(p.name),
            team: normalizeNullable(p.team),
            position: normalizePosition(p.position),
            price: normalizeNullable(p.price),
            points: normalizeNullable(p.points)
          }))
          .filter((p) => p.name)
      : [];

    return res.status(200).json({ players });
  } catch (e) {
    console.error('api/extract error:', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}

function normalizeString(value) {
  const v = String(value || '').trim();
  return v || null;
}

function normalizeNullable(value) {
  const v = String(value ?? '').trim();
  if (!v || v.toLowerCase() === 'null') return null;
  return v;
}

function normalizePosition(value) {
  const v = String(value || '').trim().toUpperCase();

  if (['POR', 'DEF', 'MED', 'DEL'].includes(v)) return v;

  if (v.includes('POR')) return 'POR';
  if (v.includes('DEF')) return 'DEF';
  if (v.includes('MED')) return 'MED';
  if (v.includes('DEL')) return 'DEL';

  return null;
}
