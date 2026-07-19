"use strict";

const crypto = require("node:crypto");

const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, index + 1]));
const CARD_POINTS = {
  A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
  8: 8, 9: 9, 10: 10, J: 10, Q: 10, K: 10
};
const TURN_DURATION_MS = 90_000;

function id(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function shuffle(cards, random = Math.random) {
  const result = [...cards];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function createDeck(random = Math.random) {
  const cards = [];
  for (let deck = 0; deck < 2; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ id: id("card"), suit, rank, naturalJoker: false });
      }
    }
    for (let joker = 0; joker < 3; joker += 1) {
      cards.push({ id: id("card"), suit: "joker", rank: "JOKER", naturalJoker: true });
    }
  }
  return shuffle(cards, random);
}

function isJoker(card, wildRank) {
  return card.naturalJoker || card.rank === wildRank;
}

function cardPoints(card, wildRank) {
  return isJoker(card, wildRank) ? 0 : CARD_POINTS[card.rank];
}

function handPoints(hand, wildRank) {
  return hand.reduce((total, card) => total + cardPoints(card, wildRank), 0);
}

function playDescriptors(cards, wildRank) {
  if (!Array.isArray(cards) || cards.length === 0) return [];
  if (cards.length === 1) {
    if (isJoker(cards[0], wildRank)) {
      return RANKS.map((rank) => ({ type: "group", value: RANK_VALUE[rank] }));
    }
    return [{ type: "group", value: RANK_VALUE[cards[0].rank] }];
  }

  const descriptors = [];
  const normal = cards.filter((card) => !isJoker(card, wildRank));
  const normalRanks = new Set(normal.map((card) => card.rank));
  if (normalRanks.size <= 1) {
    if (normalRanks.size === 0) {
      for (let value = 1; value <= 13; value += 1) descriptors.push({ type: "group", value });
    } else {
      descriptors.push({ type: "group", value: RANK_VALUE[normal[0].rank] });
    }
  }

  if (cards.length >= 3 && cards.length <= 4 && normal.length > 0) {
    const suits = new Set(normal.map((card) => card.suit));
    const values = normal.map((card) => RANK_VALUE[card.rank]);
    if (suits.size === 1 && new Set(values).size === values.length) {
      for (let min = 1; min <= 14 - cards.length; min += 1) {
        const max = min + cards.length - 1;
        if (values.every((value) => value >= min && value <= max)) {
          descriptors.push({ type: "sequence", min, max });
        }
      }
    }
  }
  return descriptors;
}

function isValidPlay(cards, wildRank) {
  return playDescriptors(cards, wildRank).length > 0;
}

function descriptorsConnect(previous, current) {
  if (previous.type === "group" && current.type === "group") {
    return previous.value === current.value;
  }
  if (previous.type === "group" && current.type === "sequence") {
    return previous.value === current.min;
  }
  if (previous.type === "sequence" && current.type === "group") {
    return previous.max === current.value;
  }
  return previous.type === "sequence" &&
    current.type === "sequence" &&
    previous.max === current.min;
}

function shouldSkipPickup(previousCards, currentCards, wildRank) {
  const previous = playDescriptors(previousCards, wildRank);
  const current = playDescriptors(currentCards, wildRank);
  return previous.some((left) => current.some((right) => descriptorsConnect(left, right)));
}

function activePlayerIndexes(game) {
  return game.players
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => !player.eliminated && !player.sittingOut && !player.left)
    .map(({ index }) => index);
}

function nextActiveIndex(game, fromIndex) {
  const active = activePlayerIndexes(game);
  if (active.length === 0) return -1;
  let index = fromIndex;
  do {
    index = (index + 1) % game.players.length;
  } while (game.players[index].eliminated || game.players[index].sittingOut || game.players[index].left);
  return index;
}

function selectJokerRank(previousRank, random = Math.random) {
  const choices = previousRank ? RANKS.filter((rank) => rank !== previousRank) : RANKS;
  return choices[Math.floor(random() * choices.length)];
}

