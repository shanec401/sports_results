// ============================================================================
// MULTI-SPORT DEFINITIONS, GAA CALCULATOR & SCORING ENGINE
// ============================================================================

export const SPORTS_CATALOG = [
  {
    id: "gaa-hurling",
    name: "GAA Hurling",
    emoji: "🏑",
    scoringMode: "gaa", // Goals (3 pts) + Points (1 pt)
    unitLabel: "Pts (G-P)",
    teamLabel: "County / Club",
    allowDraw: true
  },
  {
    id: "gaa-football",
    name: "GAA Gaelic Football",
    emoji: "🏐",
    scoringMode: "gaa", // Goals (3 pts) + Points (1 pt)
    unitLabel: "Pts (G-P)",
    teamLabel: "County / Club",
    allowDraw: true
  },
  {
    id: "rugby-union",
    name: "Rugby Union",
    emoji: "🏉",
    scoringMode: "standard",
    unitLabel: "Points",
    teamLabel: "Team / Province",
    allowDraw: true
  },
  {
    id: "rugby-league",
    name: "Rugby League",
    emoji: "🏉",
    scoringMode: "standard",
    unitLabel: "Points",
    teamLabel: "Club / Country",
    allowDraw: true
  },
  {
    id: "soccer",
    name: "Soccer",
    emoji: "⚽",
    scoringMode: "standard",
    unitLabel: "Goals",
    teamLabel: "Club / Country",
    allowDraw: true
  },
  {
    id: "american-football",
    name: "American Football",
    emoji: "🏈",
    scoringMode: "standard",
    unitLabel: "Points",
    teamLabel: "NFL / College Team",
    allowDraw: true
  },
  {
    id: "basketball",
    name: "Basketball",
    emoji: "🏀",
    scoringMode: "standard",
    unitLabel: "Points",
    teamLabel: "Team",
    allowDraw: false
  },
  {
    id: "golf",
    name: "Golf",
    emoji: "⛳",
    scoringMode: "standard",
    unitLabel: "Strokes / Pts",
    teamLabel: "Golfer / Pair",
    allowDraw: true
  },
  {
    id: "tennis",
    name: "Tennis",
    emoji: "🎾",
    scoringMode: "standard",
    unitLabel: "Games Won",
    teamLabel: "Player",
    allowDraw: false
  },
  {
    id: "fishing",
    name: "Fishing",
    emoji: "🎣",
    scoringMode: "standard",
    unitLabel: "Weight (lbs/oz or pts)",
    teamLabel: "Angler / Boat",
    allowDraw: true
  }
];

export function getSportById(sportId) {
  return SPORTS_CATALOG.find((s) => s.id === sportId) || SPORTS_CATALOG[0];
}

// Converts GAA Goals & Points into total points: (Goals * 3) + Points
export function computeGaaTotal(goals = 0, points = 0) {
  return (Number(goals) || 0) * 3 + (Number(points) || 0);
}

// Formats a score nicely (e.g. "2-15 (21)" for GAA, or "24" for standard sports)
export function formatSideScore(gameOrPred, side, sportId) {
  const sport = getSportById(sportId);
  if (sport.scoringMode === "gaa") {
    const g = Number(gameOrPred[`${side}Goals`] ?? 0);
    const p = Number(gameOrPred[`${side}Points`] ?? 0);
    const total = computeGaaTotal(g, p);
    return `${g}-${String(p).padStart(2, "0")} (${total})`;
  }
  return String(Number(gameOrPred[`${side}Score`] ?? 0));
}

// Determines outcome: "HOME" | "AWAY" | "DRAW"
export function getOutcomeFromScores(homeTotal, awayTotal) {
  const h = Number(homeTotal) || 0;
  const a = Number(awayTotal) || 0;
  if (h > a) return "HOME";
  if (a > h) return "AWAY";
  return "DRAW";
}

