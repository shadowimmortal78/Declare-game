"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createGame,
  playCards,
  drawCard,
  pickupCard,
  endTurn,
  declare,
  createDeck,
  handPoints,
  isValidPlay,
  shouldSkipPickup,
  recycleDeck
} = require("../src/game");

const card = (rank, suit = "hearts", naturalJoker = false) => ({
  id: `${rank}-${suit}-${Math.random()}`,
  rank,
  suit,
  naturalJoker
});

test("deck contains 104 standard cards and 6 natural jokers", () => {
  const deck = createDeck(() => 0.5);
  assert.equal(deck.length, 110);
  assert.equal(deck.filter((item) => item.naturalJoker).length, 6);
});

test("wild cards and natural jokers score zero", () => {
  const hand = [card("K"), card("7", "clubs"), card("JOKER", "joker", true)];
  assert.equal(handPoints(hand, "7"), 10);
});

test("validates groups, sequences, and joker substitutions", () => {
  assert.equal(isValidPlay([card("8"), card("8", "clubs")], "4"), true);
  assert.equal(isValidPlay([card("3"), card("4"), card("5")], "9"), true);
  assert.equal(isValidPlay([card("3"), card("5"), card("9")], "9"), true);
  assert.equal(isValidPlay([card("Q"), card("K"), card("A")], "9"), false);
  assert.equal(isValidPlay([card("2"), card("3", "clubs"), card("4")], "9"), false);
});

test("detects every pickup-skip connection type", () => {
  assert.equal(shouldSkipPickup([card("6")], [card("6", "clubs")], "9"), true);
  assert.equal(shouldSkipPickup([card("3")], [card("3"), card("4"), card("5")], "9"), true);
  assert.equal(shouldSkipPickup([card("3"), card("4"), card("5")], [card("5")], "9"), true);
  assert.equal(
    shouldSkipPickup([card("3"), card("4"), card("5")], [card("5"), card("6"), card("7")], "9"),
    true
  );
});

test("recycles old played cards while preserving the top play", () => {
  const game = {
    deck: [],
    discard: [card("2"), card("3")],
    availablePlay: [card("4")],
    random: () => 0.5,
    lastEvent: ""
  };
  recycleDeck(game);
  assert.equal(game.deck.length, 2);
  assert.equal(game.discard.length, 0);
  assert.equal(game.availablePlay.length, 1);
  assert.equal(game.availablePlay[0].rank, "4");
});

test("keeps the previous play available until pickup completes the turn", () => {
  const game = createGame([
    { id: "one", name: "One" },
    { id: "two", name: "Two" }
  ], {}, () => 0.5);
  const previousCard = card("4", "clubs");
  const playedCard = card("8", "hearts");
  game.availablePlay = [previousCard];
  game.players[0].hand = [playedCard, card("K")];

  playCards(game, "one", [playedCard.id]);

  assert.deepEqual(game.availablePlay, [previousCard]);
  assert.deepEqual(game.pendingPlay, [playedCard]);
  assert.equal(game.phase, "pickup");

  pickupCard(game, "one", previousCard.id);
  assert.equal(game.players[0].hand.some((item) => item.id === previousCard.id), true);
  assert.deepEqual(game.availablePlay, [playedCard]);
  assert.equal(game.pendingPlay.length, 0);
  assert.equal(game.currentPlayerIndex, 1);
  assert.equal(game.phase, "play");
});

test("drawing from the deck ends the turn immediately", () => {
  const game = createGame([
    { id: "one", name: "One" },
    { id: "two", name: "Two" }
  ], {}, () => 0.5);
  const playedCard = card("8");
  game.availablePlay = [card("4")];
  game.players[0].hand = [playedCard, card("K")];

  playCards(game, "one", [playedCard.id]);
  drawCard(game, "one");

  assert.equal(game.currentPlayerIndex, 1);
  assert.equal(game.phase, "play");
  assert.deepEqual(game.availablePlay, [playedCard]);
});

test("a connected play can pick up from the board or end without drawing", () => {
  const pickupGame = createGame([
    { id: "one", name: "One" },
    { id: "two", name: "Two" }
  ], {}, () => 0.5);
  const previousCard = card("6", "clubs");
  const connectedCard = card("6", "hearts");
  pickupGame.availablePlay = [previousCard];
  pickupGame.players[0].hand = [connectedCard, card("K")];

  playCards(pickupGame, "one", [connectedCard.id]);
  assert.equal(pickupGame.phase, "optional-pickup");
  pickupCard(pickupGame, "one", previousCard.id);
  assert.equal(pickupGame.players[0].hand.some((item) => item.id === previousCard.id), true);
  assert.equal(pickupGame.currentPlayerIndex, 1);

  const skipGame = createGame([
    { id: "one", name: "One" },
    { id: "two", name: "Two" }
  ], {}, () => 0.5);
  const skipCard = card("6", "diamonds");
  skipGame.availablePlay = [card("6", "spades")];
  skipGame.players[0].hand = [skipCard, card("Q")];

  playCards(skipGame, "one", [skipCard.id]);
  endTurn(skipGame, "one");
  assert.equal(skipGame.currentPlayerIndex, 1);
  assert.deepEqual(skipGame.availablePlay, [skipCard]);
});

test("the joker rank changes every round", () => {
  const game = createGame([
    { id: "one", name: "One" },
    { id: "two", name: "Two" }
  ], {}, () => 0.5);
  const firstJoker = game.wildRank;
  const finalCard = card("2");
  game.players[0].hand = [finalCard];
  game.players[1].hand = [card("K")];
  game.availablePlay = [card("7")];

  playCards(game, "one", [finalCard.id]);

  assert.equal(game.round, 2);
  assert.notEqual(game.wildRank, firstJoker);
});

test("an empty hand scores zero while opponents score their remaining hands", () => {
  const game = createGame([
    { id: "one", name: "One" },
    { id: "two", name: "Two" }
  ], { pointLimit: 100, reentryEnabled: false }, () => 0.5);
  const winningCard = card("2");
  game.players[0].hand = [winningCard];
  game.players[1].hand = [card("K")];
  game.availablePlay = [card("7")];

  playCards(game, "one", [winningCard.id]);

  assert.equal(game.players[0].score, 0);
  assert.equal(game.players[1].score, 10);
  assert.equal(game.round, 2);
});

test("a successful declaration gives the declarer minus five", () => {
  const game = createGame([
    { id: "one", name: "One" },
    { id: "two", name: "Two" }
  ], {}, () => 0.5);
  game.players[0].hand = [card("5")];
  game.players[1].hand = [card("5", "clubs")];
  game.turnsCompleted = 2;

  declare(game, "one");

  assert.equal(game.players[0].score, -5);
  assert.equal(game.players[1].score, 5);
});

test("the lowest challenger defeats a declaration", () => {
  const game = createGame([
    { id: "one", name: "One" },
    { id: "two", name: "Two" },
    { id: "three", name: "Three" }
  ], {}, () => 0.5);
  game.players[0].hand = [card("10")];
  game.players[1].hand = [card("5")];
  game.players[2].hand = [card("8")];
  game.turnsCompleted = 3;

  declare(game, "one");

  assert.equal(game.players[0].score, 30);
  assert.equal(game.players[1].score, -3);
  assert.equal(game.players[2].score, 8);
});
