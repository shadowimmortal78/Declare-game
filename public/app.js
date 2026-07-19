"use strict";

const state = {
  roomCode: null,
  token: null,
  playerId: null,
  data: null,
  selectedCards: new Set(),
  events: null,
  lastActionSequence: 0,
  scoreOpen: false,
  reconnectTicker: null,
  turnTicker: null,
  boardDisplay: [],
  boardRevealTimer: null,
  feedbackEnabled: localStorage.getItem("declare-feedback-enabled") !== "false",
  audioContext: null,
  hasReceivedState: false
};

const $ = (selector) => document.querySelector(selector);
const screens = ["#homeScreen", "#lobbyScreen", "#gameScreen"];
const suitSymbols = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠", joker: "★" };

function showScreen(selector) {
  for (const screen of screens) $(screen).classList.toggle("hidden", screen !== selector);
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("visible"), 2800);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

function saveSession() {
  localStorage.setItem("declare-session", JSON.stringify({
    roomCode: state.roomCode,
    token: state.token,
    playerId: state.playerId
  }));
}

function clearSession() {
  localStorage.removeItem("declare-session");
}

function connect() {
  state.events?.close();
  state.events = new EventSource(`/api/rooms/${state.roomCode}/events?token=${encodeURIComponent(state.token)}`);
  state.events.addEventListener("state", (event) => {
    const nextData = JSON.parse(event.data);
    const previousData = state.data;
    const isRematch = previousData?.game?.status === "finished"
      && nextData.game?.status === "playing"
      && nextData.game.round === 1;
    if (isRematch) {
      state.selectedCards.clear();
      state.lastActionSequence = 0;
    }
    const action = nextData.game?.lastAction;
    const isNewAction = state.hasReceivedState && action && action.sequence > state.lastActionSequence;
    const revealAfterAnimation = isNewAction &&
      action.type === "play" &&
      action.playerId !== nextData.game?.viewerId;
    const nextBoardDisplay = nextData.game?.availablePlay || [];
    clearTimeout(state.boardRevealTimer);
    if (!revealAfterAnimation) state.boardDisplay = nextBoardDisplay;
    state.data = nextData;
    render();
    if (action) state.lastActionSequence = Math.max(state.lastActionSequence, action.sequence);
    if (isNewAction) {
      requestAnimationFrame(() => animateAction(action));
      playActionFeedback(action);
    }
    if (revealAfterAnimation) {
      state.boardRevealTimer = setTimeout(() => {
        state.boardDisplay = nextBoardDisplay;
        renderBoard(state.data.game);
      }, 700);
    }
    if (state.hasReceivedState && previousData?.game?.currentPlayerId !== nextData.game?.currentPlayerId) {
      playTurnFeedback(nextData.game?.currentPlayerId === nextData.game?.viewerId);
    }
    state.hasReceivedState = true;
  });
  state.events.onerror = () => {
    $("#eventMessage")?.classList.add("connection-warning");
  };
}

async function enterRoom(session) {
  state.roomCode = session.roomCode;
  state.token = session.token;
  state.playerId = session.playerId;
  saveSession();
  connect();
}

function render() {
  if (!state.data) return;
  if (!state.data.game) renderLobby();
  else renderGame();
}

function renderLobby() {
  showScreen("#lobbyScreen");
  const { lobby, hostId, viewerId, roomCode, maxPlayers } = state.data;
  $("#roomCode").textContent = roomCode;
  $("#lobbyPlayers").innerHTML = lobby.players.map((player, index) => `
    <div class="lobby-player">
      <span>${index + 1}</span>
      <strong>${escapeHtml(player.name)}</strong>
      ${player.id === hostId ? "<small>Host</small>" : ""}
    </div>
  `).join("") + Array.from({ length: maxPlayers - lobby.players.length }, () => `
    <div class="lobby-player empty"><span>+</span><strong>Open seat</strong></div>
  `).join("");
  $("#lobbySettings").textContent = `${lobby.pointLimit} point limit · ${lobby.reentryEnabled ? "Re-entry on" : "No re-entry"}`;
  const isHost = viewerId === hostId;
  $("#startButton").classList.toggle("hidden", !isHost);
  $("#startButton").disabled = lobby.players.length < 2;
  $("#waitingText").classList.toggle("hidden", isHost);
}

