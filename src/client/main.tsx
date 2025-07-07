import {
  mount,
  TileConfig,
  TilemapState,
  PlacedTilesDelta,
  EditorActions,
  TilemapAction,
  PlacedTile,
} from "tilarium";
import "tilarium/dist/TilemapEditor.css";
import "./style.css";

type PendingChange =
  | { op: "add"; tile: PlacedTile }
  | { op: "remove"; tile: { x: number; y: number; tileId: string } };

let editorActions: EditorActions | null = null;
const pendingChanges = new Map<string, PendingChange>();
let debounceTimer: number | null = null;
let lastSyncId = 0;

function sendDeltas() {
  if (pendingChanges.size === 0) return;

  const changes = new Map(pendingChanges);
  pendingChanges.clear();

  const combinedDelta: PlacedTilesDelta = { added: [], removed: [] };

  for (const change of changes.values()) {
    if (change.op === "add") {
      combinedDelta.added.push(change.tile);
    } else {
      combinedDelta.removed.push(change.tile);
    }
  }

  fetch("/api/deltas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(combinedDelta),
  });
}

async function pollForDeltas() {
  if (!editorActions) return;

  const response = await fetch(`/api/deltas?since=${lastSyncId}`);
  if (response.ok) {
    const data = await response.json();
    if (data.deltas.length > 0) {
      data.deltas.forEach((item: { id: number; delta: any }) => {
        let finalDelta: PlacedTilesDelta | null = null;

        if (
          item.delta &&
          Array.isArray(item.delta.added) &&
          Array.isArray(item.delta.removed)
        ) {
          finalDelta = item.delta;
        } else if (item.delta && item.delta.type) {
          console.warn("Received old delta format, converting.", item.delta);
          const action = item.delta as TilemapAction;
          if (action.type === "ADD_TILE") {
            const { x, y, tileId, source } = action.payload;
            finalDelta = { added: [{ x, y, tileId, source }], removed: [] };
          } else if (action.type === "REMOVE_TILE") {
            const { x, y, tileId } = action.payload;
            finalDelta = { added: [], removed: [{ x, y, tileId }] };
          }
        } else {
          console.error("Received invalid item from /api/deltas", item);
        }

        if (finalDelta) {
          editorActions!.applyRemoteDelta(finalDelta);
        }

        if (item.id > lastSyncId) {
          lastSyncId = item.id;
        }
      });
    }
  }
}

async function main() {
  const [config, initData] = await Promise.all([
    fetch("/town.json").then((res) => res.json()),
    fetch("/api/init").then((res) => res.json()),
  ]);

  if (initData && initData.lastDeltaId) {
    lastSyncId = initData.lastDeltaId;
  }

  mount("#root", {
    config,
    initialState: initData.state,
    onStateChange: (delta) => {
      for (const tile of delta.removed) {
        const tileDef = config.tiles[tile.tileId];
        if (tileDef) {
          const key = `${tile.x}-${tile.y}-${tileDef.zIndex}`;
          pendingChanges.set(key, { op: "remove", tile });
        }
      }
      for (const tile of delta.added) {
        const tileDef = config.tiles[tile.tileId];
        if (tileDef) {
          const key = `${tile.x}-${tile.y}-${tileDef.zIndex}`;
          pendingChanges.set(key, { op: "add", tile });
        }
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(sendDeltas, 1000);
    },
    onReady: (actions) => {
      editorActions = actions;
      setInterval(pollForDeltas, 3000);
    },
  });
}

main();
