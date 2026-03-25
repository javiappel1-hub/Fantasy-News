// api/news.js
// Noticias reales desde Google News RSS

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
    const query = buildQuery(name, team);

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
    const items = parseGoogleNewsRSS(xml);

    const news = items
      .filter(item => isRelevant(item, name, team))
      .slice(0, 12)
      .map(item => ({
        type: 'web',
        source: item.source || 'Google News',
        handle: null,
        title: item.title,
        excerpt: item.description || '',
        url: item.link,
        time: timeAgo(item.pubDate),
        minutesAgo: minutesSince(item.pubDate)
      }))
      .sort((a, b) => a.minutesAgo - b.minutesAgo);

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

function buildQuery(name, team) {
  const parts = [`"${name}"`];

  if (team) {
    parts.push(`"${team}"`);
  }

  parts.push('(football OR futbol OR soccer)');

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

  return items;
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
    .trim();
}

function cleanDescription(html) {
  const text = String(html || '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > 140 ? text.slice(0, 139).trim() + '…' : text;
}

function decodeHtml(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isRelevant(item, name, team) {
  const haystack = `${item.title} ${item.description} ${item.source}`.toLowerCase();
  const playerOk = haystack.includes(String(name || '').toLowerCase());

  if (!playerOk) return false;

  if (!team) return true;

  return haystack.includes(String(team).toLowerCase()) || true;
}

function minutesSince(dateStr) {
  if (!dateStr) return 9999;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return 9999;
  return Math.max(0, Math.floor((Date.now() - d) / 60000));
}

function timeAgo(dateStr) {
  const mins = minutesSince(dateStr);
  if (mins === 9999) return 'reciente';
  if (mins < 60) return `hace ${Math.max(1, mins)}min`;
  if (mins < 1440) return `hace ${Math.floor(mins / 60)}h`;
  return `hace ${Math.floor(mins / 1440)} días`;
}