function createGame(players, settings = {}, random = Math.random) {
  if (players.length < 2 || players.length > 6) throw new Error("Declare requires 2-6 players.");
  const game = {
    status: "playing",
    round: 0,
    pointLimit: settings.pointLimit || 100,
    reentryEnabled: settings.reentryEnabled !== false,
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      hand: [],
      score: 0,
      eliminated: false,
      reentryUsed: false,
      sittingOut: false,
      left: false,
      connected: true,
      disconnectedUntil: null
    })),
    startingPlayerIndex: 0,
    currentPlayerIndex: 0,
    turnsCompleted: 0,
    turnStartedAt: null,
    turnDurationMs: TURN_DURATION_MS,
    phase: "play",
    deck: [],
    discard: [],
    availablePlay: [],
    pendingPlay: [],
    wildRank: null,
    lastEvent: "",
    lastAction: null,
    actionSequence: 0,
    scoreHistory: [],
    roundStartingScores: {},
    roundResult: null,
    winnerId: null,
    random
  };
  startRound(game);
  return game;
}

function startRound(game, previousEvent = "") {
  game.round += 1;
  game.deck = createDeck(game.random);
  game.discard = [];
  game.availablePlay = [];
  game.pendingPlay = [];
  game.turnsCompleted = 0;
  game.phase = "play";
  game.roundResult = null;

  game.wildRank = selectJokerRank(game.wildRank, game.random);
  for (const player of game.players) {
    player.hand = [];
    if (!player.eliminated && !player.sittingOut && !player.left) {
      for (let count = 0; count < 7; count += 1) player.hand.push(game.deck.pop());
    }
  }
  game.roundStartingScores = Object.fromEntries(game.players.map((player) => [player.id, player.score]));
  game.availablePlay = [game.deck.pop()];
  game.currentPlayerIndex = game.startingPlayerIndex;
  game.turnStartedAt = Date.now();
  const roundEvent = `Round ${game.round} began. ${game.players[game.currentPlayerIndex].name} plays first.`;
  game.lastEvent = previousEvent ? `${previousEvent} ${roundEvent}` : roundEvent;
}

function requireTurn(game, playerId) {
  if (game.status !== "playing") throw new Error("The game is not active.");
  const player = game.players[game.currentPlayerIndex];
  if (player.id !== playerId) throw new Error("It is not your turn.");
  return player;
}

function playCards(game, playerId, cardIds) {
  const player = requireTurn(game, playerId);
  if (game.phase !== "play") throw new Error("You have already played this turn.");
  const uniqueIds = new Set(cardIds);
  if (uniqueIds.size !== cardIds.length || cardIds.length === 0) throw new Error("Choose one or more cards.");
  const cards = cardIds.map((cardId) => player.hand.find((card) => card.id === cardId));
  if (cards.some((card) => !card)) throw new Error("A selected card is not in your hand.");
  if (!isValidPlay(cards, game.wildRank)) throw new Error("Those cards do not form a valid play.");

  const skipPickup = shouldSkipPickup(game.availablePlay, cards, game.wildRank);
  game.pendingPlay = cards;
  player.hand = player.hand.filter((card) => !uniqueIds.has(card.id));
  game.lastEvent = `${player.name} played ${cards.length} card${cards.length === 1 ? "" : "s"}.`;
  recordAction(game, "play", player.id, { cardIds: cards.map((card) => card.id), cards });

  game.phase = skipPickup ? "optional-pickup" : "pickup";
  if (skipPickup) {
    game.lastEvent += " The play connected. They may end their turn or pick up from the previous play.";
  }
}

function recycleDeck(game) {
  if (game.deck.length > 0 || game.discard.length === 0) return;
  game.deck = shuffle(game.discard, game.random);
  game.discard = [];
  game.lastEvent = "The played cards were shuffled into a new draw deck.";
}

function drawCard(game, playerId) {
  const player = requireTurn(game, playerId);
  if (game.phase !== "pickup") throw new Error("You cannot draw now.");
  recycleDeck(game);
  if (game.deck.length === 0) throw new Error("There are no cards available to draw.");
  const card = game.deck.pop();
  player.hand.push(card);
  game.lastEvent = `${player.name} drew from the deck.`;
  recordAction(game, "draw", player.id, { cardIds: [card.id], source: "deck" });
  completeTurn(game);
}

function pickupCard(game, playerId, cardId) {
  const player = requireTurn(game, playerId);
  if (game.phase !== "pickup" && game.phase !== "optional-pickup") {
    throw new Error("You cannot pick up now.");
  }
  const index = game.availablePlay.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error("That card is not available.");
  const [card] = game.availablePlay.splice(index, 1);
  player.hand.push(card);
  game.lastEvent = `${player.name} picked up one card from the previous play.`;
  recordAction(game, "pickup", player.id, { cardIds: [card.id], cards: [card], source: "board" });
  completeTurn(game);
}

