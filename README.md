# Declare Online

A server-authoritative online multiplayer implementation of Declare for 2-6
players. The game runs in a browser and uses private room codes. No third-party
packages or build step are required.

## Run Locally

Install Node.js 18 or newer, then run:

```bash
npm start
```

Open `http://localhost:3000`. Other players on the same network can join using
the host computer's local IP address and the room code shown in the lobby.

To use a different port:

```bash
PORT=8080 npm start
```

## Test

```bash
npm test
```

## Architecture

- `server.js`: HTTP API, private sessions, room management, and live SSE updates.
- `src/game.js`: authoritative rules, scoring, turn flow, and deck management.
- `public/`: responsive lobby and game-table client.
- `RULES.md`: canonical rules used by the implementation.

Room state is currently stored in memory. Restarting the server closes all
active rooms.

## Deploy

The included `render.yaml` deploys the app as a single Render web service.
Keeping one instance is required while room state remains in memory.
