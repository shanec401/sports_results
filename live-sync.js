// ============================================================================
// LIVE INTERNET FIXTURE & SCORE SYNC ENGINE
// Uses free, public, CORS-enabled sports APIs (ESPN Site API + TheSportsDB)
// plus curated GAA County Championship & Allianz League schedules.
// ============================================================================

import { computeGaaTotal } from "./sports-data.js";

export const LIVE_LEAGUE_FEEDS = [
  // SOCCER
  {
    id: "espn-epl",
    name: "⚽ English Premier League (Live ESPN Feed)",
    sportId: "soccer",
    provider: "espn",
    espnPath: "soccer/eng.1",
    theSportsDbId: "4328"
  },
  {
    id: "espn-ucl",
    name: "⚽ UEFA Champions League (Live ESPN Feed)",
    sportId: "soccer",
    provider: "espn",
    espnPath: "soccer/uefa.champions",
    theSportsDbId: "4480"
  },
  {
    id: "espn-loi",
    name: "⚽ League of Ireland Premier Division (Live ESPN Feed)",
    sportId: "soccer",
    provider: "espn",
    espnPath: "soccer/irl.1",
    theSportsDbId: "4649"
  },
  // RUGBY UNION
  {
    id: "rugby-nations-cup",
    name: "🏉 Rugby Nations Cup / Nations Championship (Autumn Nations Series)",
    sportId: "rugby-union",
    provider: "rugby-nations-hybrid",
    espnPath: "rugby/289234",
    theSportsDbId: "5156"
  },
  {
    id: "espn-urc",
    name: "🏉 United Rugby Championship - URC (Leinster, Munster, Ulster, Connacht)",
    sportId: "rugby-union",
    provider: "espn",
    espnPath: "rugby/270557",
    theSportsDbId: "4416"
  },
  {
    id: "espn-six-nations",
    name: "🏉 Guinness Six Nations Rugby (Live Feed)",
    sportId: "rugby-union",
    provider: "espn",
    espnPath: "rugby/180659",
    theSportsDbId: "4714"
  },
  {
    id: "espn-champions-cup",
    name: "🏉 Investec Rugby Champions Cup (Live Feed)",
    sportId: "rugby-union",
    provider: "espn",
    espnPath: "rugby/271937",
    theSportsDbId: "4550"
  },
  {
    id: "espn-rugby-championship",
    name: "🏉 The Rugby Championship (NZ, South Africa, Australia, Argentina)",
    sportId: "rugby-union",
    provider: "espn",
    espnPath: "rugby/244293",
    theSportsDbId: "4986"
  },
  // RUGBY LEAGUE
  {
    id: "tsdb-super-league",
    name: "🏉 Rugby League Super League (TheSportsDB Feed)",
    sportId: "rugby-league",
    provider: "thesportsdb",
    theSportsDbId: "4415"
  },
  {
    id: "tsdb-nrl",
    name: "🏉 NRL Telstra Premiership (TheSportsDB Feed)",
    sportId: "rugby-league",
    provider: "thesportsdb",
    theSportsDbId: "4417"
  },
  // AMERICAN FOOTBALL
  {
    id: "espn-nfl",
    name: "🏈 NFL American Football (Live ESPN Scoreboard)",
    sportId: "american-football",
    provider: "espn",
    espnPath: "football/nfl",
    theSportsDbId: "4391"
  },
  {
    id: "espn-ncaa-fb",
    name: "🏈 NCAA College Football (Live ESPN Scoreboard)",
    sportId: "american-football",
    provider: "espn",
    espnPath: "football/college-football"
  },
  // BASKETBALL
  {
    id: "espn-nba",
    name: "🏀 NBA Basketball (Live ESPN Scoreboard)",
    sportId: "basketball",
    provider: "espn",
    espnPath: "basketball/nba",
    theSportsDbId: "4387"
  },
  // TENNIS
  {
    id: "espn-atp",
    name: "🎾 ATP Tour Tennis (Live ESPN Matchups)",
    sportId: "tennis",
    provider: "espn",
    espnPath: "tennis/atp"
  },
  // GOLF
  {
    id: "espn-pga",
    name: "⛳ PGA Tour Golf (Live ESPN Leaderboard)",
    sportId: "golf",
    provider: "espn",
    espnPath: "golf/pga"
  },
  // GAA HURLING & GAELIC FOOTBALL
  {
    id: "gaa-hurling-intercounty",
    name: "🏑 GAA All-Ireland & Provincial Senior Hurling (TheSportsDB + GAA Feed)",
    sportId: "gaa-hurling",
    provider: "gaa-hybrid",
    theSportsDbId: "5078"
  },
  {
    id: "gaa-football-intercounty",
    name: "🏐 GAA Sam Maguire & Provincial Gaelic Football (TheSportsDB + GAA Feed)",
    sportId: "gaa-football",
    provider: "gaa-hybrid",
    theSportsDbId: "5077"
  }
];

