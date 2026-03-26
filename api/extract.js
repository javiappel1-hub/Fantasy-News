// api/extract.js
// Extrae jugadores de una imagen usando Claude Vision

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { images } = req.body;
  if (!images?.length) return res.status(400).json({ error: 'No images provided' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  try {
    const imgBlocks = images.map(({ data, mediaType }) => ({
      type: 'image',
      source: { type: 'base64', media_type: mediaType || 'image/jpeg', data }
    }));

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [...imgBlocks, {
            type: 'text',
            text: `Estas son capturas de un equipo de fantasy fútbol (Biwenger u otra plataforma).

Tu tarea:
1. Extraé TODOS los jugadores visibles
2. Para el campo "team": buscá el nombre del club en el texto O identificá el escudo/logo del equipo si aparece en la imagen
3. Para el campo "name": escribí el nombre exactamente como aparece — si está abreviado (ej: "Martinez A", "Di Cé...") escribilo tal cual, NO lo completes
4. Para el campo "nameComplete": true si el nombre tiene al menos nombre y apellido completos, false si está abreviado o truncado
5. Para el campo "teamConfidence": "high" si estás seguro del equipo, "low" si lo inferiste del logo o no estás seguro, "none" si no encontraste el equipo

Devolvé SOLO array JSON sin texto extra ni markdown:
[{"name":"nombre como aparece","nameComplete":true,"team":"club o null","teamConfidence":"high/low/none","position":"POR/DEF/MED/DEL","price":"precio o null","points":"puntos o null"}]`
          }]
        }]
      })
    });

    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'Anthropic error');
    const raw = d.content?.find(b => b.type === 'text')?.text || '[]';
    const cleaned = raw.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    const players = JSON.parse(cleaned.substring(start, end + 1));

    return res.status(200).json({ players });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
