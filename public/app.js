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
  reconnectTicker: null
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
    const action = nextData.game?.lastAction;
    const shouldAnimate = action && action.sequence > state.lastActionSequence;
    state.data = nextData;
    render();
    if (action) state.lastActionSequence = Math.max(state.lastActionSequence, action.sequence);
    if (shouldAnimate) requestAnimationFrame(() => animateAction(action));
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
  renderScoreTable(game);
  renderRoundResult(game);

  const canPickup = myTurn && (game.phase === "pickup" || game.phase === "optional-pickup");
  const canDraw = myTurn && game.phase === "pickup";
  $("#availablePlay").innerHTML = game.availablePlay.length
    ? game.availablePlay.map((card) => cardHtml(card, { pickable: canPickup, disabled: !canPickup })).join("")
    : '<span class="empty-play">No cards remain in this play</span>';
  $("#availablePlay").querySelectorAll(".pickable").forEach((element) => {
    element.addEventListener("click", () => action("pickup", { cardId: element.dataset.cardId }));
  });

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
          : `${player.cardCount} cards`;
    return `
      <div class="table-seat ${player.id === game.currentPlayerId ? "current-seat" : ""} ${isOut ? "seat-out" : ""} ${reconnecting ? "seat-reconnecting" : ""}"
        data-player-id="${player.id}" style="--seat-x:${x}%;--seat-y:${y}%">
        <div class="seat-avatar">
          ${escapeHtml(player.name.slice(0, 1).toUpperCase())}
          ${player.reentryUsed ? '<span class="reentry-badge" title="Re-entry used">R</span>' : ""}
        </div>
        <div class="seat-details">
          <strong>${escapeHtml(player.name)}${player.id === game.viewerId ? ' <em>YOU</em>' : ""}</strong>
          <span>${stateLabel}</span>
        </div>
        <div class="seat-card-stack" aria-label="${player.cardCount} cards">
          <i></i><i></i><i></i><b>${player.cardCount}</b>
        </div>
      </div>`;
  }).join("");
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
  if (game.phase !== "round-end" || !game.roundResult) {
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
  clearInterval(state.reconnectTicker);
  state.reconnectTicker = null;
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

$("#copyCode").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.roomCode);
  toast("Room code copied");
});
$("#drawButton").addEventListener("click", () => action("draw"));
$("#playButton").addEventListener("click", () => action("play", { cardIds: [...state.selectedCards] }));
$("#endTurnButton").addEventListener("click", () => action("end-turn"));
$("#declareButton").addEventListener("click", () => action("declare"));
$("#scoreButton").addEventListener("click", () => toggleScorePanel());
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