// ============================================================================
// PREDICTION SCORING ENGINE
// ============================================================================
// Scoring Rules & Per-Team Closeness Maths:
// 1. Correct Result (Win / Loss / Draw) = +3 points
// 2. Tier 1 Bonus (+3 BONUS): Both teams' predicted scores are Exact or within
//    7 points of their actual score: |PredHome - ActualHome| <= 7 AND |PredAway - ActualAway| <= 7
// 3. Tier 2 Bonus (+2 BONUS): Both teams' predicted scores are within 14 points
//    of their actual score: |PredHome - ActualHome| <= 14 AND |PredAway - ActualAway| <= 14
export function calculatePredictionPoints(prediction, game, competition) {
  if (!prediction || !game || game.status !== "completed") {
    return {
      graded: false,
      totalPoints: 0,
      resultPoints: 0,
      bonusPoints: 0,
      tier: "pending",
      summary: "Awaiting final result"
    };
  }

  // Migrate any legacy 2/5 margins to the 7/14 per-team standard
  const rawT1 = Number(competition?.tier1Margin ?? 7);
  const rawT2 = Number(competition?.tier2Margin ?? 14);
  const rules = {
    resultPts: Number(competition?.resultPts ?? 3),
    exactBonusPts: Number(competition?.exactBonusPts ?? 3),
    closeBonusPts: Number(competition?.closeBonusPts ?? 2),
    tier1Margin: rawT1 <= 2 ? 7 : rawT1,
    tier2Margin: rawT2 <= 5 ? 14 : rawT2
  };

  const actualHome = Number(game.homeScore) || 0;
  const actualAway = Number(game.awayScore) || 0;
  const actualOutcome = getOutcomeFromScores(actualHome, actualAway);

  const predHome = Number(prediction.homeScore) || 0;
  const predAway = Number(prediction.awayScore) || 0;
  const predOutcome = prediction.pickedOutcome || getOutcomeFromScores(predHome, predAway);

  // 1. Check Win / Loss / Draw result (+3 pts)
  const isResultCorrect = predOutcome === actualOutcome;
  const resultPoints = isResultCorrect ? rules.resultPts : 0;

  // 2. Per-Team Score Closeness Maths:
  // Measure how far off the prediction is for each individual team
  const homeDiff = Math.abs(predHome - actualHome);
  const awayDiff = Math.abs(predAway - actualAway);
  const maxTeamDiff = Math.max(homeDiff, awayDiff);
  const totalScoreDiff = homeDiff + awayDiff;

  let bonusPoints = 0;
  let tier = isResultCorrect ? "result_only" : "missed";
  const diffNote = `(Home off by ${homeDiff}, Away off by ${awayDiff})`;
  let summary = isResultCorrect
    ? `Correct Result (+${resultPoints} pts) ${diffNote}`
    : `Missed Result (0 pts) ${diffNote}`;

  if (homeDiff === 0 && awayDiff === 0) {
    bonusPoints = rules.exactBonusPts;
    tier = "tier1_bonus";
    summary = `🎯 Exact Score Bullseye! Result (+${resultPoints}) + Bonus (+${bonusPoints} pts)`;
  } else if (homeDiff <= rules.tier1Margin && awayDiff <= rules.tier1Margin) {
    bonusPoints = rules.exactBonusPts;
    tier = "tier1_bonus";
    summary = `${isResultCorrect ? `Result (+${resultPoints})` : "Score Bonus"} + Within ${rules.tier1Margin} Pts/Team (+${bonusPoints} pts) ${diffNote}`;
  } else if (homeDiff <= rules.tier2Margin && awayDiff <= rules.tier2Margin) {
    bonusPoints = rules.closeBonusPts;
    tier = "tier2_bonus";
    summary = `${isResultCorrect ? `Result (+${resultPoints})` : "Score Bonus"} + Within ${rules.tier2Margin} Pts/Team (+${bonusPoints} pts) ${diffNote}`;
  }

  return {
    graded: true,
    isResultCorrect,
    totalPoints: resultPoints + bonusPoints,
    resultPoints,
    bonusPoints,
    homeDiff,
    awayDiff,
    maxTeamDiff,
    totalScoreDiff,
    tier,
    summary
  };
}