function endTurn(game, playerId) {
  requireTurn(game, playerId);
  if (game.phase !== "optional-pickup") {
    throw new Error("You may only end without picking up after a connected play.");
  }
  game.lastEvent = `${game.players[game.currentPlayerIndex].name} ended their turn without picking up.`;
  completeTurn(game);
}

function completeTurn(game) {
  game.discard.push(...game.availablePlay);
  game.availablePlay = game.pendingPlay;
  game.pendingPlay = [];
  game.turnsCompleted += 1;
  game.currentPlayerIndex = nextActiveIndex(game, game.currentPlayerIndex);
  game.phase = "play";
  game.turnStartedAt = Date.now();
  game.lastEvent += ` ${game.players[game.currentPlayerIndex].name}'s turn.`;
}

function recordAction(game, type, playerId, details = {}) {
  game.actionSequence += 1;
  game.lastAction = {
    sequence: game.actionSequence,
    type,
    playerId,
    ...details
  };
}

function canDeclare(game, playerId) {
  const player = game.players[game.currentPlayerIndex];
  return game.status === "playing" &&
    player.id === playerId &&
    game.phase === "play" &&
    game.turnsCompleted >= activePlayerIndexes(game).length &&
    handPoints(player.hand, game.wildRank) <= 15;
}

function declare(game, playerId) {
  const declarer = requireTurn(game, playerId);
  if (!canDeclare(game, playerId)) throw new Error("You cannot declare yet.");
  const declarerIndex = game.currentPlayerIndex;
  const declarerPoints = handPoints(declarer.hand, game.wildRank);
  const challengers = activePlayerIndexes(game)
    .filter((index) => index !== declarerIndex)
    .map((index) => ({ index, points: handPoints(game.players[index].hand, game.wildRank) }))
    .filter(({ points }) => points < declarerPoints)
    .sort((left, right) => {
      if (left.points !== right.points) return left.points - right.points;
      const leftDistance = (left.index - declarerIndex + game.players.length) % game.players.length;
      const rightDistance = (right.index - declarerIndex + game.players.length) % game.players.length;
      return leftDistance - rightDistance;
    });

  if (challengers.length === 0) {
    declarer.score -= 5;
    for (const index of activePlayerIndexes(game)) {
      if (index !== declarerIndex) {
        game.players[index].score += handPoints(game.players[index].hand, game.wildRank);
      }
    }
    game.lastEvent = `${declarer.name} declared successfully with ${declarerPoints} points.`;
    finishRound(game, {
      type: "declare",
      scoresApplied: true,
      winnerIndex: declarerIndex,
      title: `${declarer.name} won the declaration`,
      detail: `Declared with ${declarerPoints} points`
    });
  } else {
    const challengerIndex = challengers[0].index;
    declarer.score += 30;
    game.players[challengerIndex].score -= 3;
    for (const index of activePlayerIndexes(game)) {
      if (index !== declarerIndex && index !== challengerIndex) {
        game.players[index].score += handPoints(game.players[index].hand, game.wildRank);
      }
    }
    game.lastEvent = `${game.players[challengerIndex].name} defeated ${declarer.name}'s declaration.`;
    finishRound(game, {
      type: "challenge",
      scoresApplied: true,
      winnerIndex: challengerIndex,
      title: `${game.players[challengerIndex].name} won the challenge`,
      detail: `${declarer.name} declared with ${declarerPoints} points`
    });
  }
}

function finishRound(game, result) {
  if (!result.scoresApplied) {
    for (const index of activePlayerIndexes(game)) {
      game.players[index].score += handPoints(game.players[index].hand, game.wildRank);
    }
  }

  for (const player of game.players) {
    if (player.eliminated || player.score < game.pointLimit) continue;
    if (game.reentryEnabled && !player.reentryUsed) {
      const others = game.players.filter((other) => !other.eliminated && other.id !== player.id);
      player.score = others.length ? Math.max(...others.map((other) => other.score)) : 0;
      player.reentryUsed = true;
      game.lastEvent += ` ${player.name} used their re-entry.`;
    } else {
      player.eliminated = true;
      game.lastEvent += ` ${player.name} was eliminated.`;
    }
  }

  const active = activePlayerIndexes(game);
  if (active.length <= 1) {
    game.status = "finished";
    game.winnerId = active.length === 1 ? game.players[active[0]].id : null;
    if (active.length === 1) game.lastEvent += ` ${game.players[active[0]].name} wins the game.`;
  }

  const deltas = Object.fromEntries(game.players.map((player) => [
    player.id,
    player.score - (game.roundStartingScores[player.id] ?? 0)
  ]));
  const winner = Number.isInteger(result.winnerIndex) ? game.players[result.winnerIndex] : null;
  const historyEntry = {
    round: game.round,
    type: result.type,
    winnerId: winner?.id || null,
    title: result.title || "Round complete",
    detail: result.detail || "",
    deltas,
    totals: Object.fromEntries(game.players.map((player) => [player.id, player.score]))
  };
  game.scoreHistory.push(historyEntry);
  game.roundResult = historyEntry;
  game.phase = "round-end";
  recordAction(game, "round-end", winner?.id || null, { result: historyEntry });
}