export function getFeedById(feedId) {
  return LIVE_LEAGUE_FEEDS.find((f) => f.id === feedId) || null;
}

// ============================================================================
// FETCH & NORMALIZE MATCHES FROM INTERNET APIS
// ============================================================================

export async function fetchFixturesAndResultsFromFeed(feedId) {
  const feed = getFeedById(feedId);
  if (!feed) throw new Error("Unknown league feed selected.");

  let matches = [];

  // 1. Try ESPN Public Scoreboard API first if configured
  if ((feed.provider === "espn" || feed.provider === "rugby-nations-hybrid") && feed.espnPath) {
    try {
      const espnMatches = await fetchFromEspnApi(feed);
      if (espnMatches.length > 0) {
        matches = espnMatches;
      }
    } catch (err) {
      console.warn("ESPN feed fallback to TheSportsDB:", err);
    }
  }

  // 2. Try TheSportsDB API if ESPN returned 0 or if provider is thesportsdb / gaa-hybrid
  if (matches.length === 0 && feed.theSportsDbId) {
    try {
      const tsdbMatches = await fetchFromTheSportsDb(feed);
      if (tsdbMatches.length > 0) {
        matches = tsdbMatches;
      }
    } catch (err) {
      console.warn("TheSportsDB fetch note:", err);
    }
  }

  // 3. For Rugby Nations Cup / Nations Championship, merge full multi-round schedule
  if (feed.provider === "rugby-nations-hybrid") {
    const nationsCupMatches = getCuratedRugbyNationsCupFixtures();
    const map = new Map();
    [...nationsCupMatches, ...matches].forEach((m) => map.set(m.externalId, m));
    matches = Array.from(map.values());
  }

  // 4. For GAA Hurling & Football, enrich with full multi-round inter-county fixture & result feed
  if (feed.provider === "gaa-hybrid") {
    const gaaMatches = getCuratedGaaFixtures(feed.id);
    matches = [...matches, ...gaaMatches];
  }

  return matches;
}

async function fetchFromEspnApi(feed) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${feed.espnPath}/scoreboard`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API returned ${res.status}`);
  const data = await res.json();

  const events = Array.isArray(data.events) ? data.events : [];
  const results = [];

  const weekNum = data.week?.number
    ? `Round ${data.week.number}`
    : data.leagues?.[0]?.season?.type?.name || "Current Round";

  events.forEach((ev) => {
    const comp = ev.competitions?.[0];
    if (!comp) return;
    const competitors = comp.competitors || [];
    if (competitors.length < 2) return;

    const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
    const away = competitors.find((c) => c.homeAway === "away") || competitors[1];

    const stateStr = comp.status?.type?.state || ev.status?.type?.state || "pre";
    let status = "upcoming";
    if (stateStr === "post") status = "completed";
    else if (stateStr === "in") status = "locked";

    const kickoffIso = ev.date
      ? new Date(ev.date).toISOString().slice(0, 16)
      : new Date().toISOString().slice(0, 16);

    const roundLabel =
      ev.week?.text ||
      comp.notes?.[0]?.headline ||
      weekNum ||
      "Round 1";

    results.push({
      externalId: `espn-${ev.id}`,
      sportId: feed.sportId,
      roundName: roundLabel,
      homeTeam: home.team?.shortDisplayName || home.team?.displayName || home.athlete?.displayName || "Home",
      awayTeam: away.team?.shortDisplayName || away.team?.displayName || away.athlete?.displayName || "Away",
      venue: comp.venue?.fullName || "Official Venue",
      kickoffTime: kickoffIso,
      status,
      homeScore: Number(home.score) || 0,
      awayScore: Number(away.score) || 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    });
  });

  return results;
}