// ============================================================================
// STARTER COMPETITIONS & SAMPLE FIXTURES
// ============================================================================

export const STARTER_COMPETITIONS = [
  {
    id: "comp-all-ireland-hurling-2026",
    title: "All-Ireland Senior Hurling Championship",
    sportId: "gaa-hurling",
    season: "2026 Championship",
    description: "Predict Munster, Leinster & All-Ireland Hurling clashes. Supports full GAA Goals & Points (G-P) scoring!",
    requiresApproval: false,
    resultPts: 3,
    exactBonusPts: 3,
    closeBonusPts: 2,
    tier1Margin: 7,
    tier2Margin: 14
  },
  {
    id: "comp-all-ireland-football-2026",
    title: "Sam Maguire GAA Football Championship",
    sportId: "gaa-football",
    season: "2026 Series",
    description: "Inter-county Gaelic Football predictions with automatic Goals-Points total conversion.",
    requiresApproval: false,
    resultPts: 3,
    exactBonusPts: 3,
    closeBonusPts: 2,
    tier1Margin: 7,
    tier2Margin: 14
  },
  {
    id: "comp-six-nations-rugby",
    title: "Six Nations & URC Rugby Union League",
    sportId: "rugby-union",
    season: "2026/27",
    description: "Test rugby and United Rugby Championship predictions. 3 pts for result + up to 3 bonus pts for close score!",
    requiresApproval: false,
    resultPts: 3,
    exactBonusPts: 3,
    closeBonusPts: 2,
    tier1Margin: 7,
    tier2Margin: 14
  },
  {
    id: "comp-premier-league-soccer",
    title: "Premier League & Champions League Predictor",
    sportId: "soccer",
    season: "2026/27",
    description: "Weekly football scorelines and match result predictions.",
    requiresApproval: false,
    resultPts: 3,
    exactBonusPts: 3,
    closeBonusPts: 2,
    tier1Margin: 7,
    tier2Margin: 14
  },
  {
    id: "comp-irish-angling-open",
    title: "Lough Corrib & Shannon Angling League",
    sportId: "fishing",
    season: "2026 Open",
    description: "Head-to-head competitive angling matchups & catch weight predictions.",
    requiresApproval: true,
    resultPts: 3,
    exactBonusPts: 3,
    closeBonusPts: 2,
    tier1Margin: 7,
    tier2Margin: 14
  }
];

