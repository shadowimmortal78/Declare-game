"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  createGame,
  playCards,
  drawCard,
  pickupCard,
  endTurn,
  declare,
  publicState,
  advanceRound,
  sitOutPlayer,
  leavePlayer
} = require("./src/game");

const PUBLIC_DIR = path.join(__dirname, "public");
const rooms = new Map();
const streams = new Map();
const roundTimers = new Map();
const ROUND_TRANSITION_MS = 3600;

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function token() {
  return crypto.randomBytes(24).toString("base64url");
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) reject(new Error("Request is too large."));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function cleanName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 20) throw new Error("Names must be 1-20 characters.");
  return name;
}

function getSession(code, sessionToken) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) throw new Error("Room not found.");
  const player = room.players.find((item) => item.token === sessionToken);
  if (!player) throw new Error("Your room session is invalid.");
  return { room, player };
}

function roomState(room, player) {
  if (room.game) {
    return {
      roomCode: room.code,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      game: publicState(room.game, player.id)
    };
  }
  return {
    roomCode: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    game: null,
    lobby: {
      players: room.players.map(({ id, name }) => ({ id, name })),
      pointLimit: room.pointLimit,
      reentryEnabled: room.reentryEnabled
    },
    viewerId: player.id
  };
}

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(room) {
  const listeners = streams.get(room.code);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      sendEvent(listener.res, "state", roomState(room, listener.player));
    } catch {
      listeners.delete(listener);
    }
  }
}

function scheduleRoundAdvance(room) {
  if (!room.game || room.game.phase !== "round-end" || room.game.status === "finished") return;
  clearTimeout(roundTimers.get(room.code));
  const timer = setTimeout(() => {
    roundTimers.delete(room.code);
    if (advanceRound(room.game)) broadcast(room);
  }, ROUND_TRANSITION_MS);
  roundTimers.set(room.code, timer);
}

function performAction(room, player, action, payload) {
  if (!room.game) throw new Error("The game has not started.");
  switch (action) {
    case "play":
      playCards(room.game, player.id, payload.cardIds);
      break;
    case "draw":
      drawCard(room.game, player.id);
      break;
    case "pickup":
      pickupCard(room.game, player.id, payload.cardId);
      break;
    case "end-turn":
      endTurn(room.game, player.id);
      break;
    case "declare":
      declare(room.game, player.id);
      break;
    default:
      throw new Error("Unknown game action.");
  }
  scheduleRoundAdvance(room);
}

function quitPlayer(room, player) {
  if (!room.game) throw new Error("The game has not started.");
  const gamePlayer = room.game.players.find((item) => item.id === player.id);
  if (!gamePlayer) throw new Error("Player not found.");

  if (!gamePlayer.sittingOut) {
    sitOutPlayer(room.game, player.id);
    scheduleRoundAdvance(room);
    return { leftRoom: false };
  }

  leavePlayer(room.game, player.id);
  room.players = room.players.filter((item) => item.id !== player.id);
  if (room.hostId === player.id) room.hostId = room.players[0]?.id || null;
  return { leftRoom: true };
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (req.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJson(req);
      const player = { id: token(), token: token(), name: cleanName(body.name) };
      const room = {
        code: randomCode(),
        hostId: player.id,
        maxPlayers: Math.min(6, Math.max(2, Number(body.maxPlayers) || 4)),
        pointLimit: Math.min(200, Math.max(50, Number(body.pointLimit) || 100)),
        reentryEnabled: body.reentryEnabled !== false,
        players: [player],
        game: null
      };
      rooms.set(room.code, room);
      return json(res, 201, { roomCode: room.code, token: player.token, playerId: player.id });
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "join") {
      const room = rooms.get(String(parts[2] || "").toUpperCase());
      if (!room) throw new Error("Room not found.");
      if (room.game) throw new Error("This game has already started.");
      if (room.players.length >= room.maxPlayers) throw new Error("This room is full.");
      const body = await readJson(req);
      const name = cleanName(body.name);
      if (room.players.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("That name is already in use.");
      }
      const player = { id: token(), token: token(), name };
      room.players.push(player);
      broadcast(room);
      return json(res, 200, { roomCode: room.code, token: player.token, playerId: player.id });
    }

    if (req.method === "GET" && parts[0] === "api" && parts[1] === "rooms" && parts.length === 3) {
      const { room, player } = getSession(parts[2], url.searchParams.get("token"));
      return json(res, 200, roomState(room, player));
    }

    if (req.method === "GET" && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "events") {
      const { room, player } = getSession(parts[2], url.searchParams.get("token"));
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      res.write(": connected\n\n");
      const listener = { res, player };
      if (!streams.has(room.code)) streams.set(room.code, new Set());
      streams.get(room.code).add(listener);
      sendEvent(res, "state", roomState(room, player));
      req.on("close", () => streams.get(room.code)?.delete(listener));
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "start") {
      const body = await readJson(req);
      const { room, player } = getSession(parts[2], body.token);
      if (player.id !== room.hostId) throw new Error("Only the host can start the game.");
      if (room.players.length < 2) throw new Error("At least two players are required.");
      if (room.game) throw new Error("The game has already started.");
      room.game = createGame(room.players, {
        pointLimit: room.pointLimit,
        reentryEnabled: room.reentryEnabled
      });
      broadcast(room);
      return json(res, 200, roomState(room, player));
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "actions") {
      const body = await readJson(req);
      const { room, player } = getSession(parts[2], body.token);
      if (parts[4] === "quit") {
        const result = quitPlayer(room, player);
        broadcast(room);
        return json(res, 200, result);
      }
      performAction(room, player, parts[4], body);
      broadcast(room);
      return json(res, 200, roomState(room, player));
    }

    return json(res, 404, { error: "API route not found." });
  } catch (error) {
    return json(res, 400, { error: error.message || "Request failed." });
  }
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    return json(res, 403, { error: "Forbidden." });
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (pathname !== "/") return serveStatic(res, "/");
      return json(res, 404, { error: "Not found." });
    }
    const extension = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, { "Content-Type": types[extension] || "application/octet-stream" });
    res.end(content);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { status: "ok" });
    }
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
    return serveStatic(res, url.pathname);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, "0.0.0.0", () => {
    console.log(`Declare is running at http://localhost:${port}`);
  });
}

module.exports = { createServer, rooms };