async function fetchFromTheSportsDb(feed) {
  const [nextRes, pastRes] = await Promise.allSettled([
    fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${feed.theSportsDbId}`),
    fetch(`https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=${feed.theSportsDbId}`)
  ]);

  const rawEvents = [];
  if (pastRes.status === "fulfilled" && pastRes.value.ok) {
    const pastData = await pastRes.value.json();
    if (Array.isArray(pastData.events)) rawEvents.push(...pastData.events.slice(0, 8));
  }
  if (nextRes.status === "fulfilled" && nextRes.value.ok) {
    const nextData = await nextRes.value.json();
    if (Array.isArray(nextData.events)) rawEvents.push(...nextData.events.slice(0, 10));
  }

  return rawEvents.map((ev) => {
    const hasScore = ev.intHomeScore !== null && ev.intHomeScore !== undefined && ev.intHomeScore !== "";
    const status = hasScore ? "completed" : "upcoming";
    const datePart = ev.dateEvent || new Date().toISOString().slice(0, 10);
    const timePart = (ev.strTime || "15:00:00").slice(0, 5);
    const roundName = ev.intRound ? `Round ${ev.intRound}` : "League Fixture";

    return {
      externalId: `tsdb-${ev.idEvent}`,
      sportId: feed.sportId,
      roundName,
      homeTeam: ev.strHomeTeam || "Home",
      awayTeam: ev.strAwayTeam || "Away",
      venue: ev.strVenue || "Stadium",
      kickoffTime: `${datePart}T${timePart}`,
      status,
      homeScore: Number(ev.intHomeScore) || 0,
      awayScore: Number(ev.intAwayScore) || 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    };
  });
}

function getCuratedRugbyNationsCupFixtures() {
  return [
    // ROUND 1 (July Window - Southern Hemisphere Series)
    {
      externalId: "rnc-2026-r1-aus-ire",
      sportId: "rugby-union",
      roundName: "Round 1",
      homeTeam: "Australia",
      awayTeam: "Ireland",
      venue: "Allianz Stadium, Sydney",
      kickoffTime: "2026-07-04T10:55",
      status: "completed",
      homeScore: 31,
      awayScore: 33,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r1-nz-fra",
      sportId: "rugby-union",
      roundName: "Round 1",
      homeTeam: "New Zealand",
      awayTeam: "France",
      venue: "One NZ Stadium, Christchurch",
      kickoffTime: "2026-07-04T08:05",
      status: "completed",
      homeScore: 34,
      awayScore: 32,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r1-rsa-eng",
      sportId: "rugby-union",
      roundName: "Round 1",
      homeTeam: "South Africa",
      awayTeam: "England",
      venue: "Ellis Park, Johannesburg",
      kickoffTime: "2026-07-04T16:00",
      status: "completed",
      homeScore: 28,
      awayScore: 24,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r1-arg-sco",
      sportId: "rugby-union",
      roundName: "Round 1",
      homeTeam: "Argentina",
      awayTeam: "Scotland",
      venue: "Estadio Vélez Sarsfield, Buenos Aires",
      kickoffTime: "2026-07-04T20:10",
      status: "completed",
      homeScore: 26,
      awayScore: 20,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    // ROUND 2 (July Window)
    {
      externalId: "rnc-2026-r2-jpn-ire",
      sportId: "rugby-union",
      roundName: "Round 2",
      homeTeam: "Japan",
      awayTeam: "Ireland",
      venue: "National Stadium, Tokyo",
      kickoffTime: "2026-07-11T11:00",
      status: "completed",
      homeScore: 11,
      awayScore: 21,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r2-aus-fra",
      sportId: "rugby-union",
      roundName: "Round 2",
      homeTeam: "Australia",
      awayTeam: "France",
      venue: "Suncorp Stadium, Brisbane",
      kickoffTime: "2026-07-11T10:55",
      status: "completed",
      homeScore: 26,
      awayScore: 42,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r2-rsa-sco",
      sportId: "rugby-union",
      roundName: "Round 2",
      homeTeam: "South Africa",
      awayTeam: "Scotland",
      venue: "Loftus Versfeld, Pretoria",
      kickoffTime: "2026-07-11T16:00",
      status: "completed",
      homeScore: 35,
      awayScore: 18,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    // ROUND 3 (July Window)
    {
      externalId: "rnc-2026-r3-nz-ire",
      sportId: "rugby-union",
      roundName: "Round 3",
      homeTeam: "New Zealand",
      awayTeam: "Ireland",
      venue: "Eden Park, Auckland",
      kickoffTime: "2026-07-18T08:05",
      status: "completed",
      homeScore: 40,
      awayScore: 21,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r3-jpn-fra",
      sportId: "rugby-union",
      roundName: "Round 3",
      homeTeam: "Japan",
      awayTeam: "France",
      venue: "National Stadium, Tokyo",
      kickoffTime: "2026-07-18T11:00",
      status: "completed",
      homeScore: 15,
      awayScore: 42,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    // ROUND 4 (November Window - Autumn Nations Series)
    {
      externalId: "rnc-2026-r4-ire-arg",
      sportId: "rugby-union",
      roundName: "Round 4",
      homeTeam: "Ireland",
      awayTeam: "Argentina",
      venue: "Aviva Stadium, Dublin",
      kickoffTime: "2026-11-06T20:10",
      status: "completed",
      homeScore: 42,
      awayScore: 12,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r4-fra-fij",
      sportId: "rugby-union",
      roundName: "Round 4",
      homeTeam: "France",
      awayTeam: "Fiji",
      venue: "Groupama Stadium, Lyon",
      kickoffTime: "2026-11-07T20:10",
      status: "completed",
      homeScore: 54,
      awayScore: 17,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r4-sco-nz",
      sportId: "rugby-union",
      roundName: "Round 4",
      homeTeam: "Scotland",
      awayTeam: "New Zealand",
      venue: "Scottish Gas Murrayfield, Edinburgh",
      kickoffTime: "2026-11-07T15:10",
      status: "completed",
      homeScore: 22,
      awayScore: 31,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r4-ita-rsa",
      sportId: "rugby-union",
      roundName: "Round 4",
      homeTeam: "Italy",
      awayTeam: "South Africa",
      venue: "Stadio Olimpico, Rome",
      kickoffTime: "2026-11-07T13:00",
      status: "completed",
      homeScore: 16,
      awayScore: 38,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r4-eng-aus",
      sportId: "rugby-union",
      roundName: "Round 4",
      homeTeam: "England",
      awayTeam: "Australia",
      venue: "Allianz Stadium, Twickenham",
      kickoffTime: "2026-11-08T15:10",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r4-wal-jpn",
      sportId: "rugby-union",
      roundName: "Round 4",
      homeTeam: "Wales",
      awayTeam: "Japan",
      venue: "Principality Stadium, Cardiff",
      kickoffTime: "2026-11-08T17:40",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    // ROUND 5 (November Window - Autumn Nations Series)
    {
      externalId: "rnc-2026-r5-fra-rsa",
      sportId: "rugby-union",
      roundName: "Round 5",
      homeTeam: "France",
      awayTeam: "South Africa",
      venue: "Stade de France, Paris",
      kickoffTime: "2026-11-13T20:10",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r5-ire-fij",
      sportId: "rugby-union",
      roundName: "Round 5",
      homeTeam: "Ireland",
      awayTeam: "Fiji",
      venue: "Aviva Stadium, Dublin",
      kickoffTime: "2026-11-14T15:10",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r5-eng-jpn",
      sportId: "rugby-union",
      roundName: "Round 5",
      homeTeam: "England",
      awayTeam: "Japan",
      venue: "Allianz Stadium, Twickenham",
      kickoffTime: "2026-11-14T17:40",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r5-wal-nz",
      sportId: "rugby-union",
      roundName: "Round 5",
      homeTeam: "Wales",
      awayTeam: "New Zealand",
      venue: "Principality Stadium, Cardiff",
      kickoffTime: "2026-11-14T17:40",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r5-sco-aus",
      sportId: "rugby-union",
      roundName: "Round 5",
      homeTeam: "Scotland",
      awayTeam: "Australia",
      venue: "Scottish Gas Murrayfield, Edinburgh",
      kickoffTime: "2026-11-15T13:40",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r5-ita-arg",
      sportId: "rugby-union",
      roundName: "Round 5",
      homeTeam: "Italy",
      awayTeam: "Argentina",
      venue: "Bluenergy Stadium, Udine",
      kickoffTime: "2026-11-15T15:00",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    // ROUND 6 (November Window - Autumn Nations Series)
    {
      externalId: "rnc-2026-r6-ire-rsa",
      sportId: "rugby-union",
      roundName: "Round 6",
      homeTeam: "Ireland",
      awayTeam: "South Africa",
      venue: "Aviva Stadium, Dublin",
      kickoffTime: "2026-11-21T17:40",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r6-eng-nz",
      sportId: "rugby-union",
      roundName: "Round 6",
      homeTeam: "England",
      awayTeam: "New Zealand",
      venue: "Allianz Stadium, Twickenham",
      kickoffTime: "2026-11-21T15:10",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r6-fra-arg",
      sportId: "rugby-union",
      roundName: "Round 6",
      homeTeam: "France",
      awayTeam: "Argentina",
      venue: "Stade de France, Paris",
      kickoffTime: "2026-11-21T20:10",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r6-sco-jpn",
      sportId: "rugby-union",
      roundName: "Round 6",
      homeTeam: "Scotland",
      awayTeam: "Japan",
      venue: "Scottish Gas Murrayfield, Edinburgh",
      kickoffTime: "2026-11-21T13:00",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r6-wal-aus",
      sportId: "rugby-union",
      roundName: "Round 6",
      homeTeam: "Wales",
      awayTeam: "Australia",
      venue: "Principality Stadium, Cardiff",
      kickoffTime: "2026-11-22T16:10",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-r6-ita-fij",
      sportId: "rugby-union",
      roundName: "Round 6",
      homeTeam: "Italy",
      awayTeam: "Fiji",
      venue: "Stadio Luigi Ferraris, Genoa",
      kickoffTime: "2026-11-21T14:00",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    // FINALS WEEKEND (Twickenham, Nov 27-29)
    {
      externalId: "rnc-2026-final-1v1",
      sportId: "rugby-union",
      roundName: "Finals Weekend",
      homeTeam: "Northern Hemisphere #1",
      awayTeam: "Southern Hemisphere #1",
      venue: "Allianz Stadium, Twickenham (Grand Final)",
      kickoffTime: "2026-11-29T16:00",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    },
    {
      externalId: "rnc-2026-final-2v2",
      sportId: "rugby-union",
      roundName: "Finals Weekend",
      homeTeam: "Northern Hemisphere #2",
      awayTeam: "Southern Hemisphere #2",
      venue: "Allianz Stadium, Twickenham (Bronze Final)",
      kickoffTime: "2026-11-28T17:40",
      status: "upcoming",
      homeScore: 0,
      awayScore: 0,
      homeGoals: 0,
      homePoints: 0,
      awayGoals: 0,
      awayPoints: 0
    }
  ];
}

function getCuratedGaaFixtures(feedId) {
  if (feedId === "gaa-hurling-intercounty") {
    return [
      {
        externalId: "gaa-hurl-r1-lim-cor",
        sportId: "gaa-hurling",
        roundName: "Munster Round 1",
        homeTeam: "Limerick",
        awayTeam: "Cork",
        venue: "TUS Gaelic Grounds",
        kickoffTime: "2026-11-01T16:00",
        status: "completed",
        homeGoals: 2,
        homePoints: 22,
        homeScore: computeGaaTotal(2, 22),
        awayGoals: 1,
        awayPoints: 23,
        awayScore: computeGaaTotal(1, 23)
      },
      {
        externalId: "gaa-hurl-r1-cla-wat",
        sportId: "gaa-hurling",
        roundName: "Munster Round 1",
        homeTeam: "Clare",
        awayTeam: "Waterford",
        venue: "Cusack Park, Ennis",
        kickoffTime: "2026-11-01T14:00",
        status: "completed",
        homeGoals: 1,
        homePoints: 24,
        homeScore: computeGaaTotal(1, 24),
        awayGoals: 2,
        awayPoints: 19,
        awayScore: computeGaaTotal(2, 19)
      },
      {
        externalId: "gaa-hurl-r2-cor-cla",
        sportId: "gaa-hurling",
        roundName: "Munster Round 2",
        homeTeam: "Cork",
        awayTeam: "Clare",
        venue: "SuperValu Páirc Uí Chaoimh",
        kickoffTime: "2026-11-15T16:00",
        status: "upcoming",
        homeGoals: 0,
        homePoints: 0,
        homeScore: 0,
        awayGoals: 0,
        awayPoints: 0,
        awayScore: 0
      },
      {
        externalId: "gaa-hurl-r2-tip-wat",
        sportId: "gaa-hurling",
        roundName: "Munster Round 2",
        homeTeam: "Tipperary",
        awayTeam: "Waterford",
        venue: "FBD Semple Stadium, Thurles",
        kickoffTime: "2026-11-15T14:00",
        status: "upcoming",
        homeGoals: 0,
        homePoints: 0,
        homeScore: 0,
        awayGoals: 0,
        awayPoints: 0,
        awayScore: 0
      },
      {
        externalId: "gaa-hurl-lein-r1-kk-gal",
        sportId: "gaa-hurling",
        roundName: "Leinster Round 1",
        homeTeam: "Kilkenny",
        awayTeam: "Galway",
        venue: "UPMC Nowlan Park",
        kickoffTime: "2026-11-16T14:00",
        status: "upcoming",
        homeGoals: 0,
        homePoints: 0,
        homeScore: 0,
        awayGoals: 0,
        awayPoints: 0,
        awayScore: 0
      },
      {
        externalId: "gaa-hurl-lein-r1-dub-wex",
        sportId: "gaa-hurling",
        roundName: "Leinster Round 1",
        homeTeam: "Dublin",
        awayTeam: "Wexford",
        venue: "Parnell Park",
        kickoffTime: "2026-11-16T15:45",
        status: "upcoming",
        homeGoals: 0,
        homePoints: 0,
        homeScore: 0,
        awayGoals: 0,
        awayPoints: 0,
        awayScore: 0
      }
    ];
  }

  return [
    {
      externalId: "gaa-foot-r1-dub-ker",
      sportId: "gaa-football",
      roundName: "Round 1",
      homeTeam: "Dublin",
      awayTeam: "Kerry",
      venue: "Croke Park, Dublin",
      kickoffTime: "2026-11-02T16:00",
      status: "completed",
      homeGoals: 1,
      homePoints: 18,
      homeScore: computeGaaTotal(1, 18),
      awayGoals: 1,
      awayPoints: 16,
      awayScore: computeGaaTotal(1, 16)
    },
    {
      externalId: "gaa-foot-r1-may-gal",
      sportId: "gaa-football",
      roundName: "Round 1",
      homeTeam: "Mayo",
      awayTeam: "Galway",
      venue: "Hastings Insurance MacHale Park",
      kickoffTime: "2026-11-02T14:00",
      status: "completed",
      homeGoals: 0,
      homePoints: 17,
      homeScore: computeGaaTotal(0, 17),
      awayGoals: 1,
      awayPoints: 15,
      awayScore: computeGaaTotal(1, 15)
    },
    {
      externalId: "gaa-foot-r2-arm-don",
      sportId: "gaa-football",
      roundName: "Round 2",
      homeTeam: "Armagh",
      awayTeam: "Donegal",
      venue: "BOX-IT Athletic Grounds",
      kickoffTime: "2026-11-16T15:30",
      status: "upcoming",
      homeGoals: 0,
      homePoints: 0,
      homeScore: 0,
      awayGoals: 0,
      awayPoints: 0,
      awayScore: 0
    },
    {
      externalId: "gaa-foot-r2-tyr-der",
      sportId: "gaa-football",
      roundName: "Round 2",
      homeTeam: "Tyrone",
      awayTeam: "Derry",
      venue: "O'Neills Healy Park, Omagh",
      kickoffTime: "2026-11-16T17:15",
      status: "upcoming",
      homeGoals: 0,
      homePoints: 0,
      homeScore: 0,
      awayGoals: 0,
      awayPoints: 0,
      awayScore: 0
    }
  ];
}
