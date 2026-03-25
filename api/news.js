// api/news.js
// Noticias reales recientes desde Google News RSS

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, team } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Falta el parámetro name' });
  }

  try {
    // 1) intentamos muy reciente: últimas 24h
    let items = await fetchGoogleNews(buildQuery(name, team, 'd'));

    // 2) si hay muy poco, ampliamos a últimos 7 días
    if (items.length < 4) {
      items = await fetchGoogleNews(buildQuery(name, team, 'w'));
    }

    // 3) si sigue habiendo poco, búsqueda más amplia sin equipo
    if (items.length < 4) {
      items = await fetchGoogleNews(buildQuery(name, null, 'w'));
    }

    const news = items
      .filter((item) => isRelevant(item, name, team))
      .filter((item) => minutesSince(item.pubDate) <= 10080) // max 7 días
      .sort((a, b) => minutesSince(a.pubDate) - minutesSince(b.pubDate))
      .slice(0, 12)
      .map((item) => ({
        type: 'web',
        source: item.source || 'Google News',
        handle: null,
        title: item.title,
        excerpt: item.description || '',
        url: item.link,
        time: timeAgo(item.pubDate),
        minutesAgo: minutesSince(item.pubDate)
      }));

    return res.status(200).json({
      news,
      player: name,
      team: team || null
    });
  } catch (e) {
    console.error('api/news error:', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}

async function fetchGoogleNews(query) {
  const rssUrl =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    `&hl=es-419&gl=AR&ceid=AR:es-419`;

  const rssRes = await fetch(rssUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  if (!rssRes.ok) {
    const errText = await rssRes.text();
    throw new Error(`Google News RSS error ${rssRes.status}: ${errText}`);
  }

  const xml = await rssRes.text();
  return parseGoogleNewsRSS(xml);
}

function buildQuery(name, team, recency = 'd') {
  // recency: d = último día, w = última semana
  const parts = [`"${name}"`];

  if (team) {
    parts.push(`"${team}"`);
  }

  parts.push('(football OR futbol OR soccer)');
  parts.push(`when:${recency}`);

  return parts.join(' ');
}

function parseGoogleNewsRSS(xml) {
  const items = [];
  const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  for (const rawItem of itemMatches) {
    const title = decodeHtml(stripCdata(extractTag(rawItem, 'title')));
    const link = decodeHtml(stripCdata(extractTag(rawItem, 'link')));
    const pubDate = decodeHtml(stripCdata(extractTag(rawItem, 'pubDate')));
    const descriptionRaw = decodeHtml(stripCdata(extractTag(rawItem, 'description')));
    const source = decodeHtml(stripCdata(extractTag(rawItem, 'source')));

    const description = cleanDescription(descriptionRaw);

    if (title && link) {
      items.push({
        title: cleanTitle(title),
        link,
        pubDate,
        source,
        description
      });
    }
  }

  return dedupeByTitle(items);
}

function dedupeByTitle(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = normalizeText(item.title);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

function extractTag(text, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function stripCdata(text) {
  return String(text || '')
    .replace('<![CDATA[', '')
    .replace(']]>', '')
    .trim();
}

function cleanTitle(title) {
  return String(title || '')
    .replace(/\s*-\s*[^-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDescription(html) {
  const text = String(html || '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > 160 ? text.slice(0, 159).trim() + '…' : text;
}

function decodeHtml(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRelevant(item, name, team) {
  const haystack = normalizeText(
    `${item.title} ${item.description} ${item.source}`
  );

  const player = normalizeText(name);
  const teamNorm = normalizeText(team || '');

  if (!haystack.includes(player)) return false;

  // Si viene team, tratamos de priorizarlo, pero no lo hacemos obligatorio
  // porque muchas notas nombran al jugador y no siempre repiten el club.
  if (teamNorm && haystack.includes(teamNorm)) return true;

  return true;
}

function minutesSince(dateStr) {
  if (!dateStr) return 999999;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return 999999;
  return Math.max(0, Math.floor((Date.now() - d) / 60000));
}

function timeAgo(dateStr) {
  const mins = minutesSince(dateStr);
  if (mins < 60) return `hace ${Math.max(1, mins)}min`;
  if (mins < 1440) return `hace ${Math.floor(mins / 60)}h`;
  return `hace ${Math.floor(mins / 1440)} días`;
}
