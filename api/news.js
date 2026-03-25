// api/news.js
// Noticias reales desde Google News RSS
// Devuelve hasta 60 resultados y clasifica por categoría

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
          .filter((item) => minutesSince(item.pubDate) <= 525600)
          .map((item) => ({
            ...item,
            bucket: query.bucket
          }));

        bucketed[query.bucket].push(...cleaned);
      } catch (err) {
        console.error('query failed:', query.q, err.message);
      }
    }

    for (const key of Object.keys(bucketed)) {
      bucketed[key] = dedupeByTitleAndLink(bucketed[key])
        .sort((a, b) => minutesSince(a.pubDate) - minutesSince(b.pubDate));
    }

    let finalItems = [
      ...bucketed['1d'].slice(0, 20),
      ...bucketed['7d'].slice(0, 20),
      ...bucketed['30d'].slice(0, 20)
    ];

    if (finalItems.length < 60) {
      const used = new Set(
        finalItems.map((i) => `${normalize(i.title)}|${normalize(i.link)}`)
      );

      for (const item of bucketed['365d']) {
        const key = `${normalize(item.title)}|${normalize(item.link)}`;
        if (!used.has(key)) {
          finalItems.push(item);
          used.add(key);
        }
        if (finalItems.length >= 60) break;
      }
    }

    finalItems = dedupeByTitleAndLink(finalItems)
      .sort((a, b) => minutesSince(a.pubDate) - minutesSince(b.pubDate))
      .slice(0, 60);

    const news = finalItems.map((item) => ({
      type: 'web',
      category: detectCategory(item),
      source: item.source || 'Google News',
      title: item.title,
      excerpt: item.description || '',
      url: item.link,
      time: timeAgo(item.pubDate),
      minutesAgo: minutesSince(item.pubDate)
    }));

    return res.status(200).json({
      player: name,
      team: team || null,
      news
    });

  } catch (e) {
    console.error('api/news error:', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}

function detectCategory(item) {
  const text = normalize(`${item.title} ${item.description}`);

  if (containsAny(text,['injury','injuries','lesion','lesión','medical','recovery','fitness']))
    return 'injuries';

  if (containsAny(text,['suspension','suspended','ban','banned','sancion','sanción','tarjetas','red card']))
    return 'suspensions';

  if (containsAny(text,['lineup','starting xi','titular','starter','bench','suplente','convocatoria']))
    return 'lineups';

  if (containsAny(text,['transfer','fichaje','loan','rumour','rumor','mercado']))
    return 'transfers';

  return 'general';
}

function containsAny(text, terms) {
  return terms.some(t => text.includes(normalize(t)));
}

function buildQueries(name, team) {

  const quotedName = `"${name}"`;

  const base = team
    ? `${quotedName} "${team}" (football OR futbol OR soccer)`
    : `${quotedName} (football OR futbol OR soccer)`;

  return [
    {q:`${base} when:1d`, bucket:'1d'},
    {q:`${base} when:7d`, bucket:'7d'},
    {q:`${base} when:30d`, bucket:'30d'},
    {q:`${base} when:365d`, bucket:'365d'}
  ];
}

async function fetchGoogleNews(query){

  const url=`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es-419&gl=AR&ceid=AR:es-419`;

  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
  if(!r.ok) throw new Error(`Google News error ${r.status}`);

  const xml=await r.text();
  return parseRSS(xml);
}

function parseRSS(xml){

  const items=[];
  const matches=xml.match(/<item>([\s\S]*?)<\/item>/g)||[];

  for(const raw of matches){

    const title=decode(stripCdata(tag(raw,'title')));
    const link=decode(stripCdata(tag(raw,'link')));
    const pubDate=decode(stripCdata(tag(raw,'pubDate')));
    const description=cleanDescription(decode(stripCdata(tag(raw,'description'))));
    const source=decode(stripCdata(tag(raw,'source')));

    if(title&&link){
      items.push({title,link,pubDate,description,source});
    }
  }

  return items;
}

function tag(text,tagName){
  const r=new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`,'i');
  const m=text.match(r);
  return m?m[1]:'';
}

function stripCdata(t){
  return String(t||'').replace('<![CDATA[','').replace(']]>','').trim();
}

function cleanDescription(html){
  return String(html||'')
    .replace(/<a\b[^>]*>.*?<\/a>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,180);
}

function decode(str){
  return String(str||'')
    .replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'");
}

function normalize(str){
  return String(str||'')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\w\s]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function isRelevant(item,name){
  const text=normalize(`${item.title} ${item.description}`);
  const player=normalize(name);
  return text.includes(player);
}

function dedupeByTitleAndLink(items){

  const seen=new Set();
  const out=[];

  for(const i of items){
    const key=`${normalize(i.title)}|${normalize(i.link)}`;
    if(!seen.has(key)){
      seen.add(key);
      out.push(i);
    }
  }

  return out;
}

function minutesSince(dateStr){
  const d=new Date(dateStr).getTime();
  return Math.floor((Date.now()-d)/60000);
}

function timeAgo(dateStr){
  const mins=minutesSince(dateStr);
  if(mins<60)return`hace ${mins} min`;
  if(mins<1440)return`hace ${Math.floor(mins/60)} h`;
  return`hace ${Math.floor(mins/1440)} días`;
}
