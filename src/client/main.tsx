import {
  mount,
  TileConfig,
  TilemapState,
  TilemapDelta,
  EditorActions,
  TilemapAction,
  PlacedTile,
} from "tilarium";
import "tilarium/dist/TilemapEditor.css";
import "./style.css";

let editorActions: EditorActions | null = null;
let pendingDelta: TilemapDelta = {};
let debounceTimer: number | null = null;
let lastSyncId = 0;

function sendDeltas() {
  if (Object.keys(pendingDelta).length === 0) return;

  const deltaToSend = pendingDelta;
  pendingDelta = {};

  fetch("/api/deltas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deltaToSend),
  });
}

async function pollForDeltas() {
  if (!editorActions) return;

  const response = await fetch(`/api/deltas?since=${lastSyncId}`);
  if (response.ok) {
    const data = await response.json();
    if (data.deltas.length > 0) {
      data.deltas.forEach((item: { id: number; delta: TilemapDelta }) => {
        if (item.delta && typeof item.delta === "object") {
          editorActions!.applyRemoteDelta(item.delta);
        } else {
          console.error("Received invalid item from /api/deltas", item);
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
      Object.assign(pendingDelta, delta);

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
