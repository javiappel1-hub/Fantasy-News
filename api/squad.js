// api/squad.js
// Busca el plantel de un equipo usando la API no oficial de ESPN
// Sin API key, sin límites, 100% gratuito

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { team, league } = req.query;
  if (!team) return res.status(400).json({ error: 'Missing team' });

  try {
    // 1. Buscar el equipo en ESPN
    const leagueSlug = getLeagueSlug(league);
    const searchUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams`;
    const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });

    if (!searchRes.ok) throw new Error(`ESPN error ${searchRes.status}`);
    const searchData = await searchRes.json();

    // Buscar el equipo por nombre
    const teams = searchData?.sports?.[0]?.leagues?.[0]?.teams || [];
    const found = teams.find(t => {
      const name = (t.team?.displayName || t.team?.name || '').toLowerCase();
      const teamLower = team.toLowerCase();
      return name.includes(teamLower) || teamLower.includes(name.split(' ')[0]);
    });

    if (!found) {
      return res.status(200).json({ players: [], found: false, message: `No se encontró ${team} en ESPN` });
    }

    const teamId = found.team.id;
    const teamName = found.team.displayName;

    // 2. Obtener el plantel del equipo
    const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${teamId}/roster`;
    const rosterRes = await fetch(rosterUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });

    if (!rosterRes.ok) throw new Error(`ESPN roster error ${rosterRes.status}`);
    const rosterData = await rosterRes.json();

    // ESPN puede devolver athletes en distintos niveles
    let athleteList = [];
    if (Array.isArray(rosterData?.athletes)) {
      // Puede ser array directo o array de grupos por posición
      if (rosterData.athletes[0]?.items) {
        // Estructura agrupada: [{position, items:[...athletes]}]
        rosterData.athletes.forEach(group => {
          if (Array.isArray(group.items)) athleteList.push(...group.items);
        });
      } else {
        athleteList = rosterData.athletes;
      }
    } else if (Array.isArray(rosterData?.roster)) {
      athleteList = rosterData.roster;
    }

    const players = athleteList.map(a => ({
      id: a.id,
      name: a.displayName || a.fullName || `${a.firstName} ${a.lastName}`.trim(),
      firstName: a.firstName || '',
      lastName: a.lastName || '',
      position: mapPosition(a.position?.abbreviation),
      number: a.jersey || '',
    })).filter(p => p.name);

    return res.status(200).json({ players, teamName, teamId, found: true });

  } catch (e) {
    console.error('squad error:', e);
    return res.status(500).json({ error: e.message, players: [] });
  }
}

function getLeagueSlug(league) {
  const map = {
    AR: 'arg.1',
    ES: 'esp.1',
    GB: 'eng.1',
    IT: 'ita.1',
    DE: 'ger.1',
    FR: 'fra.1',
    BR: 'bra.1',
    MX: 'mex.1',
    US: 'usa.1',
    UY: 'ury.1',
    CL: 'chi.1',
    CO: 'col.1',
    PT: 'por.1',
    NL: 'ned.1',
    TR: 'tur.1',
  };
  return map[league] || 'eng.1';
}

function mapPosition(abbr) {
  const map = { GK:'POR', G:'POR', D:'DEF', DF:'DEF', M:'MED', MF:'MED', F:'DEL', FW:'DEL', A:'DEL' };
  return map[(abbr||'').toUpperCase()] || 'MED';
}
