// api/extract.js
// Extrae jugadores de una imagen usando Claude Vision

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { images } = req.body; // array of base64 strings
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
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [...imgBlocks, {
            type: 'text',
            text: `Estas son capturas de un equipo de Biwenger (fantasy fútbol).
Extraé TODOS los jugadores visibles. Devolvé SOLO array JSON sin texto extra:
[{"name":"nombre completo","team":"club","position":"POR/DEF/MED/DEL","price":"precio o null","points":"puntos o null"}]`
          }]
        }]
      })
    });

    const d = await r.json();
    const raw = d.content?.find(b => b.type === 'text')?.text || '[]';
    const cleaned = raw.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
    const players = JSON.parse(cleaned);

    return res.status(200).json({ players });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
