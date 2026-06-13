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
