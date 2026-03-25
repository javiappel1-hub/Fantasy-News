// api/news.js
// Noticias reales desde Google News RSS
// Devuelve hasta 30 resultados, priorizando recencia

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
    const queries = buildQueries(name, team);

    const bucketed = {
      '1d': [],
      '7d': [],
      '30d': [],
      '365d': []
    };

    for (const query of queries) {
      try {
        const items = await fetchGoogleNews(query.q);

        const cleaned = items
          .filter((item) => isRelevant(item, name))
          .filter((item) => minutesSince(item.pubDate) <= 525600) // hasta 1 año
          .map((item) => ({
            ...item,
            bucket: query.bucket
          }));

        bucketed[query.bucket].push(...cleaned);
      } catch (err) {
        console.error('query failed:', query.q, err.message);
      }
    }

    // Deduplicar dentro de cada bucket
    for (const key of Object.keys(bucketed)) {
      bucketed[key] = dedupeByTitleAndLink(bucketed[key])
        .sort((a, b) => minutesSince(a.pubDate) - minutesSince(b.pubDate));
    }

    // Mezcla priorizando recencia, pero permitiendo volumen
    let finalItems = [
      ...bucketed['1d'].slice(0, 10),
      ...bucketed['7d'].slice(0, 10),
      ...bucketed['30d'].slice(0, 10)
    ];

    // Completar con 1 año si todavía falta volumen
    if (finalItems.length < 30) {
      const usedKeys = new Set(
        finalItems.map((item) => `${normalize(item.title)}|${normalize(item.link)}`)
      );

      for (const item of bucketed['365d']) {
        const key = `${normalize(item.title)}|${normalize(item.link)}`;
        if (!usedKeys.has(key)) {
          finalItems.push(item);
          usedKeys.add(key);
        }
        if (finalItems.length >= 30) break;
      }
    }

    // Deduplicación final y orden final
    finalItems = dedupeByTitleAndLink(finalItems)
      .sort((a, b) => minutesSince(a.pubDate) - minutesSince(b.pubDate))
      .slice(0, 30);

    const sources = unique(finalItems.map((x) => x.source).filter(Boolean)).slice(0, 6);
    const newestMinutes = finalItems.length ? minutesSince(finalItems[0].pubDate) : null;

    const news = finalItems.map((item) => ({
      type: 'web',
      source: item.source || 'Google News',
      title: item.title,
      excerpt: item.description || '',
      url: item.link,
      time: timeAgo(item.pubDate),
      minutesAgo: minutesSince(item.pubDate)
    }));

    const summary = {
      count: news.length,
      latest: newestMinutes === null ? 'sin noticias' : timeAgo(finalItems[0].pubDate),
      sources,
      text: buildSummaryText(name, news.length, newestMinutes, sources)
    };

    return res.status(200).json({
      player: name,
      team: team || null,
      summary,
      news
    });
  } catch (e) {
    console.error('api/news error:', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}

function buildQueries(name, team) {
  const queries = [];
  const cleanName = String(name || '').trim();
  const cleanTeam = String(team || '').trim();

  const quotedName = `"${cleanName}"`;

  const parts = cleanName.split(' ').filter(Boolean);
  const shortName = parts.length >= 2 ? `"${parts[parts.length - 1]}"` : quotedName;

  const fullNameQuery = cleanTeam
    ? `${quotedName} "${cleanTeam}" (football OR futbol OR soccer)`
    : `${quotedName} (football OR futbol OR soccer)`;

  const shortNameQuery = cleanTeam
    ? `${shortName} "${cleanTeam}" (football OR futbol OR soccer)`
    : `${shortName} (football OR futbol OR soccer)`;

  queries.push({ q: `${fullNameQuery} when:1d`, bucket: '1d' });
  queries.push({ q: `${shortNameQuery} when:1d`, bucket: '1d' });

  queries.push({ q: `${fullNameQuery} when:7d`, bucket: '7d' });
  queries.push({ q: `${shortNameQuery} when:7d`, bucket: '7d' });

  queries.push({ q: `${fullNameQuery} when:30d`, bucket: '30d' });
  queries.push({ q: `${shortNameQuery} when:30d`, bucket: '30d' });

  queries.push({ q: `${fullNameQuery} when:365d`, bucket: '365d' });
  queries.push({ q: `${shortName} when:365d`, bucket: '365d' });

  return dedupeQueries(queries);
}

function dedupeQueries(queries) {
  const seen = new Set();
  const out = [];

  for (const item of queries) {
    const key = item.q.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }

  return out;
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

function parseRSS(xml) {
  const items = [];
  const matches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  for (const raw of matches) {
    const title = decode(stripCdata(tag(raw, 'title')));
    const link = decode(stripCdata(tag(raw, 'link')));
    const pubDate = decode(stripCdata(tag(raw, 'pubDate')));
    const description = cleanDescription(decode(stripCdata(tag(raw, 'description'))));
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

  return items;
}

function tag(text, tagName) {
  const r = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
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
  return String(t || '')
    .replace(/\s*-\s*[^-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDescription(html) {
  const text = String(html || '')
    .replace(/<a\b[^>]*>.*?<\/a>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > 180 ? text.slice(0, 179).trim() + '…' : text;
}

function decode(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRelevant(item, name) {
  const text = normalize(`${item.title} ${item.description} ${item.source}`);
  const player = normalize(name);

  if (!player) return false;
  if (text.includes(player)) return true;

  const parts = player.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    let matches = 0;
    for (const p of parts) {
      if (p.length >= 3 && text.includes(p)) matches++;
    }
    return matches >= 2;
  }

  return false;
}

function dedupeByTitleAndLink(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = `${normalize(item.title)}|${normalize(item.link)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

function unique(arr) {
  return [...new Set(arr)];
}

function minutesSince(dateStr) {
  if (!dateStr) return 999999;

  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return 999999;

  return Math.max(0, Math.floor((Date.now() - d) / 60000));
}

function timeAgo(dateStr) {
  const mins = minutesSince(dateStr);

  if (mins < 60) return `hace ${Math.max(1, mins)} min`;
  if (mins < 1440) return `hace ${Math.floor(mins / 60)} h`;
  if (mins < 43200) return `hace ${Math.floor(mins / 1440)} días`;
  if (mins < 525600) return `hace ${Math.floor(mins / 43200)} meses`;

  return `hace más de 1 año`;
}

function buildSummaryText(name, count, newestMinutes, sources) {
  if (!count) {
    return `No se encontraron noticias recientes sobre ${name}.`;
  }

  const latestText =
    newestMinutes === null ? '' : ` Última actualización ${timeAgoFromMinutes(newestMinutes)}.`;

  const sourcesText =
    sources.length ? ` Fuentes: ${sources.join(', ')}.` : '';

  return `Se encontraron ${count} noticias sobre ${name}.${latestText}${sourcesText}`;
}

function timeAgoFromMinutes(mins) {
  if (mins < 60) return `hace ${Math.max(1, mins)} min`;
  if (mins < 1440) return `hace ${Math.floor(mins / 60)} h`;
  if (mins < 43200) return `hace ${Math.floor(mins / 1440)} días`;
  return `hace ${Math.floor(mins / 43200)} meses`;
}
