// ============================================================================
// ARENAPICK — MULTI-SPORT LEAGUE, FIXTURE & PREDICTION CONTROLLER
// ============================================================================

import {
  getActiveFirebaseConfig,
  isFirebaseConfigured
} from "./firebase-config.js";

import {
  SPORTS_CATALOG,
  getSportById,
  computeGaaTotal,
  formatSideScore,
  getOutcomeFromScores,
  calculatePredictionPoints,
  STARTER_COMPETITIONS,
  STARTER_GAMES,
  STARTER_DEMO_PREDICTIONS
} from "./sports-data.js";

import {
  LIVE_LEAGUE_FEEDS,
  getFeedById,
  fetchFixturesAndResultsFromFeed
} from "./live-sync.js";

const state = {
  selectedSportFilter: "ALL",
  selectedRoundFilter: "ALL",
  selectedLeaderboardRound: "ALL",
  activeCompetitionId: STARTER_COMPETITIONS[0].id,
  competitions: structuredClone(STARTER_COMPETITIONS),
  deletedCompetitionIds: [],
  games: structuredClone(STARTER_GAMES),
  predictions: structuredClone(STARTER_DEMO_PREDICTIONS),
  registrations: [], // { id: compId__uid, competitionId, userId, userName, status: 'pending'|'approved' }
  activePredictGameId: null,
  pickedOutcomeInModal: "HOME",
  editingGameId: null,
  authMode: "login",
  user: null, // { uid, displayName, email, isCloud }
  isAdmin: false,
  firebaseReady: false,
  fbAuth: null,
  fbDb: null,
  fbModules: null
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  loadFromLocalStorage();
  populateSportSelects();
  bindUIEvents();
  renderAll();
  await initFirebaseIfConfigured();
});

function getActiveCompetition() {
  return (
    state.competitions.find((c) => c.id === state.activeCompetitionId) ||
    state.competitions[0] ||
    null
  );
}

function isGameLocked(game) {
  if (!game) return true;
  if (game.status === "locked" || game.status === "completed") return true;
  if (game.kickoffTime) {
    const kick = new Date(game.kickoffTime).getTime();
    if (!Number.isNaN(kick) && Date.now() >= kick) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// LOCAL STORAGE & FIREBASE SYNC
// ============================================================================

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem("arenapick_state_v1");
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved.deletedCompetitionIds)) {
        state.deletedCompetitionIds = saved.deletedCompetitionIds;
      }
      if (Array.isArray(saved.competitions)) {
        state.competitions = saved.competitions.filter(
          (c) => !state.deletedCompetitionIds.includes(c.id) && !c.deleted
        );
      }
      if (Array.isArray(saved.games)) {
        state.games = saved.games.filter(
          (g) => !state.deletedCompetitionIds.includes(g.competitionId)
        );
      }
      if (Array.isArray(saved.predictions)) {
        state.predictions = saved.predictions;
      }
      if (Array.isArray(saved.registrations)) {
        state.registrations = saved.registrations;
      }
      if (saved.activeCompetitionId) {
        state.activeCompetitionId = saved.activeCompetitionId;
      }
    }
    const localUser = localStorage.getItem("arenapick_local_user");
    if (localUser && !isFirebaseConfigured()) {
      state.user = JSON.parse(localUser);
    }
  } catch (err) {
    console.warn("Could not load local state:", err);
  }
}

function saveToLocalStorage() {
  localStorage.setItem(
    "arenapick_state_v1",
    JSON.stringify({
      activeCompetitionId: state.activeCompetitionId,
      competitions: state.competitions,
      deletedCompetitionIds: state.deletedCompetitionIds,
      games: state.games,
      predictions: state.predictions,
      registrations: state.registrations
    })
  );
}

async function initFirebaseIfConfigured() {
  const config = getActiveFirebaseConfig();
  updateCloudBadge(false);

  if (!isFirebaseConfigured(config)) {
    renderAll();
    return;
  }

  try {
    const [appMod, authMod, firestoreMod] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
    ]);

    const app = appMod.initializeApp(config);
    const auth = authMod.getAuth(app);
    const db = firestoreMod.getFirestore(app);

    state.fbAuth = auth;
    state.fbDb = db;
    state.firebaseReady = true;
    state.fbModules = { ...authMod, ...firestoreMod };

    updateCloudBadge(true);
    await syncAllCollectionsFromFirestore();

    authMod.onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        state.user = {
          uid: fbUser.uid,
          displayName:
            fbUser.displayName ||
            (fbUser.email ? fbUser.email.replace("@arenapick.user", "") : "Player"),
          email: fbUser.email || "",
          isCloud: true
        };
        await checkAdminStatus();
        await syncAllCollectionsFromFirestore();
        renderAll();
      } else {
        state.user = null;
        state.isAdmin = false;
        renderAll();
      }
    });
  } catch (err) {
    console.error("Firebase init failed:", err);
    updateCloudBadge(false);
  }
}

async function syncAllCollectionsFromFirestore() {
  if (!state.firebaseReady || !state.fbDb) return;
  const { collection, getDocs } = state.fbModules;

  try {
    const compSnap = await getDocs(collection(state.fbDb, "competitions"));
    if (!compSnap.empty) {
      const cloudComps = [];
      compSnap.forEach((d) => {
        const data = d.data();
        if (data.deleted && !state.deletedCompetitionIds.includes(d.id)) {
          state.deletedCompetitionIds.push(d.id);
        }
        cloudComps.push({ id: d.id, ...data });
      });
      // Merge cloud competitions with starter competitions, excluding any deleted ones
      const map = new Map();
      [...STARTER_COMPETITIONS, ...cloudComps].forEach((c) => {
        if (!c.deleted && !state.deletedCompetitionIds.includes(c.id)) {
          map.set(c.id, c);
        } else {
          map.delete(c.id);
        }
      });
      state.competitions = Array.from(map.values());
    } else {
      state.competitions = state.competitions.filter(
        (c) => !state.deletedCompetitionIds.includes(c.id)
      );
    }

    const gameSnap = await getDocs(collection(state.fbDb, "games"));
    if (!gameSnap.empty) {
      const cloudGames = [];
      gameSnap.forEach((d) => cloudGames.push({ id: d.id, ...d.data() }));
      const gMap = new Map();
      [...STARTER_GAMES, ...cloudGames].forEach((g) => {
        if (!state.deletedCompetitionIds.includes(g.competitionId)) {
          gMap.set(g.id, g);
        }
      });
      state.games = Array.from(gMap.values());
    }

    if (state.user) {
      const predSnap = await getDocs(collection(state.fbDb, "predictions"));
      if (!predSnap.empty) {
        const cloudPreds = [];
        predSnap.forEach((d) => cloudPreds.push({ id: d.id, ...d.data() }));
        const pMap = new Map();
        [...STARTER_DEMO_PREDICTIONS, ...cloudPreds].forEach((p) => pMap.set(p.id, p));
        state.predictions = Array.from(pMap.values());
      }

      const regSnap = await getDocs(collection(state.fbDb, "registrations"));
      const cloudRegs = [];
      regSnap.forEach((d) => cloudRegs.push({ id: d.id, ...d.data() }));
      state.registrations = cloudRegs;
    }

    saveToLocalStorage();
  } catch (err) {
    console.warn("Firestore sync note:", err);
  }
}

async function checkAdminStatus() {
  const uidEl = document.getElementById("currentUserUidDisplay");
  if (!state.user) {
    uidEl.textContent = "Not signed in — please Sign In first";
    state.isAdmin = false;
    return;
  }
  uidEl.textContent = state.user.uid;

  if (state.firebaseReady && state.fbDb && state.user.isCloud) {
    try {
      const { doc, getDoc } = state.fbModules;
      const snap = await getDoc(doc(state.fbDb, "admins", state.user.uid));
      state.isAdmin = snap.exists();
    } catch (e) {
      state.isAdmin = false;
    }
  }
}

function updateCloudBadge(isOnline) {
  const dot = document.getElementById("cloudStatusDot");
  const text = document.getElementById("cloudStatusText");
  if (isOnline) {
    dot.className = "status-dot online";
    text.textContent = "Firebase Connected";
  } else {
    dot.className = "status-dot offline";
    text.textContent = "Local / Setup DB";
  }
}

// ============================================================================
// RENDERING
// ============================================================================

function renderAll() {
  renderSportsRibbon();
  renderCompetitionBanner();
  renderFixturesTab();
  renderLeaderboardTab();
  renderMyPredictionsTab();
  renderAdminTab();
  renderAuthUI();
}

