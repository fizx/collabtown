import express from "express";
import { createServer, context, getServerPort } from "@devvit/server";
import { redis } from "@devvit/redis";
import { realtime, RealtimeClient } from "@devvit/realtime";
import {
  TileConfig,
  TilemapState,
  PlacedTile,
  TilemapAction,
} from "tilarium/dist/index";
import townConfigJSON from "../client/public/town.json";

const app = express();
app.use(express.json());

let tileConfig: TileConfig;
let tileIdToNumericId: Map<string, number>;
let numericIdToTileId: Map<number, { id: string; zIndex: number }>;

function initializeTileConfig() {
  tileConfig = townConfigJSON as TileConfig;

  tileIdToNumericId = new Map();
  numericIdToTileId = new Map();
  let numericId = 1; // 0 is reserved for empty
  for (const tileId in tileConfig.tiles) {
    const tile = tileConfig.tiles[tileId];
    if (tile) {
      tileIdToNumericId.set(tileId, numericId);
      numericIdToTileId.set(numericId, {
        id: tileId,
        zIndex: tile.zIndex,
      });
      numericId++;
    }
  }
}

const getTilemapKey = (postId: string) => `tilemap:${postId}`;

const getRealtimeChannel = (postId: string) => `tilemap-updates:${postId}`;

app.get("/api/init", async (req, res): Promise<any> => {
  const currentContext = context;
  if (!currentContext) {
    return res.status(400).send("Missing context");
  }
  const { postId } = currentContext;
  if (!postId) {
    return res.status(400).send("Missing postId");
  }

  const key = getTilemapKey(postId);
  const tilemapData = await redis.get(key);

  if (!tilemapData) {
    if (!tileConfig.mapSize || tileConfig.mapSize === "infinite") {
      return res.status(500).send("Invalid map size");
    }
    const { width, height } = tileConfig.mapSize;
    const size = width * height * 2;
    await redis.set(key, Buffer.alloc(size).toString("binary"));
    return res.json({
      placedTiles: [],
      backgroundTileId: null,
      tileToReplace: null,
    } as TilemapState);
  }

  const placedTiles: PlacedTile[] = [];
  const buffer = Buffer.from(tilemapData, "binary");
  if (!tileConfig.mapSize || tileConfig.mapSize === "infinite") {
    return res.status(500).send("Invalid map size");
  }
  const { width } = tileConfig.mapSize;

  for (let i = 0; i < buffer.length; i += 2) {
    const zIndex = buffer[i];
    const numericId = buffer[i + 1];
    if (numericId && numericId !== 0) {
      const tileInfo = numericIdToTileId.get(numericId);
      if (tileInfo) {
        const x = (i / 2) % width;
        const y = Math.floor(i / 2 / width);
        placedTiles.push({ x, y, tileId: tileInfo.id });
      }
    }
  }

  res.json({
    placedTiles,
    backgroundTileId: null,
    tileToReplace: null,
  } as TilemapState);
});

app.post("/api/deltas", async (req, res): Promise<any> => {
  const currentContext = context;
  if (!currentContext) {
    return res.status(400).send("Missing context");
  }
  const { postId } = currentContext;
  if (!postId) {
    return res.status(400).send("Missing postId");
  }

  const deltas = req.body as TilemapAction[];
  const key = getTilemapKey(postId);
  if (!tileConfig.mapSize || tileConfig.mapSize === "infinite") {
    return res.status(500).send("Invalid map size");
  }
  const { width } = tileConfig.mapSize;

  for (const delta of deltas) {
    if (delta.type === "ADD_TILE") {
      const { x, y, tileId } = delta.payload;
      const numericId = tileIdToNumericId.get(tileId);
      const tile = tileConfig.tiles[tileId];
      if (numericId && tile && typeof tile.zIndex === "number") {
        const offset = (y * width + x) * 2;
        const data = Buffer.from([tile.zIndex, numericId]);
        await redis.setRange(key, offset, data.toString("binary"));
      }
    } else if (delta.type === "REMOVE_TILE") {
      const { x, y } = delta.payload;
      const offset = (y * width + x) * 2;
      const data = Buffer.alloc(2);
      await redis.setRange(key, offset, data.toString("binary"));
    }
  }

  await (realtime as RealtimeClient).send(
    getRealtimeChannel(postId),
    deltas as any
  );

  res.status(200).send("OK");
});

async function startServer() {
  initializeTileConfig();
  const port = getServerPort();
  const server = createServer(app);
  server.on("error", (err) => console.error(`server error; ${err.stack}`));
  server.listen(port, () => console.log(`http://localhost:${port}`));
}

startServer();
