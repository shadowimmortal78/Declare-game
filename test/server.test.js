"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer, rooms } = require("../server");

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  return { status: response.status, body: await response.json() };
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("creates, joins, and starts a private multiplayer room", async (context) => {
  rooms.clear();
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const created = await request(base, "/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name: "Ada", maxPlayers: 4 })
  });
  assert.equal(created.status, 201);

  const joined = await request(base, `/api/rooms/${created.body.roomCode}/join`, {
    method: "POST",
    body: JSON.stringify({ name: "Grace" })
  });
  assert.equal(joined.status, 200);

  const started = await request(base, `/api/rooms/${created.body.roomCode}/start`, {
    method: "POST",
    body: JSON.stringify({ token: created.body.token })
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.game.players.length, 2);
  assert.equal(started.body.game.players[0].hand.length, 7);
  assert.equal(started.body.game.players[1].hand, undefined);
});

test("reports healthy for deployment monitoring", async (context) => {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("quitting first sits a player out and a second press leaves the room", async (context) => {
  rooms.clear();
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const host = await request(base, "/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name: "Host", maxPlayers: 3 })
  });
  const guest = await request(base, `/api/rooms/${host.body.roomCode}/join`, {
    method: "POST",
    body: JSON.stringify({ name: "Guest" })
  });
  await request(base, `/api/rooms/${host.body.roomCode}/join`, {
    method: "POST",
    body: JSON.stringify({ name: "Third" })
  });
  await request(base, `/api/rooms/${host.body.roomCode}/start`, {
    method: "POST",
    body: JSON.stringify({ token: host.body.token })
  });

  const firstQuit = await request(base, `/api/rooms/${host.body.roomCode}/actions/quit`, {
    method: "POST",
    body: JSON.stringify({ token: guest.body.token })
  });
  assert.deepEqual(firstQuit.body, { leftRoom: false });
  assert.equal(
    rooms.get(host.body.roomCode).game.players.find((player) => player.id === guest.body.playerId).sittingOut,
    true
  );

  const secondQuit = await request(base, `/api/rooms/${host.body.roomCode}/actions/quit`, {
    method: "POST",
    body: JSON.stringify({ token: guest.body.token })
  });
  assert.deepEqual(secondQuit.body, { leftRoom: true });
  assert.equal(rooms.get(host.body.roomCode).players.some((player) => player.id === guest.body.playerId), false);
});

test("preserves a disconnected seat for the reconnect grace period", async (context) => {
  rooms.clear();
  const server = createServer({ disconnectGraceMs: 80 }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const host = await request(base, "/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name: "Host", maxPlayers: 3 })
  });
  await request(base, `/api/rooms/${host.body.roomCode}/join`, {
    method: "POST",
    body: JSON.stringify({ name: "Guest" })
  });
  await request(base, `/api/rooms/${host.body.roomCode}/join`, {
    method: "POST",
    body: JSON.stringify({ name: "Third" })
  });
  await request(base, `/api/rooms/${host.body.roomCode}/start`, {
    method: "POST",
    body: JSON.stringify({ token: host.body.token })
  });

  const room = rooms.get(host.body.roomCode);
  const gamePlayer = room.game.players.find((player) => player.id === host.body.playerId);
  const originalHandIds = gamePlayer.hand.map((card) => card.id);
  const eventUrl = `${base}/api/rooms/${host.body.roomCode}/events?token=${host.body.token}`;

  const firstStream = await fetch(eventUrl);
  await firstStream.body.cancel();
  await wait(15);

  assert.equal(gamePlayer.connected, false);
  assert.equal(gamePlayer.sittingOut, false);
  assert.equal(room.game.currentPlayerIndex, 0);
  assert.deepEqual(gamePlayer.hand.map((card) => card.id), originalHandIds);
  assert.ok(gamePlayer.disconnectedUntil > Date.now());

  const reconnectedStream = await fetch(eventUrl);
  await wait(10);
  assert.equal(gamePlayer.connected, true);
  assert.equal(gamePlayer.disconnectedUntil, null);
  assert.equal(gamePlayer.sittingOut, false);
  assert.deepEqual(gamePlayer.hand.map((card) => card.id), originalHandIds);

  await reconnectedStream.body.cancel();
  await wait(100);
  assert.equal(gamePlayer.sittingOut, true);
  assert.equal(gamePlayer.disconnectedUntil, null);
  assert.equal(room.game.currentPlayerIndex, 1);
});