function cardHtml(card, options = {}) {
  const red = card.suit === "hearts" || card.suit === "diamonds";
  const wild = card.naturalJoker || card.rank === state.data?.game?.wildRank;
  const selected = state.selectedCards.has(card.id);
  return `
    <button class="playing-card ${red ? "red" : ""} ${wild ? "wild" : ""} ${selected ? "selected" : ""} ${options.pickable ? "pickable" : ""}"
      data-card-id="${card.id}" ${options.disabled ? "disabled" : ""}>
      <span class="corner">${card.naturalJoker ? "★" : card.rank}<i>${suitSymbols[card.suit]}</i></span>
      <span class="center-suit">${suitSymbols[card.suit]}</span>
      ${wild ? '<small class="wild-label">JOKER</small>' : ""}
    </button>`;
}

function renderGame() {
  showScreen("#gameScreen");
  const game = state.data.game;
  const me = game.players.find((player) => player.id === game.viewerId);
  const myTurn = game.currentPlayerId === game.viewerId && game.status === "playing";
  const current = game.players.find((player) => player.id === game.currentPlayerId);

  $("#gameRoomCode").textContent = state.data.roomCode;
  $("#roundNumber").textContent = game.round;
  $("#wildRank").textContent = game.wildRank;
  $("#deckCount").textContent = game.deckCount;
  $("#eventMessage").textContent = game.lastEvent;
  $("#eventMessage").classList.remove("connection-warning");

  renderSeats(game);
  startReconnectTicker();
  startTurnTicker();
  renderScoreTable(game);
  renderRoundResult(game);
  renderRematch(game);

  const canPickup = myTurn && (game.phase === "pickup" || game.phase === "optional-pickup");
  const canDraw = myTurn && game.phase === "pickup";
  renderBoard(game, canPickup);

  $("#handPoints").textContent = me.handPoints;
  $("#handCards").innerHTML = me.hand.map((card) => cardHtml(card, {
    disabled: !myTurn || game.phase !== "play"
  })).join("");
  $("#handCards").querySelectorAll(".playing-card").forEach((element) => {
    element.addEventListener("click", () => {
      const cardId = element.dataset.cardId;
      if (state.selectedCards.has(cardId)) state.selectedCards.delete(cardId);
      else state.selectedCards.add(cardId);
      renderGame();
    });
  });

  if (game.status === "finished") {
    const winner = game.players.find((player) => player.id === game.winnerId);
    $("#turnPrompt").textContent = winner ? `${winner.name} wins the game` : "Game over";
  } else {
    $("#turnPrompt").textContent = myTurn ? phasePrompt(game.phase) : `Waiting for ${current.name}`;
  }
  $("#selectionHint").textContent = state.selectedCards.size
    ? `${state.selectedCards.size} card${state.selectedCards.size === 1 ? "" : "s"} selected`
    : "Select cards to play";

  $("#drawButton").disabled = !canDraw;
  $("#declareButton").classList.toggle("hidden", !game.canDeclare);
  $("#playButton").classList.toggle("hidden", !myTurn || game.phase !== "play");
  $("#playButton").disabled = state.selectedCards.size === 0;
  $("#endTurnButton").classList.toggle("hidden", !myTurn || game.phase !== "optional-pickup");
  $("#quitButton").textContent = me.sittingOut ? "Leave room" : "Quit";
  $("#quitButton").classList.toggle("leave-ready", me.sittingOut);
  renderFeedbackButton();
}

function renderBoard(game, canPickup = game.currentPlayerId === game.viewerId &&
  (game.phase === "pickup" || game.phase === "optional-pickup")) {
  const cards = state.boardDisplay || game.availablePlay || [];
  const pickupIds = new Set((game.pickupOptions || []).map((card) => card.id));
  $("#availablePlay").innerHTML = cards.length
    ? cards.map((card) => {
      const pickable = canPickup && pickupIds.has(card.id);
      return cardHtml(card, { pickable, disabled: !pickable });
    }).join("")
    : '<span class="empty-play">No cards remain in this play</span>';
  $("#availablePlay").querySelectorAll(".pickable").forEach((element) => {
    element.addEventListener("click", () => action("pickup", { cardId: element.dataset.cardId }));
  });
}

