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
            text: `Estas son capturas de un equipo de fantasy fútbol (Biwenger, Fantasy Premier League u otra plataforma).

INSTRUCCIONES CRÍTICAS:
1. Extraé TODOS los jugadores visibles en la imagen
2. Para "team": es OBLIGATORIO identificar el club. Buscá en el texto de la imagen, en los escudos/logos, en los colores de camiseta, o inferilo por el contexto. Si ves "LIV" = Liverpool, "ARS" = Arsenal, "BOU" = Bournemouth, "FUL" = Fulham, "NEW" = Newcastle, etc. NUNCA dejes team en null si hay alguna pista visual.
3. Para "name": escribí el nombre EXACTAMENTE como aparece en la imagen, aunque esté abreviado
4. Para "nameComplete": true si tiene nombre Y apellido completos, false si está abreviado, truncado o es solo apellido
5. Para "teamConfidence": "high" si lo leíste claramente del texto, "low" si lo inferiste del logo/abreviatura/colores, "none" solo si absolutamente no hay ninguna pista

Devolvé SOLO array JSON sin texto extra ni markdown:
[{"name":"nombre como aparece","nameComplete":true,"team":"nombre completo del club","teamConfidence":"high/low/none","position":"POR/DEF/MED/DEL","price":"precio o null","points":"puntos o null"}]`
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