function renderSportsRibbon() {
  const bar = document.getElementById("sportsFilterBar");
  bar.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.className = `sport-chip ${state.selectedSportFilter === "ALL" ? "active" : ""}`;
  allChip.innerHTML = `🏟️ All Sports (${SPORTS_CATALOG.length})`;
  allChip.addEventListener("click", () => {
    state.selectedSportFilter = "ALL";
    renderAll();
  });
  bar.appendChild(allChip);

  SPORTS_CATALOG.forEach((sport) => {
    const chip = document.createElement("button");
    chip.className = `sport-chip ${state.selectedSportFilter === sport.id ? "active" : ""}`;
    chip.innerHTML = `${sport.emoji} ${escapeHtml(sport.name)}`;
    chip.addEventListener("click", () => {
      state.selectedSportFilter = sport.id;
      // Automatically switch to a competition of this sport if available
      const matchingComp = state.competitions.find((c) => c.sportId === sport.id);
      if (matchingComp) {
        state.activeCompetitionId = matchingComp.id;
      }
      renderAll();
    });
    bar.appendChild(chip);
  });
}

function renderCompetitionBanner() {
  const select = document.getElementById("activeCompetitionSelect");
  select.innerHTML = "";

  const filteredComps =
    state.selectedSportFilter === "ALL"
      ? state.competitions
      : state.competitions.filter((c) => c.sportId === state.selectedSportFilter);

  const listToShow = filteredComps.length > 0 ? filteredComps : state.competitions;

  if (!listToShow.some((c) => c.id === state.activeCompetitionId) && listToShow[0]) {
    state.activeCompetitionId = listToShow[0].id;
  }

  listToShow.forEach((comp) => {
    const sport = getSportById(comp.sportId);
    const opt = document.createElement("option");
    opt.value = comp.id;
    opt.textContent = `${sport.emoji} ${comp.title} (${comp.season || "2026"})`;
    if (comp.id === state.activeCompetitionId) opt.selected = true;
    select.appendChild(opt);
  });

  const activeComp = getActiveCompetition();
  const heroDeleteBtn = document.getElementById("btnHeroDeleteComp");
  if (heroDeleteBtn) {
    heroDeleteBtn.classList.toggle("hidden", !state.isAdmin || !activeComp);
  }
  if (!activeComp) return;

  const sport = getSportById(activeComp.sportId);
  document.getElementById("activeCompDescription").textContent =
    `${sport.emoji} ${sport.name} • ${activeComp.description || ""}`;

  const t1 = (Number(activeComp.tier1Margin) || 7) <= 2 ? 7 : Number(activeComp.tier1Margin);
  const t2 = (Number(activeComp.tier2Margin) || 14) <= 5 ? 14 : Number(activeComp.tier2Margin);

  document.getElementById("ruleExactPts").textContent = `+${activeComp.exactBonusPts ?? 3} BONUS`;
  document.getElementById("ruleExactLabel").textContent =
    `Exact / Within ${t1} Pts (Each Team)`;
  document.getElementById("ruleClosePts").textContent = `+${activeComp.closeBonusPts ?? 2} BONUS`;
  document.getElementById("ruleCloseLabel").textContent =
    `Within ${t2} Pts (Each Team)`;

  // Registration status bar for strict-approval leagues
  const regBox = document.getElementById("registrationStatusBox");
  regBox.innerHTML = "";
  if (activeComp.requiresApproval) {
    if (!state.user) {
      regBox.innerHTML = `<span class="badge-pill badge-warn">🔒 Approval Required — Sign In to Register for this League</span>`;
    } else {
      const regId = `${activeComp.id}__${state.user.uid}`;
      const existingReg = state.registrations.find((r) => r.id === regId);
      if (!existingReg) {
        regBox.innerHTML = `
          <button id="btnRegisterForComp" class="btn btn-primary btn-sm">
            🎟️ Request League Registration (Approval Required)
          </button>
        `;
        document.getElementById("btnRegisterForComp").addEventListener("click", () => {
          registerForCompetition(activeComp);
        });
      } else if (existingReg.status === "pending") {
        regBox.innerHTML = `<span class="badge-pill badge-warn">⏳ Registration Pending Admin Approval</span>`;
      } else if (existingReg.status === "approved") {
        regBox.innerHTML = `<span class="badge-pill">✅ Approved Competitor</span>`;
      }
    }
  }
}

function getRoundsForCompetition(compId) {
  const seen = new Set();
  const rounds = [];
  state.games
    .filter((g) => g.competitionId === compId)
    .forEach((g) => {
      const rName = (g.roundName || "Round 1").trim();
      if (rName && !seen.has(rName)) {
        seen.add(rName);
        rounds.push(rName);
      }
    });
  return rounds;
}

