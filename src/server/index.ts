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
import { v4 as uuidv4 } from "uuid";
import townConfigJSON from "../client/public/town.json";

const app = express();
app.use(express.json());

const MAX_Z_INDEX = 4;
const NUM_LAYERS = MAX_Z_INDEX + 1;

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
const getDeltaLogKey = (postId: string) => `deltalog:${postId}`;

app.get("/api/init", async (req, res): Promise<any> => {
  const currentContext = context;
  if (!currentContext || !currentContext.postId) {
    return res.status(400).send("Missing context or postId");
  }
  const { postId } = currentContext;

  const key = getTilemapKey(postId);
  let tilemapData = await redis.get(key);

  if (!tilemapData) {
    if (!tileConfig.mapSize || tileConfig.mapSize === "infinite") {
      return res.status(500).send("Invalid map size");
    }
    const { width, height } = tileConfig.mapSize;
    const size = width * height * NUM_LAYERS;
    const emptyBuffer = Buffer.alloc(size);
    await redis.set(key, emptyBuffer.toString("binary"));
    tilemapData = emptyBuffer.toString("binary");
  }

  const placedTiles: PlacedTile[] = [];
  const { width, height } = tileConfig.mapSize as {
    width: number;
    height: number;
  };
  const buffer = Buffer.from(tilemapData, "binary");
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < NUM_LAYERS; z++) {
        const offset = (y * width + x) * NUM_LAYERS + z;
        const numericId = buffer.readUInt8(offset);
        if (numericId !== 0) {
          const tileInfo = numericIdToTileId.get(numericId);
          if (tileInfo) {
            placedTiles.push({ x, y, tileId: tileInfo.id });
          }
        }
      }
    }
  }

  res.json({
    state: {
      placedTiles,
      backgroundTileId: null,
      tileToReplace: null,
    },
    timestamp: Date.now(),
  });
});

app.get("/api/deltas", async (req, res): Promise<any> => {
  const currentContext = context;
  if (!currentContext || !currentContext.postId) {
    return res.status(400).send("Missing context or postId");
  }
  const { postId } = currentContext;
  const since = req.query.since as string;

  const deltas = await redis.zRange(
    getDeltaLogKey(postId),
    `(${since}`,
    "+inf",
    { by: "score" }
  );

  res.json({
    deltas: deltas
      .map((item) => {
        const parts = item.member.split(":");
        if (parts.length > 1) {
          return JSON.parse(parts.slice(1).join(":"));
        }
        return null;
      })
      .filter(Boolean),
    timestamp: Date.now(),
  });
});

app.post("/api/deltas", async (req, res): Promise<any> => {
  const currentContext = context;
  if (!currentContext || !currentContext.postId) {
    return res.status(400).send("Missing context or postId");
  }
  const { postId } = currentContext;

  const deltas = req.body as TilemapAction[];
  const key = getTilemapKey(postId);
  const deltaKey = getDeltaLogKey(postId);

  if (!tileConfig.mapSize || tileConfig.mapSize === "infinite") {
    return res.status(500).send("Invalid map size");
  }
  const { width, height } = tileConfig.mapSize;

  const tilemapData = await redis.get(key);
  const buffer = tilemapData
    ? Buffer.from(tilemapData, "binary")
    : Buffer.alloc(width * height * NUM_LAYERS);

  for (const delta of deltas) {
    if (delta.type === "ADD_TILE") {
      const { x, y, tileId } = delta.payload;
      const numericId = tileIdToNumericId.get(tileId);
      const tile = tileConfig.tiles[tileId];
      if (numericId && tile && typeof tile.zIndex === "number") {
        const offset = (y * width + x) * NUM_LAYERS + tile.zIndex;
        buffer.writeUInt8(numericId, offset);
      }
    } else if (delta.type === "REMOVE_TILE") {
      const { x, y, tileId } = delta.payload;
      const tile = tileConfig.tiles[tileId];
      if (tile && typeof tile.zIndex === "number") {
        const offset = (y * width + x) * NUM_LAYERS + tile.zIndex;
        buffer.writeUInt8(0, offset);
      }
    }
  }

  await redis.set(key, buffer.toString("binary"));

  if (deltas.length > 0) {
    const timestamp = Date.now();
    const members = deltas.map((delta) => ({
      score: timestamp,
      member: `${uuidv4()}:${JSON.stringify(delta)}`,
    }));
    await redis.zAdd(deltaKey, ...members);
  }

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
