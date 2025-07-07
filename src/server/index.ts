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

export type PlacedTilesDelta = {
  added: PlacedTile[];
  removed: { x: number; y: number; tileId: string }[];
};

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
const getDeltaCounterKey = (postId: string) => `delta:id:${postId}`;

app.get("/api/init", async (req, res): Promise<any> => {
  const currentContext = context;
  if (!currentContext || !currentContext.postId) {
    return res.status(400).send("Missing context or postId");
  }
  const { postId } = currentContext;

  const key = getTilemapKey(postId);
  const deltaCounterKey = getDeltaCounterKey(postId);

  const [tilemapData, lastDeltaIdStr] = await Promise.all([
    redis.get(key),
    redis.get(deltaCounterKey),
  ]);

  let finalTilemapData = tilemapData;

  if (!finalTilemapData) {
    if (!tileConfig.mapSize || tileConfig.mapSize === "infinite") {
      return res.status(500).send("Invalid map size");
    }
    const { width, height } = tileConfig.mapSize;
    const size = width * height * NUM_LAYERS;
    const emptyBuffer = Buffer.alloc(size);
    await redis.set(key, emptyBuffer.toString("binary"));
    finalTilemapData = emptyBuffer.toString("binary");
  }

  const placedTiles: PlacedTile[] = [];
  const { width, height } = tileConfig.mapSize as {
    width: number;
    height: number;
  };
  const buffer = Buffer.from(finalTilemapData, "binary");
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < NUM_LAYERS; z++) {
        const offset = (y * width + x) * NUM_LAYERS + z;
        const numericId = buffer.readUInt8(offset);
        if (numericId !== 0) {
          const tileInfo = numericIdToTileId.get(numericId);
          if (tileInfo) {
            placedTiles.push({
              x,
              y,
              tileId: tileInfo.id,
              source: "initial",
            });
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
    lastDeltaId: lastDeltaIdStr ? parseInt(lastDeltaIdStr, 10) : 0,
  });
});

app.get("/api/deltas", async (req, res): Promise<any> => {
  const currentContext = context;
  if (!currentContext || !currentContext.postId) {
    return res.status(400).send("Missing context or postId");
  }
  const { postId } = currentContext;
  const since = parseInt(req.query.since as string, 10) || 0;

  const results = await redis.zRange(
    getDeltaLogKey(postId),
    `(${since}`,
    "+inf",
    { by: "score" }
  );

  const deltas = results
    .map((item) => {
      try {
        return {
          id: item.score,
          delta: JSON.parse(item.member),
        };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean) as { id: number; delta: PlacedTilesDelta }[];

  res.json({
    deltas,
    timestamp: Date.now(),
  });
});

app.post("/api/deltas", async (req, res): Promise<any> => {
  const currentContext = context;
  if (!currentContext || !currentContext.postId) {
    return res.status(400).send("Missing context or postId");
  }
  const { postId } = currentContext;

  const delta = req.body as PlacedTilesDelta;
  console.log(`[server] Received delta for ${postId}:`, JSON.stringify(delta));
  const key = getTilemapKey(postId);
  const deltaKey = getDeltaLogKey(postId);
  const deltaCounterKey = getDeltaCounterKey(postId);

  if (!tileConfig.mapSize || tileConfig.mapSize === "infinite") {
    return res.status(500).send("Invalid map size");
  }
  const { width, height } = tileConfig.mapSize;

  const tilemapData = await redis.get(key);
  const buffer = tilemapData
    ? Buffer.from(tilemapData, "binary")
    : Buffer.alloc(width * height * NUM_LAYERS);

  for (const tile of delta.added) {
    const { x, y, tileId } = tile;
    const numericId = tileIdToNumericId.get(tileId);
    const tileDef = tileConfig.tiles[tileId];
    if (numericId && tileDef && typeof tileDef.zIndex === "number") {
      const offset = (y * width + x) * NUM_LAYERS + tileDef.zIndex;
      buffer.writeUInt8(numericId, offset);
    }
  }

  for (const tile of delta.removed) {
    const { x, y, tileId } = tile;
    const tileDef = tileConfig.tiles[tileId];
    if (tileDef && typeof tileDef.zIndex === "number") {
      const offset = (y * width + x) * NUM_LAYERS + tileDef.zIndex;
      buffer.writeUInt8(0, offset);
    }
  }

  await redis.set(key, buffer.toString("binary"));

  if (delta.added.length > 0 || delta.removed.length > 0) {
    const deltaId = await redis.incrBy(deltaCounterKey, 1);
    await redis.zAdd(deltaKey, {
      score: deltaId,
      member: JSON.stringify(delta),
    });
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