function advanceRound(game) {
  if (game.phase !== "round-end" || game.status === "finished") return false;
  const nextStarter = nextActiveIndex(game, game.startingPlayerIndex);
  if (nextStarter < 0) return false;
  game.startingPlayerIndex = nextStarter;
  startRound(game, game.lastEvent);
  return true;
}

function sitOutPlayer(game, playerId) {
  const playerIndex = game.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) throw new Error("Player not found.");
  const player = game.players[playerIndex];
  if (player.sittingOut || player.left) return;
  player.sittingOut = true;
  player.connected = false;
  player.disconnectedUntil = null;
  player.hand = [];
  game.lastEvent = `${player.name} is sitting out.`;
  recordAction(game, "sit-out", player.id);

  const active = activePlayerIndexes(game);
  if (active.length <= 1) {
    game.status = "finished";
    game.winnerId = active.length === 1 ? game.players[active[0]].id : null;
    game.phase = "round-end";
    return;
  }
  if (game.currentPlayerIndex === playerIndex) {
    game.currentPlayerIndex = nextActiveIndex(game, playerIndex);
    game.phase = "play";
    game.pendingPlay = [];
    game.turnStartedAt = Date.now();
    game.lastEvent += ` ${game.players[game.currentPlayerIndex].name}'s turn.`;
  }
}

function leavePlayer(game, playerId) {
  const player = game.players.find((item) => item.id === playerId);
  if (!player) return;
  player.left = true;
  player.sittingOut = true;
  player.connected = false;
  player.disconnectedUntil = null;
  player.hand = [];
  recordAction(game, "leave", player.id);
}

function publicState(game, viewerId) {
  const viewer = game.players.find((player) => player.id === viewerId);
  return {
    status: game.status,
    round: game.round,
    pointLimit: game.pointLimit,
    reentryEnabled: game.reentryEnabled,
    currentPlayerId: game.players[game.currentPlayerIndex]?.id || null,
    turnStartedAt: game.turnStartedAt,
    turnDurationMs: game.turnDurationMs,
    phase: game.phase,
    wildRank: game.wildRank,
    deckCount: game.deck.length,
    availablePlay: game.pendingPlay.length > 0 && game.players[game.currentPlayerIndex]?.id !== viewerId
      ? game.pendingPlay
      : game.availablePlay,
    pickupOptions: game.players[game.currentPlayerIndex]?.id === viewerId ? game.availablePlay : [],
    lastEvent: game.lastEvent,
    lastAction: game.lastAction,
    scoreHistory: game.scoreHistory,
    roundResult: game.roundResult,
    winnerId: game.winnerId,
    canDeclare: canDeclare(game, viewerId),
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      cardCount: player.hand.length,
      eliminated: player.eliminated,
      reentryUsed: player.reentryUsed,
      sittingOut: player.sittingOut,
      left: player.left,
      connected: player.connected !== false,
      disconnectedUntil: player.disconnectedUntil,
      hand: player.id === viewerId ? player.hand : undefined,
      handPoints: player.id === viewerId ? handPoints(player.hand, game.wildRank) : undefined
    })),
    viewerId: viewer?.id || null
  };
}

module.exports = {
  createGame,
  playCards,
  drawCard,
  pickupCard,
  endTurn,
  declare,
  publicState,
  createDeck,
  isJoker,
  cardPoints,
  handPoints,
  isValidPlay,
  playDescriptors,
  shouldSkipPickup,
  recycleDeck,
  selectJokerRank,
  advanceRound,
  sitOutPlayer,
  leavePlayer
};