function renderFeedbackButton() {
  $("#feedbackButton").setAttribute("aria-pressed", String(state.feedbackEnabled));
  $("#feedbackButton").classList.toggle("feedback-muted", !state.feedbackEnabled);
  $("#feedbackIcon").textContent = state.feedbackEnabled ? "♪" : "×";
  $("#feedbackLabel").textContent = state.feedbackEnabled ? "Sound on" : "Muted";
}

function ensureAudioContext() {
  if (!state.feedbackEnabled) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!state.audioContext) state.audioContext = new AudioContextClass();
  if (state.audioContext.state === "suspended") state.audioContext.resume();
  return state.audioContext;
}

function playTone(frequency, duration = 0.08, volume = 0.038, delay = 0, type = "sine") {
  const context = ensureAudioContext();
  if (!context) return;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.min(volume * 1.7, 0.075), start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function vibrate(pattern) {
  if (state.feedbackEnabled && navigator.vibrate) navigator.vibrate(pattern);
}

function playActionFeedback(action) {
  if (!state.feedbackEnabled || !action) return;
  if (action.type === "play") {
    playTone(235, 0.07, 0.018, 0, "triangle");
    playTone(285, 0.06, 0.014, 0.045, "triangle");
    vibrate(12);
    return;
  }
  if (action.type === "pickup" || action.type === "draw") {
    playTone(action.type === "draw" ? 185 : 210, 0.07, 0.015, 0, "sine");
    vibrate(9);
    return;
  }
  if (action.type === "round-end") {
    const resultType = action.result?.type;
    if (resultType === "challenge") {
      playTone(330, 0.11, 0.022, 0, "triangle");
      playTone(220, 0.16, 0.025, 0.09, "triangle");
      vibrate([18, 35, 24]);
    } else {
      playTone(330, 0.1, 0.02, 0, "sine");
      playTone(440, 0.12, 0.022, 0.08, "sine");
      playTone(550, 0.15, 0.024, 0.17, "sine");
      vibrate([14, 30, 14]);
    }
  }
}

function playTurnFeedback(isViewerTurn) {
  if (!state.feedbackEnabled) return;
  if (isViewerTurn) {
    playTone(420, 0.08, 0.018, 0.1, "sine");
    playTone(560, 0.11, 0.019, 0.17, "sine");
    vibrate([12, 26, 12]);
  } else {
    playTone(300, 0.055, 0.01, 0.08, "sine");
  }
}

function toggleFeedback() {
  state.feedbackEnabled = !state.feedbackEnabled;
  localStorage.setItem("declare-feedback-enabled", String(state.feedbackEnabled));
  if (state.feedbackEnabled) {
    ensureAudioContext();
    playTone(430, 0.07, 0.016);
    vibrate(8);
  }
  renderFeedbackButton();
}

function startReconnectTicker() {
  const hasReconnect = state.data?.game?.players.some((player) => player.disconnectedUntil);
  if (!hasReconnect) {
    clearInterval(state.reconnectTicker);
    state.reconnectTicker = null;
    return;
  }
  if (state.reconnectTicker) return;
  state.reconnectTicker = setInterval(() => {
    if (!state.data?.game) return;
    renderSeats(state.data.game);
  }, 1000);
}

function startTurnTicker() {
  if (state.turnTicker) return;
  state.turnTicker = setInterval(() => {
    const game = state.data?.game;
    if (!game || game.status !== "playing" || game.phase === "round-end") return;
    updateTurnTimers(game);
  }, 250);
}

function updateTurnTimers(game) {
  const duration = game.turnDurationMs || 90_000;
  const remaining = Math.max(0, duration - (Date.now() - game.turnStartedAt));
  const ratio = Math.max(0, Math.min(1, remaining / duration));
  document.querySelectorAll(".table-seat").forEach((seat) => {
    const active = seat.dataset.playerId === game.currentPlayerId;
    seat.style.setProperty("--turn-remaining", active ? ratio : 1);
    const timer = seat.querySelector(".turn-timer");
    if (timer) {
      timer.classList.toggle("turn-timer-active", active);
      timer.setAttribute("aria-valuenow", String(Math.ceil(active ? remaining / 1000 : duration / 1000)));
    }
  });
}

function renderSeats(game) {
  const visiblePlayers = game.players.filter((player) => !player.left);
  const viewerIndex = visiblePlayers.findIndex((player) => player.id === game.viewerId);
  const ordered = viewerIndex < 0
    ? visiblePlayers
    : [...visiblePlayers.slice(viewerIndex), ...visiblePlayers.slice(0, viewerIndex)];
  const count = Math.max(ordered.length, 1);
  const compactLayout = window.innerWidth <= 700;
  const horizontalRadius = window.innerWidth <= 480 ? 30 : compactLayout ? 35 : 42;
  const verticalRadius = compactLayout ? 38 : 41;

  $("#playersAroundTable").innerHTML = ordered.map((player, index) => {
    const angle = 90 + (index * 360 / count);
    const radians = angle * Math.PI / 180;
    const x = 50 + Math.cos(radians) * horizontalRadius;
    const y = 50 + Math.sin(radians) * verticalRadius;
    const isOut = player.eliminated || player.sittingOut;
    const reconnectSeconds = player.disconnectedUntil
      ? Math.max(0, Math.ceil((player.disconnectedUntil - Date.now()) / 1000))
      : null;
    const reconnecting = player.connected === false && reconnectSeconds !== null;
    const stateLabel = player.eliminated
      ? "Out"
      : player.sittingOut
        ? "Sitting out"
        : reconnecting
          ? `Reconnecting ${reconnectSeconds}s`
          : player.id === game.currentPlayerId
            ? "Playing"
            : "Waiting";
    const visualCards = Array.from({ length: player.cardCount }, (_, cardIndex) =>
      `<i style="--card-index:${cardIndex};--card-count:${player.cardCount}"></i>`
    ).join("");
    return `
      <div class="table-seat ${player.id === game.currentPlayerId ? "current-seat" : ""} ${isOut ? "seat-out" : ""} ${reconnecting ? "seat-reconnecting" : ""}"
        data-player-id="${player.id}" style="--seat-x:${x}%;--seat-y:${y}%">
        <div class="seat-card-fan" aria-label="${player.cardCount} cards">${visualCards}</div>
        <div class="seat-avatar">
          ${escapeHtml(player.name.slice(0, 1).toUpperCase())}
          ${player.reentryUsed ? '<span class="reentry-badge" title="Re-entry used">R</span>' : ""}
        </div>
        <div class="seat-details">
          <strong>${escapeHtml(player.name)}${player.id === game.viewerId ? ' <em>YOU</em>' : ""}</strong>
          <span>${stateLabel}</span>
          <div class="turn-timer" role="progressbar" aria-label="Turn time remaining" aria-valuemin="0" aria-valuemax="90" aria-valuenow="90"><i></i></div>
        </div>
      </div>`;
  }).join("");
  updateTurnTimers(game);
}

function renderScoreTable(game) {
  const players = game.players.filter((player) => !player.left);
  if (game.scoreHistory.length === 0) {
    $("#scoreTable").innerHTML = '<p class="empty-ledger">Round totals will appear here after the first round.</p>';
    return;
  }

  const header = players.map((player) => `<th>${escapeHtml(player.name)}</th>`).join("");
  const rows = game.scoreHistory.map((round) => `
    <tr>
      <th>R${round.round}</th>
      ${players.map((player) => {
        const delta = round.deltas[player.id] || 0;
        return `<td class="${delta < 0 ? "score-negative" : delta > 0 ? "score-positive" : ""}">${delta > 0 ? "+" : ""}${delta}</td>`;
      }).join("")}
    </tr>`).join("");
  const totals = players.map((player) => `<td>${player.score}</td>`).join("");
  $("#scoreTable").innerHTML = `
    <table class="score-ledger">
      <thead><tr><th>Round</th>${header}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>Net</th>${totals}</tr></tfoot>
    </table>`;
}

function renderRoundResult(game) {
  const overlay = $("#roundResultOverlay");
  if (game.status === "finished" || game.phase !== "round-end" || !game.roundResult) {
    overlay.classList.add("hidden");
    return;
  }
  const winner = game.players.find((player) => player.id === game.roundResult.winnerId);
  $("#roundResultIcon").textContent = winner?.name.slice(0, 1).toUpperCase() || "D";
  $("#roundResultTitle").textContent = game.roundResult.title;
  $("#roundResultDetail").textContent = game.roundResult.detail || "The round has ended.";
  $("#roundResultScores").innerHTML = game.players
    .filter((player) => !player.left)
    .map((player) => {
      const delta = game.roundResult.deltas[player.id] || 0;
      return `<span><b>${escapeHtml(player.name)}</b><em>${delta > 0 ? "+" : ""}${delta}</em></span>`;
    }).join("");
  overlay.classList.remove("hidden");
}

function renderRematch(game) {
  const overlay = $("#rematchOverlay");
  if (game.status !== "finished") {
    overlay.classList.add("hidden");
    return;
  }

  const wasHidden = overlay.classList.contains("hidden");
  const winner = game.players.find((player) => player.id === game.winnerId);
  const isHost = state.data.hostId === game.viewerId;
  $("#rematchWinnerIcon").textContent = winner?.name.slice(0, 1).toUpperCase() || "D";
  $("#rematchTitle").textContent = winner ? `${winner.name} wins the game` : "Game over";
  $("#rematchDetail").textContent = isHost
    ? "Choose the settings for another game with everyone still in this room."
    : "The host can restart the room with new game settings.";
  $("#rematchForm").classList.toggle("hidden", !isHost);
  $("#rematchWaiting").classList.toggle("hidden", isHost);
  if (wasHidden) {
    $("#rematchPointLimit").value = game.pointLimit;
    $("#rematchReentry").checked = game.reentryEnabled;
    $("#rematchError").textContent = "";
  }
  overlay.classList.remove("hidden");
}

function animateAction(action) {
  if (!action || action.type === "round-end") return;
  const seat = action.playerId
    ? document.querySelector(`[data-player-id="${CSS.escape(action.playerId)}"]`)
    : null;
  const board = $(".board-play");
  const deck = $("#drawButton");
  if (!seat || !board || !deck) return;

  let source = seat;
  let destination = board;
  if (action.type === "pickup") {
    source = board;
    destination = seat;
  } else if (action.type === "draw") {
    source = deck;
    destination = seat;
  } else if (action.type !== "play") {
    return;
  }

  const from = source.getBoundingClientRect();
  const to = destination.getBoundingClientRect();
  const cardCount = Math.min(action.cardIds?.length || 1, 4);
  for (let index = 0; index < cardCount; index += 1) {
    const card = action.cards?.[index];
    const ghost = document.createElement("div");
    ghost.className = `flying-card ${action.type === "draw" ? "flying-card-back" : ""}`;
    ghost.innerHTML = card ? `<b>${card.naturalJoker ? "★" : card.rank}</b><span>${suitSymbols[card.suit]}</span>` : "";
    ghost.style.setProperty("--from-x", `${from.left + from.width / 2 - 25 + index * 5}px`);
    ghost.style.setProperty("--from-y", `${from.top + from.height / 2 - 35 + index * 3}px`);
    ghost.style.setProperty("--to-x", `${to.left + to.width / 2 - 25 + index * 8}px`);
    ghost.style.setProperty("--to-y", `${to.top + to.height / 2 - 35}px`);
    ghost.style.setProperty("--delay", `${index * 60}ms`);
    document.body.appendChild(ghost);
    ghost.addEventListener("animationend", () => ghost.remove(), { once: true });
  }
}

function phasePrompt(phase) {
  if (phase === "pickup") return "Pick one card or draw";
  if (phase === "optional-pickup") return "End your turn or pick up from the previous play";
  return "Your turn to play";
}

async function action(name, payload = {}) {
  try {
    await api(`/api/rooms/${state.roomCode}/actions/${name}`, {
      method: "POST",
      body: JSON.stringify({ token: state.token, ...payload })
    });
    if (name === "play") {
      state.selectedCards.clear();
      render();
    }
  } catch (error) {
    toast(error.message);
  }
}

function toggleScorePanel(force) {
  state.scoreOpen = typeof force === "boolean" ? force : !state.scoreOpen;
  $("#scorePanel").classList.toggle("hidden", !state.scoreOpen);
  $("#scoreBackdrop").classList.toggle("hidden", !state.scoreOpen);
}

function returnHome() {
  state.events?.close();
  state.events = null;
  state.data = null;
  state.selectedCards.clear();
  state.lastActionSequence = 0;
  state.hasReceivedState = false;
  clearInterval(state.reconnectTicker);
  state.reconnectTicker = null;
  clearInterval(state.turnTicker);
  state.turnTicker = null;
  clearTimeout(state.boardRevealTimer);
  state.boardRevealTimer = null;
  clearSession();
  toggleScorePanel(false);
  showScreen("#homeScreen");
}

async function handleQuit() {
  try {
    const result = await api(`/api/rooms/${state.roomCode}/actions/quit`, {
      method: "POST",
      body: JSON.stringify({ token: state.token })
    });
    if (result.leftRoom) returnHome();
    else toast("You are sitting out. Press Leave room to exit.");
  } catch (error) {
    toast(error.message);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
    $("#createForm").classList.toggle("hidden", tab.dataset.tab !== "create");
    $("#joinForm").classList.toggle("hidden", tab.dataset.tab !== "join");
    $("#homeError").textContent = "";
  });
});

