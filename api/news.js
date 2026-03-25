// api/news.js — Google News RSS mejorado para Premier + otras ligas

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { name, team, league } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing player name' });

  try {
    const queries = buildQueries(name, team, league);
    const allItems = [];

    for (const q of queries) {
      try {
        const items = await fetchGoogleNews(q.query, q.locale);
        const filtered = items
          .filter(i => isRelevant(i, name))
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

function detectLocale(team, league) {
  // Si viene la liga explícita del usuario, usarla directamente
  const localeMap = {
    AR: { hl:'es-AR', gl:'AR', lang:'es' },
    UY: { hl:'es-419', gl:'UY', lang:'es' },
    CL: { hl:'es-419', gl:'CL', lang:'es' },
    CO: { hl:'es-419', gl:'CO', lang:'es' },
    BR: { hl:'pt-BR', gl:'BR', lang:'pt' },
    MX: { hl:'es-MX', gl:'MX', lang:'es' },
    US: { hl:'en-US', gl:'US', lang:'en' },
    ES: { hl:'es-ES', gl:'ES', lang:'es' },
    GB: { hl:'en-GB', gl:'GB', lang:'en' },
    IT: { hl:'it-IT', gl:'IT', lang:'it' },
    DE: { hl:'de-DE', gl:'DE', lang:'de' },
    FR: { hl:'fr-FR', gl:'FR', lang:'fr' },
    PT: { hl:'pt-PT', gl:'PT', lang:'pt' },
    NL: { hl:'nl-NL', gl:'NL', lang:'nl' },
    TR: { hl:'tr-TR', gl:'TR', lang:'tr' },
    OTHER: { hl:'en-US', gl:'US', lang:'en' },
  };

  if (league && localeMap[league]) return localeMap[league];

  // Fallback: detectar por nombre de equipo
  const t = (team || '').toLowerCase();
  if (['boca','river','racing','independiente','san lorenzo','talleres','belgrano','central','newell','godoy','tigre','huracán','vélez','estudiantes','lanús','banfield'].some(x=>t.includes(x))) return localeMap.AR;
  if (['madrid','barcelona','atletico','sevilla','valencia','villarreal','betis','athletic','sociedad','getafe','osasuna','girona'].some(x=>t.includes(x))) return localeMap.ES;
  if (['arsenal','chelsea','liverpool','city','united','tottenham','newcastle','west ham','aston villa','brighton','fulham','brentford','everton','nottingham','bournemouth','wolves','leicester'].some(x=>t.includes(x))) return localeMap.GB;
  if (['juventus','inter','milan','napoli','roma','lazio','fiorentina','atalanta','torino','bologna'].some(x=>t.includes(x))) return localeMap.IT;
  if (['paris','psg','marseille','lyon','monaco','lille','rennes','nice','lens'].some(x=>t.includes(x))) return localeMap.FR;
  if (['bayern','dortmund','leverkusen','frankfurt','leipzig','wolfsburg'].some(x=>t.includes(x))) return localeMap.DE;
  if (['flamengo','palmeiras','corinthians','santos','são paulo','atletico mineiro','internacional','gremio','fluminense'].some(x=>t.includes(x))) return localeMap.BR;

  return localeMap.US; // default inglés
}

function buildQueries(name, team, league) {
  const locale = detectLocale(team, league);
  const teamStr = team ? ` "${team}"` : '';

  return [
    { query: `"${name}"${teamStr} when:7d`,  locale, bucket: '7d' },
    { query: `"${name}" when:14d`,            locale, bucket: '7d' },
    { query: `"${name}"${teamStr} when:30d`,  locale, bucket: '30d' },
    { query: `"${name}" when:60d`,            locale, bucket: '30d' },
    { query: `"${name}" when:90d`,            locale, bucket: '365d' },
  ];
}

async function fetchGoogleNews(query, locale) {
  const { hl, gl } = locale;
  const ceid = `${gl}:${hl.split('-')[0]}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
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

function isRelevant(item, fullName) {
  const text = normalize(`${item.title} ${item.description}`);
  return text.includes(normalize(fullName));
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
