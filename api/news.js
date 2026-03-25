// api/news.js
// Noticias reales desde Google News RSS (hasta 1 año)

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
    return res.status(400).json({ error: 'Missing player name' });
  }

  try {

    // 1️⃣ últimas 24 horas
    let items = await fetchGoogleNews(buildQuery(name, team, 'day'));

    // 2️⃣ última semana
    if (items.length < 4) {
      items = await fetchGoogleNews(buildQuery(name, team, 'week'));
    }

    // 3️⃣ último año
    if (items.length < 4) {
      items = await fetchGoogleNews(buildQuery(name, team, 'year'));
    }

    // 4️⃣ fallback sin equipo
    if (items.length < 4) {
      items = await fetchGoogleNews(buildQuery(name, null, 'year'));
    }

    const news = items
      .filter(item => isRelevant(item, name, team))
      .filter(item => minutesSince(item.pubDate) <= 525600) // 1 año
      .sort((a, b) => minutesSince(a.pubDate) - minutesSince(b.pubDate))
      .slice(0, 12)
      .map(item => ({
        type: 'web',
        source: item.source || 'Google News',
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

  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    `&hl=es-419&gl=AR&ceid=AR:es-419`;

  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Google News error ${r.status}: ${err}`);
  }

  const xml = await r.text();

  return parseRSS(xml);
}

function buildQuery(name, team, range) {

  const parts = [`"${name}"`];

  if (team) parts.push(`"${team}"`);

  parts.push('(football OR futbol OR soccer)');

  if (range === 'day') parts.push('when:1d');
  if (range === 'week') parts.push('when:7d');
  if (range === 'year') parts.push('when:365d');

  return parts.join(' ');
}

function parseRSS(xml) {

  const items = [];
  const matches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  for (const raw of matches) {

    const title = decode(stripCdata(tag(raw, 'title')));
    const link = decode(stripCdata(tag(raw, 'link')));
    const pubDate = decode(stripCdata(tag(raw, 'pubDate')));
    const description = cleanDescription(tag(raw, 'description'));
    const source = decode(stripCdata(tag(raw, 'source')));

    if (title && link) {
      items.push({
        title: cleanTitle(title),
        link,
        pubDate,
        description,
        source
      });
    }
  }

  return dedupe(items);
}

function tag(text, tag) {
  const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = text.match(r);
  return m ? m[1] : '';
}

function stripCdata(text) {
  return String(text || '')
    .replace('<![CDATA[', '')
    .replace(']]>', '')
    .trim();
}

function cleanTitle(t) {
  return String(t)
    .replace(/\s*-\s*[^-]+$/, '')
    .trim();
}

function cleanDescription(html) {

  const text = String(html || '')
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > 160
    ? text.slice(0, 159) + '…'
    : text;
}

function decode(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function dedupe(items) {

  const seen = new Set();
  const out = [];

  for (const i of items) {

    const key = normalize(i.title);

    if (!seen.has(key)) {
      seen.add(key);
      out.push(i);
    }
  }

  return out;
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isRelevant(item, name, team) {

  const text = normalize(
    `${item.title} ${item.description} ${item.source}`
  );

  const player = normalize(name);

  if (!text.includes(player)) return false;

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

  if (mins < 60) return `hace ${mins} min`;
  if (mins < 1440) return `hace ${Math.floor(mins / 60)} h`;

  return `hace ${Math.floor(mins / 1440)} días`;
}
