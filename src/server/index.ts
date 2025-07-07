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

export type TilemapDelta = {
  [key: string]: string | null;
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

const getTilemapKey = (postId: string) => `tilemap:${postId}:v2`;
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
    redis.hGetAll(key),
    redis.get(deltaCounterKey),
  ]);

  const placedTiles: PlacedTile[] = [];
  if (tilemapData) {
    for (const compositeKey in tilemapData) {
      const tileId = tilemapData[compositeKey];
      const [x, y] = compositeKey.split("-").map(Number);
      if (!isNaN(x) && !isNaN(y) && tileId) {
        placedTiles.push({
          x,
          y,
          tileId,
          source: "initial",
        });
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
        let delta = JSON.parse(item.member);

        // Check for old format and convert if necessary to prevent crashes
        if (delta.added && delta.removed) {
          const newDelta: TilemapDelta = {};
          for (const tile of delta.added) {
            const tileDef = tileConfig.tiles[tile.tileId];
            if (tileDef) {
              const key = `${tile.x}-${tile.y}-${tileDef.zIndex}`;
              newDelta[key] = tile.tileId;
            }
          }
          for (const tile of delta.removed) {
            const tileDef = tileConfig.tiles[tile.tileId];
            if (tileDef) {
              const key = `${tile.x}-${tile.y}-${tileDef.zIndex}`;
              newDelta[key] = null;
            }
          }
          delta = newDelta;
        }

        return {
          id: item.score,
          delta,
        };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean) as { id: number; delta: TilemapDelta }[];

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

  const delta = req.body as TilemapDelta;
  console.log(`[server] Received delta for ${postId}:`, JSON.stringify(delta));
  const key = getTilemapKey(postId);
  const deltaKey = getDeltaLogKey(postId);
  const deltaCounterKey = getDeltaCounterKey(postId);

  const tilesToAdd: { [key: string]: string } = {};
  const tilesToRemove: string[] = [];

  for (const compositeKey in delta) {
    const coords = compositeKey.split("-").map(Number);
    if (
      coords.length === 3 &&
      !isNaN(coords[0]) &&
      !isNaN(coords[1]) &&
      !isNaN(coords[2])
    ) {
      const tileId = delta[compositeKey];
      if (tileId === null) {
        tilesToRemove.push(compositeKey);
      } else {
        tilesToAdd[compositeKey] = tileId;
      }
    }
  }

  if (Object.keys(tilesToAdd).length > 0) {
    await redis.hSet(key, tilesToAdd);
  }
  if (tilesToRemove.length > 0) {
    await redis.hDel(key, tilesToRemove);
  }

  if (Object.keys(delta).length > 0) {
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
