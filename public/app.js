"use strict";

const state = {
  roomCode: null,
  token: null,
  playerId: null,
  data: null,
  selectedCards: new Set(),
  events: null
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
    state.data = JSON.parse(event.data);
    render();
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

  $("#playersRail").innerHTML = game.players.map((player) => `
    <div class="player-pill ${player.id === game.currentPlayerId ? "active" : ""} ${player.eliminated ? "eliminated" : ""}">
      <span class="avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>
      <span><strong>${escapeHtml(player.name)}</strong><small>${player.score} pts · ${player.cardCount} cards</small></span>
      ${player.reentryUsed ? '<i title="Re-entry used">R</i>' : ""}
    </div>
  `).join("");

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
$("#rulesButton").addEventListener("click", () => $("#rulesDialog").showModal());
$("#closeRules").addEventListener("click", () => $("#rulesDialog").close());

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