$("#createForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const session = await api("/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        maxPlayers: Number(form.get("maxPlayers")),
        pointLimit: Number(form.get("pointLimit")),
        reentryEnabled: form.get("reentryEnabled") === "on"
      })
    });
    await enterRoom(session);
  } catch (error) {
    $("#homeError").textContent = error.message;
  }
});

$("#joinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const roomCode = String(form.get("roomCode")).trim().toUpperCase();
  try {
    const session = await api(`/api/rooms/${roomCode}/join`, {
      method: "POST",
      body: JSON.stringify({ name: form.get("name") })
    });
    await enterRoom(session);
  } catch (error) {
    $("#homeError").textContent = error.message;
  }
});

$("#startButton").addEventListener("click", async () => {
  try {
    await api(`/api/rooms/${state.roomCode}/start`, {
      method: "POST",
      body: JSON.stringify({ token: state.token })
    });
  } catch (error) {
    toast(error.message);
  }
});

$("#rematchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  $("#rematchError").textContent = "";
  try {
    await api(`/api/rooms/${state.roomCode}/rematch`, {
      method: "POST",
      body: JSON.stringify({
        token: state.token,
        pointLimit: Number(form.get("pointLimit")),
        reentryEnabled: form.get("reentryEnabled") === "on"
      })
    });
  } catch (error) {
    $("#rematchError").textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

$("#copyCode").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.roomCode);
  toast("Room code copied");
});
$("#drawButton").addEventListener("click", () => action("draw"));
$("#playButton").addEventListener("click", () => action("play", { cardIds: [...state.selectedCards] }));
$("#endTurnButton").addEventListener("click", () => action("end-turn"));
$("#declareButton").addEventListener("click", () => action("declare"));
$("#scoreButton").addEventListener("click", () => toggleScorePanel());
$("#feedbackButton").addEventListener("click", toggleFeedback);
$("#closeScorePanel").addEventListener("click", () => toggleScorePanel(false));
$("#scoreBackdrop").addEventListener("click", () => toggleScorePanel(false));
$("#quitButton").addEventListener("click", handleQuit);
$("#rulesButton").addEventListener("click", () => $("#rulesDialog").showModal());
$("#closeRules").addEventListener("click", () => $("#rulesDialog").close());

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    toggleScorePanel();
    return;
  }
  if (event.key === "Enter" && !$("#playButton").classList.contains("hidden") && !$("#playButton").disabled) {
    event.preventDefault();
    $("#playButton").click();
  }
});

window.addEventListener("resize", () => {
  if (state.data?.game) renderGame();
});

document.addEventListener("pointerdown", () => {
  if (state.feedbackEnabled) ensureAudioContext();
}, { once: true });

(async function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem("declare-session"));
    if (!saved?.roomCode || !saved?.token) return;
    const data = await api(`/api/rooms/${saved.roomCode}?token=${encodeURIComponent(saved.token)}`);
    state.roomCode = saved.roomCode;
    state.token = saved.token;
    state.playerId = saved.playerId;
    state.data = data;
    connect();
    render();
  } catch {
    clearSession();
  }
}());