function renderFixturesTab() {
  const activeComp = getActiveCompetition();
  const container = document.getElementById("gamesListContainer");
  const roundBar = document.getElementById("roundFilterBar");
  const roundDropdown = document.getElementById("roundSelectDropdown");
  container.innerHTML = "";
  if (roundBar) roundBar.innerHTML = "";
  if (roundDropdown) roundDropdown.innerHTML = `<option value="ALL">All Rounds</option>`;

  // Admin quick buttons
  const adminQuick = document.getElementById("fixturesAdminQuickActions");
  adminQuick.innerHTML = "";
  if (state.isAdmin) {
    adminQuick.innerHTML = `
      <button class="btn btn-primary btn-sm" id="btnQuickLiveSync" title="Automatically fetch fixtures and live final scores from the internet">
        🌐 Auto-Sync Fixtures &amp; Results
      </button>
      <button class="btn btn-outline btn-sm" id="btnQuickNewComp">🏆 + New Competition</button>
      <button class="btn btn-secondary btn-sm" id="btnQuickAddFixture">🏟️ + Add Fixture</button>
      ${
        activeComp
          ? `<button class="btn btn-danger-ghost btn-sm" id="btnQuickDeleteComp" title="Delete this entire competition and its fixtures">🗑️ Delete Competition</button>`
          : ""
      }
    `;
    document.getElementById("btnQuickLiveSync").addEventListener("click", () => {
      openLiveSyncModal();
    });
    document.getElementById("btnQuickNewComp").addEventListener("click", () => {
      document.getElementById("newCompModal").classList.remove("hidden");
    });
    document.getElementById("btnQuickAddFixture").addEventListener("click", () => {
      openGameFormModal(null);
    });
    const delCompBtn = document.getElementById("btnQuickDeleteComp");
    if (delCompBtn && activeComp) {
      delCompBtn.addEventListener("click", () => {
        deleteCompetition(activeComp.id);
      });
    }
  }

  if (!activeComp) return;
  const sport = getSportById(activeComp.sportId);
  document.getElementById("fixturesHeading").textContent = `${sport.emoji} ${activeComp.title} — Fixtures`;

  const allCompGames = state.games.filter((g) => g.competitionId === activeComp.id);
  const rounds = getRoundsForCompetition(activeComp.id);

  // Reset round filter if the selected round doesn't exist in this competition
  if (state.selectedRoundFilter !== "ALL" && !rounds.includes(state.selectedRoundFilter)) {
    state.selectedRoundFilter = "ALL";
  }

  // Render Round Filter Chips & Dropdown
  if (roundBar) {
    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = `round-chip ${state.selectedRoundFilter === "ALL" ? "active" : ""}`;
    allChip.textContent = `All Rounds (${allCompGames.length})`;
    allChip.addEventListener("click", () => {
      state.selectedRoundFilter = "ALL";
      renderFixturesTab();
    });
    roundBar.appendChild(allChip);

    rounds.forEach((rName) => {
      const count = allCompGames.filter((g) => (g.roundName || "Round 1").trim() === rName).length;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `round-chip ${state.selectedRoundFilter === rName ? "active" : ""}`;
      chip.textContent = `${rName} (${count})`;
      chip.addEventListener("click", () => {
        state.selectedRoundFilter = rName;
        renderFixturesTab();
      });
      roundBar.appendChild(chip);

      if (roundDropdown) {
        const opt = document.createElement("option");
        opt.value = rName;
        opt.textContent = `${rName} (${count} ${count === 1 ? "fixture" : "fixtures"})`;
        if (state.selectedRoundFilter === rName) opt.selected = true;
        roundDropdown.appendChild(opt);
      }
    });
  }

  const compGames =
    state.selectedRoundFilter === "ALL"
      ? allCompGames
      : allCompGames.filter((g) => (g.roundName || "Round 1").trim() === state.selectedRoundFilter);

  if (compGames.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; background:#fff; padding:40px; border-radius:14px; text-align:center;">
        <h3>No fixtures scheduled in this round yet</h3>
        <p class="muted">Admins can click "+ Add Fixture" to schedule games for this competition.</p>
      </div>
    `;
    return;
  }

  compGames.forEach((game) => {
    const locked = isGameLocked(game);
    const statusClass = game.status === "completed" ? "completed" : locked ? "locked" : "upcoming";
    const statusText =
      game.status === "completed"
        ? "Final Score"
        : locked
        ? "Locked"
        : "Open for Predictions";

    const userPred = state.user
      ? state.predictions.find((p) => p.gameId === game.id && p.userId === state.user.uid)
      : null;

    const scoreBreakdown = userPred
      ? calculatePredictionPoints(userPred, game, activeComp)
      : null;

    const homeDisplay =
      game.status === "completed" ? formatSideScore(game, "home", activeComp.sportId) : "—";
    const awayDisplay =
      game.status === "completed" ? formatSideScore(game, "away", activeComp.sportId) : "—";

    const card = document.createElement("article");
    card.className = "game-card";
    card.innerHTML = `
      <div>
        <div class="game-card-header">
          <span><strong>${escapeHtml(game.roundName || "Fixture")}</strong> • ${escapeHtml(game.venue || "TBA")}</span>
          <span class="game-status-badge ${statusClass}">${statusText}</span>
        </div>
        <div class="muted" style="font-size:0.76rem; margin: 4px 0 10px;">
          🕒 Kickoff: ${formatKickoff(game.kickoffTime)}
        </div>

        <div class="scoreboard-box">
          <div class="team-row">
            <span>${escapeHtml(game.homeTeam)}</span>
            <span class="team-score-badge">${homeDisplay}</span>
          </div>
          <div class="team-row">
            <span>${escapeHtml(game.awayTeam)}</span>
            <span class="team-score-badge">${awayDisplay}</span>
          </div>
        </div>
      </div>

      <div class="user-pick-box">
        <div>
          ${
            userPred
              ? `
                <div style="font-size:0.84rem;">
                  <strong>Your Pick:</strong> ${escapeHtml(userPred.pickedOutcome)}
                  (${formatSideScore(userPred, "home", activeComp.sportId)} to ${formatSideScore(userPred, "away", activeComp.sportId)})
                </div>
                <div class="muted" style="font-size:0.76rem;">
                  ${scoreBreakdown.summary}
                </div>
              `
              : `<span class="muted" style="font-size:0.84rem;">No prediction submitted yet</span>`
          }
        </div>

        <div style="display:flex; align-items:center; gap:8px;">
          ${
            scoreBreakdown && scoreBreakdown.graded
              ? `<span class="points-earned-pill ${scoreBreakdown.totalPoints >= 5 ? "high" : ""}">+${scoreBreakdown.totalPoints} PTS</span>`
              : ""
          }
          ${
            !locked
              ? `<button class="btn btn-primary btn-sm" data-predict-game="${game.id}">
                  🎯 ${userPred ? "Edit Pick" : "Predict"}
                </button>`
              : ""
          }
          ${
            state.isAdmin
              ? `<button class="btn btn-outline btn-sm" data-admin-edit-game="${game.id}" title="Admin: Enter Final Score / Edit">⚙️</button>`
              : ""
          }
        </div>
      </div>
    `;

    const predBtn = card.querySelector(`[data-predict-game="${game.id}"]`);
    if (predBtn) {
      predBtn.addEventListener("click", () => openPredictionModal(game));
    }

    const editBtn = card.querySelector(`[data-admin-edit-game="${game.id}"]`);
    if (editBtn) {
      editBtn.addEventListener("click", () => openGameFormModal(game));
    }

    container.appendChild(card);
  });
}

// ============================================================================
// LEADERBOARD ENGINE (PER COMPETITION)
// ============================================================================

function computeCompetitionLeaderboard(competitionId, roundFilter = "ALL") {
  const comp = state.competitions.find((c) => c.id === competitionId);
  if (!comp) return [];

  const compGames = state.games.filter(
    (g) =>
      g.competitionId === competitionId &&
      (roundFilter === "ALL" || (g.roundName || "Round 1").trim() === roundFilter)
  );
  const gameMap = new Map();
  compGames.forEach((g) => gameMap.set(g.id, g));

  const compPreds = state.predictions.filter((p) => p.competitionId === competitionId);
  const players = new Map();

  compPreds.forEach((pred) => {
    const game = gameMap.get(pred.gameId);
    if (!game) return;

    if (!players.has(pred.userId)) {
      players.set(pred.userId, {
        userId: pred.userId,
        userName: pred.userName || pred.userId,
        gradedCount: 0,
        correctResults: 0,
        tier1Bonuses: 0,
        tier2Bonuses: 0,
        totalPoints: 0
      });
    }

    const entry = players.get(pred.userId);
    const res = calculatePredictionPoints(pred, game, comp);
    if (res.graded) {
      entry.gradedCount += 1;
      if (res.isResultCorrect) entry.correctResults += 1;
      if (res.tier === "tier1_bonus") entry.tier1Bonuses += 1;
      if (res.tier === "tier2_bonus") entry.tier2Bonuses += 1;
      entry.totalPoints += res.totalPoints;
    }
  });

  return Array.from(players.values()).sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.tier1Bonuses !== a.tier1Bonuses) return b.tier1Bonuses - a.tier1Bonuses;
    return b.correctResults - a.correctResults;
  });
}

function renderLeaderboardTab() {
  const activeComp = getActiveCompetition();
  const heroDeleteBtn = document.getElementById("btnHeroDeleteComp");
  if (heroDeleteBtn) {
    heroDeleteBtn.classList.toggle("hidden", !state.isAdmin || !activeComp);
  }

  const lockedCard = document.getElementById("leaderboardLockedCard");
  const unlockedContent = document.getElementById("leaderboardUnlockedContent");
  const tbody = document.getElementById("leaderboardTableBody");

  // Hide all leaderboard & user data if not signed in
  if (!state.user) {
    if (lockedCard) lockedCard.classList.remove("hidden");
    if (unlockedContent) unlockedContent.classList.add("hidden");
    if (tbody) tbody.innerHTML = "";
    return;
  }

  if (lockedCard) lockedCard.classList.add("hidden");
  if (unlockedContent) unlockedContent.classList.remove("hidden");

  if (!activeComp) return;

  const rounds = getRoundsForCompetition(activeComp.id);
  if (
    state.selectedLeaderboardRound !== "ALL" &&
    !rounds.includes(state.selectedLeaderboardRound)
  ) {
    state.selectedLeaderboardRound = "ALL";
  }

  const lbRoundSel = document.getElementById("leaderboardRoundSelect");
  if (lbRoundSel) {
    lbRoundSel.innerHTML = `<option value="ALL">🏆 Full Competition (All Rounds)</option>`;
    rounds.forEach((rName) => {
      const opt = document.createElement("option");
      opt.value = rName;
      opt.textContent = `📅 ${rName} Standings`;
      if (state.selectedLeaderboardRound === rName) opt.selected = true;
      lbRoundSel.appendChild(opt);
    });
  }

  const sport = getSportById(activeComp.sportId);
  const roundSuffix =
    state.selectedLeaderboardRound === "ALL"
      ? "Official Leaderboard"
      : `${state.selectedLeaderboardRound} Standings`;
  document.getElementById("leaderboardHeading").textContent =
    `📊 ${sport.emoji} ${activeComp.title} — ${roundSuffix}`;

  const standings = computeCompetitionLeaderboard(
    activeComp.id,
    state.selectedLeaderboardRound
  );
  tbody.innerHTML = "";

  if (standings.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding: 32px;">
          No predictions graded yet for this competition. Make a pick and enter a final score!
        </td>
      </tr>
    `;
    return;
  }

  standings.forEach((row, index) => {
    const rank = index + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="rank-badge ${rankClass}">${rank}</span></td>
      <td><strong>${escapeHtml(row.userName)}</strong></td>
      <td>${row.gradedCount}</td>
      <td>${row.correctResults} <small class="muted">(${row.correctResults * (activeComp.resultPts ?? 3)} pts)</small></td>
      <td>${row.tier1Bonuses} <small class="muted">(+${row.tier1Bonuses * (activeComp.exactBonusPts ?? 3)} pts)</small></td>
      <td>${row.tier2Bonuses} <small class="muted">(+${row.tier2Bonuses * (activeComp.closeBonusPts ?? 2)} pts)</small></td>
      <td class="total-pts-cell">${row.totalPoints} pts</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderMyPredictionsTab() {
  const container = document.getElementById("myPicksContainer");
  container.innerHTML = "";

  if (!state.user) {
    container.innerHTML = `
      <div style="grid-column:1/-1; background:#fff; padding:44px 24px; border-radius:14px; text-align:center; border:1px solid var(--border);">
        <div style="font-size: 2.6rem; margin-bottom: 8px;">🔒</div>
        <h3>Sign In to View Your Predictions &amp; Points</h3>
        <p class="muted" style="margin-bottom: 18px;">User prediction details and point breakdowns are only visible to logged-in members.</p>
        <button id="btnSignInFromMyPicks" type="button" class="btn btn-primary">🔐 Sign In / Create Account</button>
      </div>
    `;
    document.getElementById("btnSignInFromMyPicks")?.addEventListener("click", () => {
      document.getElementById("authModal").classList.remove("hidden");
    });
    return;
  }

  const myPreds = state.predictions.filter((p) => p.userId === state.user.uid);
  if (myPreds.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1; background:#fff; padding:36px; border-radius:14px; text-align:center;">
        <h3>You haven't locked in any predictions yet</h3>
        <p class="muted">Head over to the Fixtures tab and click "Predict" on any upcoming match!</p>
      </div>
    `;
    return;
  }

  myPreds.forEach((pred) => {
    const game = state.games.find((g) => g.id === pred.gameId);
    const comp = state.competitions.find((c) => c.id === pred.competitionId);
    if (!game || !comp) return;
    const sport = getSportById(comp.sportId);
    const res = calculatePredictionPoints(pred, game, comp);

    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = `
      <div>
        <div class="game-card-header">
          <span class="sport-pill">${sport.emoji} ${escapeHtml(comp.title)}</span>
          <span class="game-status-badge ${game.status}">${escapeHtml(game.status)}</span>
        </div>
        <h3 style="margin: 10px 0 6px;">${escapeHtml(game.homeTeam)} vs ${escapeHtml(game.awayTeam)}</h3>
        <div class="muted" style="font-size:0.84rem;">
          Your Pick: <strong>${escapeHtml(pred.pickedOutcome)}</strong>
          (${formatSideScore(pred, "home", comp.sportId)} — ${formatSideScore(pred, "away", comp.sportId)})
        </div>
        ${
          game.status === "completed"
            ? `<div style="font-size:0.84rem; margin-top:4px;">
                Official Result: <strong>${formatSideScore(game, "home", comp.sportId)} — ${formatSideScore(game, "away", comp.sportId)}</strong>
               </div>`
            : ""
        }
      </div>
      <div class="user-pick-box">
        <span class="muted" style="font-size:0.8rem;">${res.summary}</span>
        <span class="points-earned-pill ${res.totalPoints >= 5 ? "high" : ""}">
          ${res.graded ? `+${res.totalPoints} PTS` : "Pending"}
        </span>
      </div>
    `;
    container.appendChild(card);
  });
}

// ============================================================================
// PREDICTION MODAL & GAA LIVE CALCULATOR
// ============================================================================

function openPredictionModal(game) {
  if (!state.user) {
    document.getElementById("authModal").classList.remove("hidden");
    showToast("🔐 Please sign in to lock in your match prediction!");
    return;
  }

  const comp = state.competitions.find((c) => c.id === game.competitionId);
  if (comp?.requiresApproval && !state.isAdmin) {
    const reg = state.registrations.find(
      (r) => r.id === `${comp.id}__${state.user.uid}` && r.status === "approved"
    );
    if (!reg) {
      showToast("🎟️ This competition requires Admin registration approval before predicting.");
      return;
    }
  }

  state.activePredictGameId = game.id;
  const sport = getSportById(game.sportId || comp?.sportId);

  document.getElementById("predModalSportBadge").textContent = `${sport.emoji} ${sport.name}`;
  document.getElementById("predModalTitle").textContent = `${game.homeTeam} vs ${game.awayTeam}`;
  document.getElementById("predHomeName").textContent = game.homeTeam;
  document.getElementById("predAwayName").textContent = game.awayTeam;
  document.getElementById("btnPickHome").textContent = `${game.homeTeam} Win`;
  document.getElementById("btnPickAway").textContent = `${game.awayTeam} Win`;

  const existing = state.predictions.find(
    (p) => p.gameId === game.id && p.userId === state.user.uid
  );

  setPickedOutcome(existing?.pickedOutcome || "HOME");

  const stdBox = document.getElementById("standardScoreInputs");
  const gaaBox = document.getElementById("gaaScoreInputs");

  if (sport.scoringMode === "gaa") {
    stdBox.classList.add("hidden");
    gaaBox.classList.remove("hidden");
    document.getElementById("gaaHomeLabel").textContent = game.homeTeam;
    document.getElementById("gaaAwayLabel").textContent = game.awayTeam;
    document.getElementById("predHomeGoals").value = existing?.homeGoals ?? 1;
    document.getElementById("predHomePoints").value = existing?.homePoints ?? 18;
    document.getElementById("predAwayGoals").value = existing?.awayGoals ?? 1;
    document.getElementById("predAwayPoints").value = existing?.awayPoints ?? 15;
    updateGaaLivePreview();
  } else {
    gaaBox.classList.add("hidden");
    stdBox.classList.remove("hidden");
    document.getElementById("lblPredHomeScore").textContent = `${game.homeTeam} (${sport.unitLabel})`;
    document.getElementById("lblPredAwayScore").textContent = `${game.awayTeam} (${sport.unitLabel})`;
    document.getElementById("predHomeScore").value = existing?.homeScore ?? 21;
    document.getElementById("predAwayScore").value = existing?.awayScore ?? 17;
  }

  document.getElementById("predictModal").classList.remove("hidden");
}

function setPickedOutcome(outcome) {
  state.pickedOutcomeInModal = outcome;
  document.querySelectorAll("#outcomePickerGroup .outcome-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.outcome === outcome);
  });
}

function updateGaaLivePreview() {
  const hg = Number(document.getElementById("predHomeGoals").value) || 0;
  const hp = Number(document.getElementById("predHomePoints").value) || 0;
  const ag = Number(document.getElementById("predAwayGoals").value) || 0;
  const ap = Number(document.getElementById("predAwayPoints").value) || 0;

  const hTotal = computeGaaTotal(hg, hp);
  const aTotal = computeGaaTotal(ag, ap);

  document.getElementById("predHomeGaaTotal").textContent = `${hTotal} pts`;
  document.getElementById("predAwayGaaTotal").textContent = `${aTotal} pts`;

  // Automatically sync outcome button with higher total
  setPickedOutcome(getOutcomeFromScores(hTotal, aTotal));
}

// ============================================================================
// ADMIN CONTROL CENTER
// ============================================================================

function renderAdminTab() {
  const locked = document.getElementById("adminLockedCard");
  const dash = document.getElementById("adminDashboardContent");
  const pendingBadge = document.getElementById("adminPendingRegBadge");

  const pendingRegs = state.registrations.filter((r) => r.status === "pending");
  if (pendingRegs.length > 0 && state.isAdmin) {
    pendingBadge.textContent = pendingRegs.length;
    pendingBadge.classList.remove("hidden");
  } else {
    pendingBadge.classList.add("hidden");
  }

  if (!state.isAdmin) {
    locked.classList.remove("hidden");
    dash.classList.add("hidden");
    return;
  }

  locked.classList.add("hidden");
  dash.classList.remove("hidden");

  const activeComp = getActiveCompetition();
  const gamesList = document.getElementById("adminGamesManagerList");
  gamesList.innerHTML = "";

  if (activeComp) {
    const compGames = state.games.filter((g) => g.competitionId === activeComp.id);
    compGames.forEach((g) => {
      const row = document.createElement("div");
      row.className = "admin-item-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(g.homeTeam)} vs ${escapeHtml(g.awayTeam)}</strong>
          <span class="game-status-badge ${g.status}" style="margin-left:8px;">${g.status}</span>
          <div class="muted" style="font-size:0.8rem;">
            ${escapeHtml(g.roundName)} • Score: ${formatSideScore(g, "home", activeComp.sportId)} — ${formatSideScore(g, "away", activeComp.sportId)}
          </div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-primary btn-sm" data-edit-g="${g.id}">⚡ Enter Score / Edit</button>
          <button class="btn btn-danger-ghost btn-sm" data-del-g="${g.id}">🗑️</button>
        </div>
      `;
      row.querySelector(`[data-edit-g="${g.id}"]`).addEventListener("click", () => {
        openGameFormModal(g);
      });
      row.querySelector(`[data-del-g="${g.id}"]`).addEventListener("click", () => {
        deleteGame(g.id);
      });
      gamesList.appendChild(row);
    });
  }

  // Registrations list
  document.getElementById("regCountBadge").textContent = state.registrations.length;
  const regList = document.getElementById("adminRegistrationsList");
  regList.innerHTML = "";
  if (state.registrations.length === 0) {
    regList.innerHTML = `<p class="muted">No league registration requests yet.</p>`;
  } else {
    state.registrations.forEach((reg) => {
      const comp = state.competitions.find((c) => c.id === reg.competitionId);
      const row = document.createElement("div");
      row.className = "admin-item-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(reg.userName || reg.userId)}</strong>
          <div class="muted" style="font-size:0.78rem;">${escapeHtml(comp?.title || reg.competitionId)} • Status: <strong>${reg.status.toUpperCase()}</strong></div>
        </div>
        <div style="display:flex; gap:6px;">
          ${
            reg.status !== "approved"
              ? `<button class="btn btn-primary btn-sm" data-approve-reg="${reg.id}">✅ Approve</button>`
              : `<span class="sport-pill">Approved</span>`
          }
        </div>
      `;
      const btn = row.querySelector(`[data-approve-reg="${reg.id}"]`);
      if (btn) {
        btn.addEventListener("click", () => approveRegistration(reg));
      }
      regList.appendChild(row);
    });
  }

  // Competitions list
  document.getElementById("compCountBadge").textContent = state.competitions.length;
  const compList = document.getElementById("adminCompetitionsList");
  compList.innerHTML = "";
  state.competitions.forEach((c) => {
    const sport = getSportById(c.sportId);
    const row = document.createElement("div");
    row.className = "admin-item-row";
    row.innerHTML = `
      <div>
        <strong>${sport.emoji} ${escapeHtml(c.title)}</strong>
        <div class="muted" style="font-size:0.78rem;">${escapeHtml(c.season)} • Result: +${c.resultPts}pts | Within 7/Team: +${c.exactBonusPts}pts | Within 14/Team: +${c.closeBonusPts}pts</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-outline btn-sm" data-select-comp="${c.id}">View</button>
        <button class="btn btn-danger-ghost btn-sm" data-delete-comp="${c.id}" title="Delete this competition">🗑️ Delete</button>
      </div>
    `;
    row.querySelector(`[data-select-comp="${c.id}"]`).addEventListener("click", () => {
      state.activeCompetitionId = c.id;
      renderAll();
      showToast(`Switched active competition to ${c.title}`);
    });
    row.querySelector(`[data-delete-comp="${c.id}"]`).addEventListener("click", () => {
      deleteCompetition(c.id);
    });
    compList.appendChild(row);
  });
}

async function deleteCompetition(compId) {
  const comp = state.competitions.find((c) => c.id === compId);
  if (!comp) return;

  const confirmed = window.confirm(
    `Are you sure you want to delete "${comp.title}" and all of its fixtures?`
  );
  if (!confirmed) return;

  const gamesToDelete = state.games.filter((g) => g.competitionId === compId);

  if (!state.deletedCompetitionIds.includes(compId)) {
    state.deletedCompetitionIds.push(compId);
  }
  state.competitions = state.competitions.filter((c) => c.id !== compId);
  state.games = state.games.filter((g) => g.competitionId !== compId);
  state.predictions = state.predictions.filter((p) => p.competitionId !== compId);
  state.registrations = state.registrations.filter((r) => r.competitionId !== compId);

  if (state.activeCompetitionId === compId) {
    state.activeCompetitionId = state.competitions[0]?.id || "";
  }

  saveToLocalStorage();

  if (state.firebaseReady && state.isAdmin && state.fbDb) {
    try {
      const { doc, setDoc, deleteDoc } = state.fbModules;
      const isStarter = STARTER_COMPETITIONS.some((s) => s.id === compId);
      if (isStarter) {
        // Mark starter competition as deleted in Firestore so it stays deleted for all users
        await setDoc(doc(state.fbDb, "competitions", compId), {
          id: compId,
          deleted: true,
          deletedAt: new Date().toISOString()
        });
      } else {
        await deleteDoc(doc(state.fbDb, "competitions", compId));
      }

      for (const g of gamesToDelete) {
        await deleteDoc(doc(state.fbDb, "games", g.id));
      }
    } catch (err) {
      console.warn("Firestore delete competition error:", err);
    }
  }

  renderAll();
  showToast(`🗑️ Deleted competition "${comp.title}".`);
}

function openGameFormModal(game = null) {
  state.editingGameId = game ? game.id : null;
  document.getElementById("gameModalHeading").textContent = game
    ? `⚡ Edit Fixture / Enter Final Result`
    : `🏟️ Add New Fixture`;

  const compSelect = document.getElementById("gameCompSelect");
  compSelect.innerHTML = "";
  state.competitions.forEach((c) => {
    const s = getSportById(c.sportId);
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${s.emoji} ${c.title}`;
    if ((game && game.competitionId === c.id) || (!game && c.id === state.activeCompetitionId)) {
      opt.selected = true;
    }
    compSelect.appendChild(opt);
  });

  const defaultRound =
    game?.roundName ||
    (state.selectedRoundFilter !== "ALL" ? state.selectedRoundFilter : "Round 1");
  document.getElementById("gameRound").value = defaultRound;

  // Populate round datalist with existing rounds in this competition + standard stages
  const datalist = document.getElementById("roundSuggestionsList");
  if (datalist) {
    const existingRounds = getRoundsForCompetition(compSelect.value);
    const standardRounds = [
      "Round 1",
      "Round 2",
      "Round 3",
      "Round 4",
      "Round 5",
      "Quarter-Final",
      "Semi-Final",
      "Final"
    ];
    const allSuggested = Array.from(new Set([...existingRounds, ...standardRounds]));
    datalist.innerHTML = allSuggested
      .map((r) => `<option value="${escapeHtml(r)}"></option>`)
      .join("");
  }

  document.getElementById("gameHomeTeam").value = game?.homeTeam || "";
  document.getElementById("gameAwayTeam").value = game?.awayTeam || "";
  document.getElementById("gameVenue").value = game?.venue || "";
  document.getElementById("gameKickoff").value = game?.kickoffTime || "2026-11-20T15:00";
  document.getElementById("gameStatus").value = game?.status || "upcoming";

  document.getElementById("gameHomeScore").value = game?.homeScore ?? 0;
  document.getElementById("gameAwayScore").value = game?.awayScore ?? 0;
  document.getElementById("gameHomeGoals").value = game?.homeGoals ?? 0;
  document.getElementById("gameHomePoints").value = game?.homePoints ?? 0;
  document.getElementById("gameAwayGoals").value = game?.awayGoals ?? 0;
  document.getElementById("gameAwayPoints").value = game?.awayPoints ?? 0;

  toggleAdminGameScoreMode();
  document.getElementById("gameFormModal").classList.remove("hidden");
}

function toggleAdminGameScoreMode() {
  const compId = document.getElementById("gameCompSelect").value;
  const comp = state.competitions.find((c) => c.id === compId);
  const sport = getSportById(comp?.sportId);

  if (sport.scoringMode === "gaa") {
    document.getElementById("adminStandardScoreBox").classList.add("hidden");
    document.getElementById("adminGaaScoreBox").classList.remove("hidden");
  } else {
    document.getElementById("adminGaaScoreBox").classList.add("hidden");
    document.getElementById("adminStandardScoreBox").classList.remove("hidden");
  }
}

async function deleteGame(gameId) {
  state.games = state.games.filter((g) => g.id !== gameId);
  saveToLocalStorage();
  if (state.firebaseReady && state.isAdmin && state.fbDb) {
    try {
      const { doc, deleteDoc } = state.fbModules;
      await deleteDoc(doc(state.fbDb, "games", gameId));
    } catch (e) {
      console.warn("Delete game error:", e);
    }
  }
  renderAll();
  showToast("🗑️ Fixture deleted.");
}

async function registerForCompetition(comp) {
  if (!state.user) return;
  const regId = `${comp.id}__${state.user.uid}`;
  const newReg = {
    id: regId,
    competitionId: comp.id,
    userId: state.user.uid,
    userName: state.user.displayName,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  state.registrations.push(newReg);
  saveToLocalStorage();

  if (state.firebaseReady && state.fbDb && state.user.isCloud) {
    try {
      const { doc, setDoc } = state.fbModules;
      await setDoc(doc(state.fbDb, "registrations", regId), newReg);
    } catch (err) {
      console.warn("Cloud registration error:", err);
    }
  }

  renderAll();
  showToast("🎟️ Registration submitted! Waiting for Admin approval.");
}

async function approveRegistration(reg) {
  reg.status = "approved";
  saveToLocalStorage();
  if (state.firebaseReady && state.isAdmin && state.fbDb) {
    try {
      const { doc, setDoc } = state.fbModules;
      await setDoc(doc(state.fbDb, "registrations", reg.id), reg, { merge: true });
    } catch (err) {
      console.warn("Approve error:", err);
    }
  }
  renderAll();
  showToast(`✅ Approved ${reg.userName} for competition!`);
}

// ============================================================================
// PDF EXPORT & PRINT
// ============================================================================

async function exportCompetitionPdf() {
  if (!state.user) {
    document.getElementById("authModal")?.classList.remove("hidden");
    showToast("🔒 Please sign in to view or export the Competition Leaderboard!");
    return;
  }
  const comp = getActiveCompetition();
  if (!comp) return;
  const sport = getSportById(comp.sportId);
  const standings = computeCompetitionLeaderboard(comp.id);
  const compGames = state.games.filter((g) => g.competitionId === comp.id);

  const lbRows = standings
    .map(
      (r, i) => `
      <tr>
        <td>#${i + 1}</td>
        <td><strong>${escapeHtml(r.userName)}</strong></td>
        <td>${r.gradedCount}</td>
        <td>${r.correctResults}</td>
        <td>${r.tier1Bonuses}</td>
        <td>${r.tier2Bonuses}</td>
        <td><strong>${r.totalPoints} pts</strong></td>
      </tr>
    `
    )
    .join("");

  const gameRows = compGames
    .map(
      (g) => `
      <tr>
        <td>${escapeHtml(g.roundName)}</td>
        <td><strong>${escapeHtml(g.homeTeam)}</strong> vs <strong>${escapeHtml(g.awayTeam)}</strong></td>
        <td>${escapeHtml(g.status.toUpperCase())}</td>
        <td>${g.status === "completed" ? `${formatSideScore(g, "home", comp.sportId)} — ${formatSideScore(g, "away", comp.sportId)}` : "Upcoming"}</td>
      </tr>
    `
    )
    .join("");

  const sheet = document.getElementById("pdfExportContainer");
  sheet.innerHTML = `
    <h2>${sport.emoji} ${escapeHtml(comp.title)} (${escapeHtml(comp.season)})</h2>
    <p>Scoring: Correct Result = +${comp.resultPts} pts | Within 7 Pts/Team = +${comp.exactBonusPts} pts | Within 14 Pts/Team = +${comp.closeBonusPts} pts</p>
    <h3>📊 Official Leaderboard</h3>
    <table class="pdf-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Player</th>
          <th>Graded</th>
          <th>Result (+3)</th>
          <th>Within 7/Team (+3)</th>
          <th>Within 14/Team (+2)</th>
          <th>Total Points</th>
        </tr>
      </thead>
      <tbody>${lbRows || `<tr><td colspan="7">No graded picks yet</td></tr>`}</tbody>
    </table>

    <h3>🏟️ Competition Fixtures &amp; Results</h3>
    <table class="pdf-table">
      <thead>
        <tr>
          <th>Round</th>
          <th>Matchup</th>
          <th>Status</th>
          <th>Score</th>
        </tr>
      </thead>
      <tbody>${gameRows}</tbody>
    </table>
  `;

  sheet.classList.add("generating-pdf");
  if (window.html2pdf) {
    await window
      .html2pdf()
      .set({
        margin: 10,
        filename: `${comp.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-leaderboard.pdf`,
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
      })
      .from(sheet)
      .save();
  } else {
    window.print();
  }
  sheet.classList.remove("generating-pdf");
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

function renderAuthUI() {
  const area = document.getElementById("authArea");
  if (state.user) {
    area.innerHTML = `
      <div class="user-chip">
        <span>${state.isAdmin ? "🛡️" : "👤"} ${escapeHtml(state.user.displayName)}</span>
        <button id="btnSignOut" class="btn btn-ghost btn-sm" style="padding:3px 8px;">Sign Out</button>
      </div>
    `;
    document.getElementById("btnSignOut").addEventListener("click", async () => {
      if (state.firebaseReady && state.fbAuth) {
        await state.fbModules.signOut(state.fbAuth);
      }
      localStorage.removeItem("arenapick_local_user");
      state.user = null;
      state.isAdmin = false;
      renderAll();
      showToast("Signed out.");
    });
  } else {
    area.innerHTML = `<button id="btnOpenAuth" class="btn btn-primary btn-sm">🔐 Sign In</button>`;
    document.getElementById("btnOpenAuth").addEventListener("click", () => {
      document.getElementById("authModal").classList.remove("hidden");
    });
  }
}

// ============================================================================
// LIVE INTERNET FIXTURE & SCORE SYNC CONTROLLER
// ============================================================================

function openLiveSyncModal() {
  const activeComp = getActiveCompetition();
  const feedSelect = document.getElementById("liveFeedSelect");
  if (feedSelect && activeComp) {
    // Pre-select a matching feed for the active competition's sport if available
    const matchingFeed =
      (activeComp.linkedFeedId && getFeedById(activeComp.linkedFeedId)) ||
      LIVE_LEAGUE_FEEDS.find((f) => f.sportId === activeComp.sportId);
    if (matchingFeed) {
      feedSelect.value = matchingFeed.id;
    }
  }
  const logBox = document.getElementById("liveSyncStatusLog");
  if (logBox) {
    logBox.classList.add("hidden");
    logBox.innerHTML = "";
  }
  document.getElementById("liveSyncModal")?.classList.remove("hidden");
}

async function runLiveInternetSync(feedId, targetMode = "active") {
  const feed = getFeedById(feedId);
  if (!feed) return;

  const logBox = document.getElementById("liveSyncStatusLog");
  const btn = document.getElementById("btnRunLiveSync");
  if (logBox) {
    logBox.classList.remove("hidden");
    logBox.innerHTML = `⏳ Connecting to live scoreboard feed for <strong>${escapeHtml(feed.name)}</strong>...`;
  }
  if (btn) btn.disabled = true;

  try {
    const fetchedMatches = await fetchFixturesAndResultsFromFeed(feedId);

    let targetComp = getActiveCompetition();
    if (targetMode === "create_new" || !targetComp) {
      const cleanTitle = feed.name.replace(/^[^\w]+/, "").replace(/\s*\(.*?\)\s*$/, "");
      targetComp = {
        id: "comp-" + Date.now(),
        title: cleanTitle,
        sportId: feed.sportId,
        season: "2026/27 Live",
        description: `Auto-synced from ${cleanTitle} live internet scoreboard.`,
        linkedFeedId: feed.id,
        requiresApproval: false,
        resultPts: 3,
        exactBonusPts: 3,
        closeBonusPts: 2,
        tier1Margin: 7,
        tier2Margin: 14
      };
      state.competitions.unshift(targetComp);
      state.activeCompetitionId = targetComp.id;

      if (state.firebaseReady && state.isAdmin && state.fbDb) {
        const { doc, setDoc } = state.fbModules;
        await setDoc(doc(state.fbDb, "competitions", targetComp.id), targetComp);
      }
    } else {
      targetComp.linkedFeedId = feed.id;
      if (state.firebaseReady && state.isAdmin && state.fbDb) {
        const { doc, setDoc } = state.fbModules;
        await setDoc(doc(state.fbDb, "competitions", targetComp.id), targetComp, { merge: true });
      }
    }

    let addedCount = 0;
    let updatedScoresCount = 0;
    const touchedGames = [];

    fetchedMatches.forEach((incoming) => {
      // Find existing match in this competition by externalId OR by matching Home + Away team names
      const existing = state.games.find(
        (g) =>
          g.competitionId === targetComp.id &&
          ((incoming.externalId && g.externalId === incoming.externalId) ||
            (g.homeTeam.toLowerCase().trim() === incoming.homeTeam.toLowerCase().trim() &&
              g.awayTeam.toLowerCase().trim() === incoming.awayTeam.toLowerCase().trim()))
      );

      if (existing) {
        // Update status and official final scores if changed
        const wasCompleted = existing.status === "completed";
        const scoreChanged =
          existing.homeScore !== incoming.homeScore ||
          existing.awayScore !== incoming.awayScore ||
          existing.status !== incoming.status;

        existing.externalId = incoming.externalId || existing.externalId;
        existing.venue = incoming.venue || existing.venue;
        existing.kickoffTime = incoming.kickoffTime || existing.kickoffTime;

        if (incoming.status === "completed" || incoming.status === "locked") {
          existing.status = incoming.status;
          existing.homeScore = incoming.homeScore;
          existing.awayScore = incoming.awayScore;
          existing.homeGoals = incoming.homeGoals ?? existing.homeGoals ?? 0;
          existing.homePoints = incoming.homePoints ?? existing.homePoints ?? 0;
          existing.awayGoals = incoming.awayGoals ?? existing.awayGoals ?? 0;
          existing.awayPoints = incoming.awayPoints ?? existing.awayPoints ?? 0;
          if (!wasCompleted || scoreChanged) {
            updatedScoresCount += 1;
            touchedGames.push(existing);
          }
        }
      } else {
        const newGame = {
          id: `game-${incoming.externalId || Date.now() + "-" + Math.random().toString(36).slice(2, 6)}`,
          externalId: incoming.externalId,
          competitionId: targetComp.id,
          sportId: targetComp.sportId,
          roundName: incoming.roundName || "Round 1",
          homeTeam: incoming.homeTeam,
          awayTeam: incoming.awayTeam,
          venue: incoming.venue || "Official Venue",
          kickoffTime: incoming.kickoffTime,
          status: incoming.status,
          homeGoals: incoming.homeGoals || 0,
          homePoints: incoming.homePoints || 0,
          homeScore: incoming.homeScore || 0,
          awayGoals: incoming.awayGoals || 0,
          awayPoints: incoming.awayPoints || 0,
          awayScore: incoming.awayScore || 0
        };
        state.games.push(newGame);
        addedCount += 1;
        if (newGame.status === "completed") updatedScoresCount += 1;
        touchedGames.push(newGame);
      }
    });

    state.selectedRoundFilter = "ALL";
    saveToLocalStorage();

    if (state.firebaseReady && state.isAdmin && state.fbDb) {
      const { doc, setDoc } = state.fbModules;
      for (const g of touchedGames) {
        await setDoc(doc(state.fbDb, "games", g.id), g);
      }
    }

    renderAll();

    if (logBox) {
      logBox.innerHTML = `
        ✅ <strong>Live Sync Complete!</strong><br/>
        • Processed <strong>${fetchedMatches.length}</strong> matches from ${escapeHtml(feed.name)}<br/>
        • Added <strong>${addedCount}</strong> new fixtures to <strong>${escapeHtml(targetComp.title)}</strong><br/>
        • Updated <strong>${updatedScoresCount}</strong> final match results &amp; recalculated Leaderboard!
      `;
    }
    showToast(`🌐 Synced ${addedCount} new fixtures & ${updatedScoresCount} results!`);
  } catch (err) {
    console.error("Live sync error:", err);
    if (logBox) {
      logBox.innerHTML = `⚠️ Could not reach live scoreboard feed: ${escapeHtml(err.message)}`;
    }
    showToast("⚠️ Live sync failed: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================================
// UI EVENT BINDINGS
// ============================================================================

function populateSportSelects() {
  const compSport = document.getElementById("compSport");
  compSport.innerHTML = "";
  SPORTS_CATALOG.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.emoji} ${s.name}`;
    compSport.appendChild(opt);
  });

  const feedSelect = document.getElementById("liveFeedSelect");
  if (feedSelect) {
    feedSelect.innerHTML = "";
    LIVE_LEAGUE_FEEDS.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      feedSelect.appendChild(opt);
    });
  }
}

function bindUIEvents() {
  // Navigation Tabs
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    });
  });

  // Active Competition Selector
  document.getElementById("activeCompetitionSelect").addEventListener("change", (e) => {
    state.activeCompetitionId = e.target.value;
    state.selectedRoundFilter = "ALL";
    state.selectedLeaderboardRound = "ALL";
    saveToLocalStorage();
    renderAll();
  });

  // Fixtures Round Dropdown Selector
  document.getElementById("roundSelectDropdown")?.addEventListener("change", (e) => {
    state.selectedRoundFilter = e.target.value;
    renderFixturesTab();
  });

  // Leaderboard Round Dropdown Selector
  document.getElementById("leaderboardRoundSelect")?.addEventListener("change", (e) => {
    state.selectedLeaderboardRound = e.target.value;
    renderLeaderboardTab();
  });

  // Outcome Picker buttons inside Prediction Modal
  document.querySelectorAll("#outcomePickerGroup .outcome-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setPickedOutcome(btn.dataset.outcome);
    });
  });

  // Auto-sync outcome when standard score inputs change
  ["predHomeScore", "predAwayScore"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      const h = Number(document.getElementById("predHomeScore").value) || 0;
      const a = Number(document.getElementById("predAwayScore").value) || 0;
      setPickedOutcome(getOutcomeFromScores(h, a));
    });
  });

  // Auto-sync GAA total when goals/points change
  ["predHomeGoals", "predHomePoints", "predAwayGoals", "predAwayPoints"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateGaaLivePreview);
  });

  // Submit Prediction Form
  document.getElementById("predictionForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const game = state.games.find((g) => g.id === state.activePredictGameId);
    if (!game || !state.user) return;

    if (isGameLocked(game)) {
      showToast("🔒 Sorry, this fixture is now locked!");
      document.getElementById("predictModal").classList.add("hidden");
      return;
    }

    const comp = state.competitions.find((c) => c.id === game.competitionId);
    const sport = getSportById(game.sportId || comp?.sportId);

    let homeGoals = 0;
    let homePoints = 0;
    let awayGoals = 0;
    let awayPoints = 0;
    let homeScore = 0;
    let awayScore = 0;

    if (sport.scoringMode === "gaa") {
      homeGoals = Number(document.getElementById("predHomeGoals").value) || 0;
      homePoints = Number(document.getElementById("predHomePoints").value) || 0;
      awayGoals = Number(document.getElementById("predAwayGoals").value) || 0;
      awayPoints = Number(document.getElementById("predAwayPoints").value) || 0;
      homeScore = computeGaaTotal(homeGoals, homePoints);
      awayScore = computeGaaTotal(awayGoals, awayPoints);
    } else {
      homeScore = Number(document.getElementById("predHomeScore").value) || 0;
      awayScore = Number(document.getElementById("predAwayScore").value) || 0;
    }

    const predId = `${game.id}__${state.user.uid}`;
    const predPayload = {
      id: predId,
      gameId: game.id,
      competitionId: game.competitionId,
      requiresApproval: Boolean(comp?.requiresApproval),
      userId: state.user.uid,
      userName: state.user.displayName,
      pickedOutcome: state.pickedOutcomeInModal,
      homeGoals,
      homePoints,
      homeScore,
      awayGoals,
      awayPoints,
      awayScore,
      updatedAt: new Date().toISOString()
    };

    const idx = state.predictions.findIndex((p) => p.id === predId);
    if (idx >= 0) {
      state.predictions[idx] = predPayload;
    } else {
      state.predictions.push(predPayload);
    }
    saveToLocalStorage();

    if (state.firebaseReady && state.fbDb && state.user.isCloud) {
      try {
        const { doc, setDoc } = state.fbModules;
        await setDoc(doc(state.fbDb, "predictions", predId), predPayload);
      } catch (err) {
        showToast("⚠️ Saved locally (Cloud rule check: " + err.message + ")");
      }
    }

    document.getElementById("predictModal").classList.add("hidden");
    renderAll();
    showToast(`🎯 Prediction locked in for ${game.homeTeam} vs ${game.awayTeam}!`);
  });

  // Admin: Live Internet Auto-Sync Modal & Form
  document.getElementById("btnOpenLiveSyncModal")?.addEventListener("click", () => {
    openLiveSyncModal();
  });

  document.getElementById("liveSyncForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const feedId = document.getElementById("liveFeedSelect").value;
    const targetMode = document.getElementById("liveSyncTargetMode").value;
    await runLiveInternetSync(feedId, targetMode);
  });

  // Admin: Create & Delete Competition Buttons
  document.getElementById("btnOpenNewCompModal").addEventListener("click", () => {
    document.getElementById("newCompModal").classList.remove("hidden");
  });

  document.getElementById("btnHeroDeleteComp")?.addEventListener("click", () => {
    if (state.activeCompetitionId) {
      deleteCompetition(state.activeCompetitionId);
    }
  });

  document.getElementById("btnAdminTopDeleteComp")?.addEventListener("click", () => {
    if (state.activeCompetitionId) {
      deleteCompetition(state.activeCompetitionId);
    }
  });

  document.getElementById("newCompForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newComp = {
      id: "comp-" + Date.now(),
      title: document.getElementById("compTitle").value.trim(),
      sportId: document.getElementById("compSport").value,
      season: document.getElementById("compSeason").value.trim(),
      description: document.getElementById("compDesc").value.trim(),
      requiresApproval: document.getElementById("compApprovalMode").value === "approval",
      resultPts: Number(document.getElementById("compResultPts").value) || 3,
      exactBonusPts: Number(document.getElementById("compExactBonusPts").value) || 3,
      closeBonusPts: Number(document.getElementById("compCloseBonusPts").value) || 2,
      tier1Margin: 7,
      tier2Margin: 14
    };

    state.competitions.unshift(newComp);
    state.activeCompetitionId = newComp.id;
    saveToLocalStorage();

    if (state.firebaseReady && state.isAdmin && state.fbDb) {
      try {
        const { doc, setDoc } = state.fbModules;
        await setDoc(doc(state.fbDb, "competitions", newComp.id), newComp);
      } catch (err) {
        console.warn("Firestore comp save error:", err);
      }
    }

    document.getElementById("newCompModal").classList.add("hidden");
    e.target.reset();
    renderAll();
    showToast(`🏆 Created competition "${newComp.title}"!`);
  });

  // Admin: Add / Edit Fixture & Grade Scores
  document.getElementById("btnOpenNewGameModal").addEventListener("click", () => {
    openGameFormModal(null);
  });
  document.getElementById("btnAdminAddGameInline").addEventListener("click", () => {
    openGameFormModal(null);
  });
  document
    .getElementById("gameCompSelect")
    .addEventListener("change", toggleAdminGameScoreMode);

  document.getElementById("gameForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const compId = document.getElementById("gameCompSelect").value;
    const comp = state.competitions.find((c) => c.id === compId);
    const sport = getSportById(comp?.sportId);

    let homeGoals = 0;
    let homePoints = 0;
    let awayGoals = 0;
    let awayPoints = 0;
    let homeScore = 0;
    let awayScore = 0;

    if (sport.scoringMode === "gaa") {
      homeGoals = Number(document.getElementById("gameHomeGoals").value) || 0;
      homePoints = Number(document.getElementById("gameHomePoints").value) || 0;
      awayGoals = Number(document.getElementById("gameAwayGoals").value) || 0;
      awayPoints = Number(document.getElementById("gameAwayPoints").value) || 0;
      homeScore = computeGaaTotal(homeGoals, homePoints);
      awayScore = computeGaaTotal(awayGoals, awayPoints);
    } else {
      homeScore = Number(document.getElementById("gameHomeScore").value) || 0;
      awayScore = Number(document.getElementById("gameAwayScore").value) || 0;
    }

    const gameId = state.editingGameId || "game-" + Date.now();
    const gameData = {
      id: gameId,
      competitionId: compId,
      sportId: comp?.sportId || "soccer",
      roundName: document.getElementById("gameRound").value.trim(),
      homeTeam: document.getElementById("gameHomeTeam").value.trim(),
      awayTeam: document.getElementById("gameAwayTeam").value.trim(),
      venue: document.getElementById("gameVenue").value.trim(),
      kickoffTime: document.getElementById("gameKickoff").value,
      status: document.getElementById("gameStatus").value,
      homeGoals,
      homePoints,
      homeScore,
      awayGoals,
      awayPoints,
      awayScore
    };

    const existingIdx = state.games.findIndex((g) => g.id === gameId);
    if (existingIdx >= 0) {
      state.games[existingIdx] = gameData;
    } else {
      state.games.push(gameData);
    }
    saveToLocalStorage();

    if (state.firebaseReady && state.isAdmin && state.fbDb) {
      try {
        const { doc, setDoc } = state.fbModules;
        await setDoc(doc(state.fbDb, "games", gameId), gameData);
      } catch (err) {
        console.warn("Firestore game save error:", err);
      }
    }

    document.getElementById("gameFormModal").classList.add("hidden");
    renderAll();
    showToast(
      gameData.status === "completed"
        ? `✅ Final score saved! Leaderboard automatically updated.`
        : `🏟️ Fixture saved!`
    );
  });

  // Admin UID Copy & Verification
  document.getElementById("btnCopyUid").addEventListener("click", () => {
    if (!state.user?.uid) {
      showToast("Sign In first to see your UID!");
      return;
    }
    navigator.clipboard.writeText(state.user.uid);
    showToast("📋 Copied your UID to clipboard!");
  });

  document.getElementById("btnRefreshAdminStatus").addEventListener("click", async () => {
    await checkAdminStatus();
    renderAll();
    showToast(
      state.isAdmin
        ? "🛡️ Admin status verified!"
        : "Not found in /admins/{uid} yet. Add your UID in Firestore Console."
    );
  });

  document.getElementById("btnDemoAdminMode").addEventListener("click", () => {
    state.isAdmin = true;
    renderAll();
    showToast("🧪 Enabled Demo Admin Preview! (Configure /admins/{uid} in Firebase for production)");
  });

  // PDF Export & Leaderboard Sign-In Prompt
  document.getElementById("btnDownloadPdf").addEventListener("click", exportCompetitionPdf);
  document.getElementById("btnPrintLeaderboard").addEventListener("click", exportCompetitionPdf);
  document.getElementById("btnSignInFromLeaderboard")?.addEventListener("click", () => {
    document.getElementById("authModal")?.classList.remove("hidden");
  });

  // Auth Modal
  document.querySelectorAll(".auth-tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((b) => b.classList.remove("active"));
      t.classList.add("active");
      state.authMode = t.dataset.authMode;
      document.getElementById("btnSubmitCredentials").textContent =
        state.authMode === "register" ? "Create Account" : "Sign In";
    });
  });

  document.getElementById("btnGoogleSignIn").addEventListener("click", async () => {
    if (state.firebaseReady && state.fbAuth) {
      try {
        const { GoogleAuthProvider, signInWithPopup } = state.fbModules;
        await signInWithPopup(state.fbAuth, new GoogleAuthProvider());
        document.getElementById("authModal").classList.add("hidden");
        showToast("🎉 Signed in with Google!");
      } catch (err) {
        const errEl = document.getElementById("authErrorMsg");
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    } else {
      state.user = { uid: "local-user", displayName: "Shane (Local)", isCloud: false };
      localStorage.setItem("arenapick_local_user", JSON.stringify(state.user));
      document.getElementById("authModal").classList.add("hidden");
      renderAll();
      showToast("Signed in (Local Mode)");
    }
  });

  document.getElementById("credentialsAuthForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const rawId = document.getElementById("authIdentifier").value.trim();
    const pass = document.getElementById("authPassword").value;
    const email = rawId.includes("@")
      ? rawId
      : `${rawId.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@arenapick.user`;
    const displayName = rawId.includes("@") ? rawId.split("@")[0] : rawId;

    if (state.firebaseReady && state.fbAuth) {
      try {
        const {
          signInWithEmailAndPassword,
          createUserWithEmailAndPassword,
          updateProfile
        } = state.fbModules;
        if (state.authMode === "register") {
          const cred = await createUserWithEmailAndPassword(state.fbAuth, email, pass);
          await updateProfile(cred.user, { displayName });
        } else {
          await signInWithEmailAndPassword(state.fbAuth, email, pass);
        }
        document.getElementById("authModal").classList.add("hidden");
        showToast(`👋 Welcome, ${displayName}!`);
      } catch (err) {
        const errEl = document.getElementById("authErrorMsg");
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    } else {
      state.user = { uid: `local-${displayName}`, displayName, email, isCloud: false };
      localStorage.setItem("arenapick_local_user", JSON.stringify(state.user));
      document.getElementById("authModal").classList.add("hidden");
      renderAll();
      showToast(`👋 Signed in as ${displayName} (Local Mode)`);
    }
  });

  // Firebase Setup Modal
  document.getElementById("btnFirebaseSetup").addEventListener("click", () => {
    const cfg = getActiveFirebaseConfig();
    if (isFirebaseConfigured(cfg)) {
      document.getElementById("fbApiKey").value = cfg.apiKey || "";
      document.getElementById("fbAuthDomain").value = cfg.authDomain || "";
      document.getElementById("fbProjectId").value = cfg.projectId || "";
      document.getElementById("fbAppId").value = cfg.appId || "";
    }
    document.getElementById("firebaseSetupModal").classList.remove("hidden");
  });

  document.getElementById("firebaseConfigForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cfg = {
      apiKey: document.getElementById("fbApiKey").value.trim(),
      authDomain: document.getElementById("fbAuthDomain").value.trim(),
      projectId: document.getElementById("fbProjectId").value.trim(),
      appId: document.getElementById("fbAppId").value.trim()
    };
    localStorage.setItem("sportshub_firebase_config", JSON.stringify(cfg));
    document.getElementById("firebaseSetupModal").classList.add("hidden");
    showToast("🔥 Saved Firebase config! Connecting...");
    await initFirebaseIfConfigured();
  });

  document.getElementById("btnResetFirebaseConfig").addEventListener("click", () => {
    localStorage.removeItem("sportshub_firebase_config");
    document.getElementById("firebaseSetupModal").classList.add("hidden");
    showToast("Switched to Local Mode.");
  });

  // Close Modals
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.closeModal).classList.add("hidden");
    });
  });
}

// ============================================================================
// UTILITIES
// ============================================================================

function formatKickoff(isoStr) {
  if (!isoStr) return "TBA";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return d.toLocaleString("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function showToast(msg) {
  const container = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