export const STARTER_GAMES = [
  // GAA Hurling Fixtures
  {
    id: "game-hurl-1",
    competitionId: "comp-all-ireland-hurling-2026",
    sportId: "gaa-hurling",
    roundName: "Munster Round 1",
    homeTeam: "Limerick",
    awayTeam: "Cork",
    venue: "TUS Gaelic Grounds",
    kickoffTime: "2026-11-01T16:00",
    status: "completed",
    homeGoals: 2,
    homePoints: 22,
    homeScore: 28,
    awayGoals: 1,
    awayPoints: 23,
    awayScore: 26
  },
  {
    id: "game-hurl-2",
    competitionId: "comp-all-ireland-hurling-2026",
    sportId: "gaa-hurling",
    roundName: "Munster Round 2",
    homeTeam: "Clare",
    awayTeam: "Tipperary",
    venue: "Cusack Park, Ennis",
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
    id: "game-hurl-3",
    competitionId: "comp-all-ireland-hurling-2026",
    sportId: "gaa-hurling",
    roundName: "Leinster Final",
    homeTeam: "Kilkenny",
    awayTeam: "Galway",
    venue: "Croke Park, Dublin",
    kickoffTime: "2026-11-22T15:30",
    status: "upcoming",
    homeGoals: 0,
    homePoints: 0,
    homeScore: 0,
    awayGoals: 0,
    awayPoints: 0,
    awayScore: 0
  },

  // GAA Football Fixtures
  {
    id: "game-foot-1",
    competitionId: "comp-all-ireland-football-2026",
    sportId: "gaa-football",
    roundName: "Quarter-Final",
    homeTeam: "Dublin",
    awayTeam: "Kerry",
    venue: "Croke Park, Dublin",
    kickoffTime: "2026-11-02T16:00",
    status: "completed",
    homeGoals: 1,
    homePoints: 18,
    homeScore: 21,
    awayGoals: 1,
    awayPoints: 16,
    awayScore: 19
  },
  {
    id: "game-foot-2",
    competitionId: "comp-all-ireland-football-2026",
    sportId: "gaa-football",
    roundName: "Semi-Final",
    homeTeam: "Armagh",
    awayTeam: "Galway",
    venue: "Croke Park, Dublin",
    kickoffTime: "2026-11-16T15:30",
    status: "upcoming",
    homeGoals: 0,
    homePoints: 0,
    homeScore: 0,
    awayGoals: 0,
    awayPoints: 0,
    awayScore: 0
  },

  // Rugby Union Fixtures
  {
    id: "game-rugby-1",
    competitionId: "comp-six-nations-rugby",
    sportId: "rugby-union",
    roundName: "Round 1",
    homeTeam: "Ireland",
    awayTeam: "France",
    venue: "Aviva Stadium, Dublin",
    kickoffTime: "2026-11-01T16:45",
    status: "completed",
    homeScore: 27,
    awayScore: 24
  },
  {
    id: "game-rugby-2",
    competitionId: "comp-six-nations-rugby",
    sportId: "rugby-union",
    roundName: "URC Interpro Derby",
    homeTeam: "Munster",
    awayTeam: "Leinster",
    venue: "Thomond Park, Limerick",
    kickoffTime: "2026-11-14T19:35",
    status: "upcoming",
    homeScore: 0,
    awayScore: 0
  },

  // Soccer Fixtures
  {
    id: "game-soc-1",
    competitionId: "comp-premier-league-soccer",
    sportId: "soccer",
    roundName: "Matchweek 12",
    homeTeam: "Liverpool",
    awayTeam: "Arsenal",
    venue: "Anfield",
    kickoffTime: "2026-11-14T17:30",
    status: "upcoming",
    homeScore: 0,
    awayScore: 0
  }
];

export const STARTER_DEMO_PREDICTIONS = [
  {
    id: "game-hurl-1__demo-shane",
    gameId: "game-hurl-1",
    competitionId: "comp-all-ireland-hurling-2026",
    userId: "demo-shane",
    userName: "Shane O'Connor",
    pickedOutcome: "HOME",
    homeGoals: 2,
    homePoints: 21,
    homeScore: 27,
    awayGoals: 1,
    awayPoints: 23,
    awayScore: 26
  },
  {
    id: "game-hurl-1__demo-ciaran",
    gameId: "game-hurl-1",
    competitionId: "comp-all-ireland-hurling-2026",
    userId: "demo-ciaran",
    userName: "Ciarán Murphy",
    pickedOutcome: "HOME",
    homeGoals: 1,
    homePoints: 22,
    homeScore: 25,
    awayGoals: 1,
    awayPoints: 22,
    awayScore: 25
  },
  {
    id: "game-hurl-1__demo-aoife",
    gameId: "game-hurl-1",
    competitionId: "comp-all-ireland-hurling-2026",
    userId: "demo-aoife",
    userName: "Aoife Kelly",
    pickedOutcome: "AWAY",
    homeGoals: 1,
    homePoints: 18,
    homeScore: 21,
    awayGoals: 2,
    awayPoints: 20,
    awayScore: 26
  },
  {
    id: "game-rugby-1__demo-shane",
    gameId: "game-rugby-1",
    competitionId: "comp-six-nations-rugby",
    userId: "demo-shane",
    userName: "Shane O'Connor",
    pickedOutcome: "HOME",
    homeScore: 26,
    awayScore: 23
  }
];
