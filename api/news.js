// api/news.js — Google News RSS mejorado para Premier + otras ligas

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { name, team } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing player name' });

  try {
    const parts = name.trim().split(' ');
    const lastName = parts[parts.length - 1];
    const firstName = parts[0];

    // Detectar liga por nombre de equipo
    const isPremier = isPremierTeam(team);

    // Construir queries en inglés si es Premier, español si no
    const queries = buildQueries(name, lastName, team, isPremier);

    const allItems = [];
    for (const q of queries) {
      try {
        const items = await fetchGoogleNews(q.query, q.lang);
        const filtered = items
          .filter(i => isRelevant(i, name, lastName, firstName, team))
          .map(i => ({ ...i, bucket: q.bucket }));
        allItems.push(...filtered);
      } catch (e) {
        console.error('Query failed:', q.query, e.message);
      }
    }

    // Deduplicar y ordenar
    const deduped = dedupeByTitle(allItems)
      .sort((a, b) => minutesSince(a.pubDate) - minutesSince(b.pubDate))
      .slice(0, 60);

    const news = deduped.map(item => ({
      type: 'web',
      category: detectCategory(item),
      source: item.source || 'Google News',
      title: item.title,
      excerpt: item.description || '',
      url: item.link,
      time: timeAgo(item.pubDate),
      minutesAgo: minutesSince(item.pubDate)
    }));

    return res.status(200).json({ player: name, team: team || null, news });

  } catch (e) {
    console.error('api/news error:', e);
    return res.status(500).json({ error: e.message });
  }
}

function isPremierTeam(team) {
  if (!team) return false;
  const premier = ['liverpool','chelsea','arsenal','manchester','city','united','tottenham','newcastle','west ham','aston villa','brighton','fulham','brentford','crystal palace','everton','nottingham','bournemouth','wolves','wolverhampton','leicester','ipswich','southampton'];
  return premier.some(t => team.toLowerCase().includes(t));
}

function buildQueries(name, lastName, team, isPremier) {
  const queries = [];
  const teamStr = team ? ` "${team}"` : '';

  if (isPremier) {
    queries.push({ query: `"${name}"${teamStr} football when:7d`, lang: 'en', bucket: '7d' });
    queries.push({ query: `"${name}" football when:30d`, lang: 'en', bucket: '30d' });
    queries.push({ query: `"${lastName}"${teamStr} football when:7d`, lang: 'en', bucket: '7d' });
    queries.push({ query: `"${lastName}" football injury lineup when:30d`, lang: 'en', bucket: '30d' });
    queries.push({ query: `"${lastName}" premier league when:30d`, lang: 'en', bucket: '30d' });
    queries.push({ query: `"${lastName}"${teamStr} when:90d`, lang: 'en', bucket: '365d' });
  } else {
    queries.push({ query: `"${name}"${teamStr} fútbol when:7d`, lang: 'es', bucket: '7d' });
    queries.push({ query: `"${name}" fútbol when:30d`, lang: 'es', bucket: '30d' });
    queries.push({ query: `"${lastName}"${teamStr} fútbol when:30d`, lang: 'es', bucket: '30d' });
    queries.push({ query: `"${name}"${teamStr} football when:7d`, lang: 'en', bucket: '7d' });
    queries.push({ query: `"${lastName}"${teamStr} football when:30d`, lang: 'en', bucket: '30d' });
    queries.push({ query: `"${lastName}" fútbol when:90d`, lang: 'es', bucket: '365d' });
  }

  return queries;
}

async function fetchGoogleNews(query, lang = 'en') {
  const locale = lang === 'es' ? 'es-419&gl=AR&ceid=AR:es-419' : 'en-US&gl=US&ceid=US:en';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${locale}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Google News error ${r.status}`);
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
    const description = cleanHtml(decode(stripCdata(tag(raw, 'description'))));
    const source = decode(stripCdata(tag(raw, 'source')));
    if (title && link) items.push({ title, link, pubDate, description, source });
  }
  return items;
}

function isRelevant(item, fullName, lastName, firstName, team) {
  const text = normalize(`${item.title} ${item.description}`);
  const normalFull = normalize(fullName);
  const normalLast = normalize(lastName);
  const normalFirst = normalize(firstName);
  const normalTeam = normalize(team || '');

  // Siempre acepta si aparece el nombre completo
  if (text.includes(normalFull)) return true;

  // Apellido + equipo = válido
  if (normalLast.length >= 4 && normalTeam && text.includes(normalLast) && text.includes(normalTeam)) return true;

  // Apellido + primer nombre = válido
  if (normalLast.length >= 4 && text.includes(normalLast) && text.includes(normalFirst)) return true;

  return false;
}

function detectCategory(item) {
  const text = normalize(`${item.title} ${item.description}`);
  if (containsAny(text, ['injury','injured','injur','lesion','lesión','baja','out','doubt','fitness','recovery','knock'])) return 'injuries';
  if (containsAny(text, ['suspension','suspended','ban','banned','sancion','sanción','red card','tarjeta'])) return 'suspensions';
  if (containsAny(text, ['lineup','starting','titular','starter','bench','suplente','xi','squad','selection','convocatoria'])) return 'lineups';
  if (containsAny(text, ['transfer','fichaje','loan','rumour','rumor','mercado','signing','sign','deal','move','bid'])) return 'transfers';
  return 'general';
}

function containsAny(text, terms) { return terms.some(t => text.includes(t)); }

function dedupeByTitle(items) {
  const seen = new Set();
  return items.filter(i => {
    const k = normalize(i.title).substring(0, 60);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function tag(text, name) {
  const m = text.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1] : '';
}
function stripCdata(t) { return String(t || '').replace('<![CDATA[', '').replace(']]>', '').trim(); }
function cleanHtml(html) { return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }
function decode(s) { return String(s || '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"); }
function normalize(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\s]/g,' ').replace(/\s+/g,' ').trim(); }
function minutesSince(d) { return Math.floor((Date.now() - new Date(d).getTime()) / 60000); }
function timeAgo(d) {
  const m = minutesSince(d);
  if (m < 60) return `hace ${m}min`;
  if (m < 1440) return `hace ${Math.floor(m/60)}h`;
  return `hace ${Math.floor(m/1440)} días`;
}
