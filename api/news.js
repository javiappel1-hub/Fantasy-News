// api/news.js
// Vercel Serverless Function — busca noticias de un jugador
// Variables de entorno necesarias:
//   ANTHROPIC_API_KEY   → tu API key de Anthropic
//   NEWS_API_KEY        → tu API key de newsapi.org (gratis en newsapi.org)

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name, team } = req.query;
  if (!name || !team) {
    return res.status(400).json({ error: 'Faltan parámetros: name y team' });
  }

  try {
    // ── 1. Buscar noticias reales en NewsAPI ─────────────────────────────────
    const newsApiKey = process.env.NEWS_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    let webNews = [];
    let twitterNews = [];

    if (newsApiKey) {
      const query = encodeURIComponent(`"${name}" football`);
      const newsRes = await fetch(
        `https://newsapi.org/v2/everything?q=${query}&language=es&sortBy=publishedAt&pageSize=8`,
        { headers: { 'X-Api-Key': newsApiKey } }
      );
      const newsData = await newsRes.json();

      if (newsData.articles) {
        webNews = newsData.articles.map(a => ({
          type: 'web',
          source: a.source?.name || 'Desconocido',
          handle: null,
          title: (a.title || '').substring(0, 80),
          excerpt: (a.description || '').substring(0, 120),
          url: a.url,
          time: timeAgo(a.publishedAt),
          minutesAgo: minutesSince(a.publishedAt)
        }));
      }
    }

    // ── 2. Claude genera tweets realistas (Twitter no tiene API gratis) ───────
    if (anthropicKey) {
      const tweetPrompt = `Generate 8 realistic recent tweets about ${name} (${team}) from football journalists.
Use handles: @FabrizioRomano, @relevo, @MarcaFutbol, @mundodeportivo, @SkySportsNews, @goal, @ESPNfutbol, @partidazocope
Topics: injuries, lineup, form, stats, quotes.
Return ONLY JSON array:
[{"type":"twitter","source":"Relevo","handle":"@relevo","title":"tweet text max 200 chars","excerpt":"context","url":null,"time":"2h ago","minutesAgo":120}]
minutesAgo between 30-2880. ONLY the JSON array.`;

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          messages: [{ role: 'user', content: tweetPrompt }]
        })
      });

      const claudeData = await claudeRes.json();
      const raw = claudeData.content?.find(b => b.type === 'text')?.text || '[]';
      twitterNews = safeParseJSON(raw);
    }

    // ── 3. Si no hay NewsAPI, Claude genera también las noticias web ──────────
    if (webNews.length === 0 && anthropicKey) {
      const webPrompt = `Generate 8 realistic recent football news articles about ${name} (${team}).
Sources: Marca, AS, Sport, Sky Sports, BBC Sport, Relevo, ESPN, Mundo Deportivo.
Return ONLY JSON array:
[{"type":"web","source":"Marca","handle":null,"title":"headline max 75 chars","excerpt":"one sentence","url":null,"time":"2h ago","minutesAgo":120}]
minutesAgo between 30-4320. ONLY the JSON array.`;

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          messages: [{ role: 'user', content: webPrompt }]
        })
      });

      const claudeData = await claudeRes.json();
      const raw = claudeData.content?.find(b => b.type === 'text')?.text || '[]';
      webNews = safeParseJSON(raw);
    }

    // ── 4. Combinar y ordenar ─────────────────────────────────────────────────
    const all = [...webNews, ...twitterNews]
      .sort((a, b) => (a.minutesAgo || 9999) - (b.minutesAgo || 9999));

    // Build Google News fallback URLs for items without url
    const withUrls = all.map(n => ({
      ...n,
      url: n.url || buildSearchUrl(n)
    }));

    return res.status(200).json({ news: withUrls, player: name, team });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return 'reciente';
  const mins = minutesSince(dateStr);
  if (mins < 60) return `hace ${mins}min`;
  if (mins < 1440) return `hace ${Math.floor(mins / 60)}h`;
  return `hace ${Math.floor(mins / 1440)} días`;
}

function minutesSince(dateStr) {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

function buildSearchUrl(n) {
  if (n.type === 'twitter') {
    return `https://x.com/search?q=${encodeURIComponent(n.title)}&f=live`;
  }
  return `https://news.google.com/search?q=${encodeURIComponent(n.source + ' ' + n.title)}&hl=es`;
}

function safeParseJSON(raw) {
  try {
    const cleaned = raw.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      const arr = JSON.parse(cleaned.substring(start, end + 1));
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {}
  return [];
}
