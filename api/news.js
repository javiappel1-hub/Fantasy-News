// api/news.js
// Vercel Serverless Function — busca noticias de un jugador

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, team } = req.query;

  if (!name || !team) {
    return res.status(400).json({ error: 'Faltan parámetros: name y team' });
  }

  const newsApiKey = process.env.NEWS_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  try {
    let webNews = [];
    let twitterNews = [];

    // 1) Noticias reales desde NewsAPI
    if (newsApiKey) {
      const query = encodeURIComponent(`"${name}" "${team}" football OR futbol`);
      const newsUrl =
        `https://newsapi.org/v2/everything` +
        `?q=${query}` +
        `&language=es` +
        `&sortBy=publishedAt` +
        `&pageSize=8`;

      const newsRes = await fetch(newsUrl, {
        headers: { 'X-Api-Key': newsApiKey }
      });

      if (!newsRes.ok) {
        const errText = await newsRes.text();
        console.error('NewsAPI error:', newsRes.status, errText);
      } else {
        const newsData = await newsRes.json();

        if (Array.isArray(newsData.articles)) {
          webNews = newsData.articles
            .filter((a) => a && (a.title || a.description))
            .map((a) => ({
              type: 'web',
              source: a.source?.name || 'Desconocido',
              handle: null,
              title: truncate(a.title || 'Sin título', 80),
              excerpt: truncate(a.description || a.content || '', 120),
              url: a.url || null,
              time: timeAgo(a.publishedAt),
              minutesAgo: minutesSince(a.publishedAt)
            }));
        }
      }
    }

    // 2) Tweets simulados con Claude
    if (anthropicKey) {
      const tweetPrompt = `
Generate 8 realistic recent tweets about ${name} (${team}) from football journalists.

Use these handles only:
@FabrizioRomano, @relevo, @MarcaFutbol, @mundodeportivo, @SkySportsNews, @goal, @ESPNfutbol, @partidazocope

Topics:
- injuries
- lineup
- form
- stats
- manager quotes
- transfer rumours only if plausible

Return ONLY a valid JSON array.
No markdown.
No explanation.
No code fences.

Format:
[
  {
    "type": "twitter",
    "source": "Relevo",
    "handle": "@relevo",
    "title": "tweet text max 200 chars",
    "excerpt": "short context",
    "url": null,
    "time": "hace 2h",
    "minutesAgo": 120
  }
]

Rules:
- minutesAgo must be a number between 30 and 2880
- title max 200 chars
- excerpt max 120 chars
- output only the JSON array
`;

      try {
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1500,
            messages: [{ role: 'user', content: tweetPrompt }]
          })
        });

        if (!claudeRes.ok) {
          const errText = await claudeRes.text();
          throw new Error(`Anthropic tweets error ${claudeRes.status}: ${errText}`);
        }

        const claudeData = await claudeRes.json();
        const raw = claudeData.content?.find((b) => b.type === 'text')?.text || '[]';
        twitterNews = normalizeNewsArray(safeParseJSON(raw), 'twitter');
      } catch (err) {
        console.error('Claude tweets failed:', err.message);
        twitterNews = [];
      }
    }

    // 3) Si no hubo noticias web reales, generar noticias web con Claude
    if (webNews.length === 0 && anthropicKey) {
      const webPrompt = `
Generate 8 realistic recent football news articles about ${name} (${team}).

Use these sources only:
Marca, AS, Sport, Sky Sports, BBC Sport, Relevo, ESPN, Mundo Deportivo

Return ONLY a valid JSON array.
No markdown.
No explanation.
No code fences.

Format:
[
  {
    "type": "web",
    "source": "Marca",
    "handle": null,
    "title": "headline max 75 chars",
    "excerpt": "one short sentence",
    "url": null,
    "time": "hace 2h",
    "minutesAgo": 120
  }
]

Rules:
- minutesAgo must be a number between 30 and 4320
- title max 75 chars
- excerpt max 120 chars
- output only the JSON array
`;

      try {
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1500,
            messages: [{ role: 'user', content: webPrompt }]
          })
        });

        if (!claudeRes.ok) {
          const errText = await claudeRes.text();
          throw new Error(`Anthropic web error ${claudeRes.status}: ${errText}`);
        }

        const claudeData = await claudeRes.json();
        const raw = claudeData.content?.find((b) => b.type === 'text')?.text || '[]';
        webNews = normalizeNewsArray(safeParseJSON(raw), 'web');
      } catch (err) {
        console.error('Claude web failed:', err.message);
        webNews = [];
      }
    }

    // 4) Fallback extremo: si no hay nada, devolver al menos 1 item visible
    if (webNews.length === 0 && twitterNews.length === 0) {
      webNews = [
        {
          type: 'web',
          source: 'Google News',
          handle: null,
          title: `Buscar noticias de ${name}`,
          excerpt: `No se pudieron cargar noticias automáticas para ${name} (${team}).`,
          url: `https://news.google.com/search?q=${encodeURIComponent(name + ' ' + team + ' football')}&hl=es`,
          time: 'ahora',
          minutesAgo: 0
        }
      ];
    }

    const all = [...webNews, ...twitterNews]
      .filter(Boolean)
      .map((n) => ({
        ...n,
        url: n.url || buildSearchUrl(n),
        title: truncate(n.title || 'Sin título', n.type === 'twitter' ? 200 : 80),
        excerpt: truncate(n.excerpt || '', 120),
        minutesAgo: Number.isFinite(Number(n.minutesAgo)) ? Number(n.minutesAgo) : 9999
      }))
      .sort((a, b) => a.minutesAgo - b.minutesAgo);

    return res.status(200).json({
      news: all,
      player: name,
      team
    });
  } catch (e) {
    console.error('api/news fatal error:', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}

// Helpers

function truncate(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trim() + '…';
}

function timeAgo(dateStr) {
  if (!dateStr) return 'reciente';
  const mins = minutesSince(dateStr);
  if (mins < 60) return `hace ${Math.max(1, mins)}min`;
  if (mins < 1440) return `hace ${Math.floor(mins / 60)}h`;
  return `hace ${Math.floor(mins / 1440)} días`;
}

function minutesSince(dateStr) {
  if (!dateStr) return 9999;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return 9999;
  return Math.max(0, Math.floor((Date.now() - d) / 60000));
}

function buildSearchUrl(n) {
  if (n.type === 'twitter') {
    return `https://x.com/search?q=${encodeURIComponent(n.title)}&f=live`;
  }
  return `https://news.google.com/search?q=${encodeURIComponent((n.source || '') + ' ' + (n.title || ''))}&hl=es`;
}

function safeParseJSON(raw) {
  try {
    const cleaned = String(raw || '')
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/gi, '')
      .trim();

    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');

    if (start !== -1 && end !== -1 && end >= start) {
      const arr = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {
    console.error('safeParseJSON error:', e.message);
  }

  return [];
}

function normalizeNewsArray(arr, defaultType) {
  if (!Array.isArray(arr)) return [];

  return arr
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      type: item.type || defaultType,
      source: item.source || 'Desconocido',
      handle: item.handle || null,
      title: item.title || 'Sin título',
      excerpt: item.excerpt || '',
      url: item.url || null,
      time: item.time || 'reciente',
      minutesAgo: Number.isFinite(Number(item.minutesAgo)) ? Number(item.minutesAgo) : 9999
    }));
}
