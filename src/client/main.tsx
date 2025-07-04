import {
  mount,
  TileConfig,
  TilemapState,
  TilemapAction,
  EditorActions,
} from "tilarium";
import "tilarium/dist/TilemapEditor.css";
import "./style.css";

let editorActions: EditorActions | null = null;
const deltaQueue: TilemapAction[] = [];
let debounceTimer: number | null = null;
let lastSyncId = 0;

function sendDeltas() {
  if (deltaQueue.length === 0) return;
  const deltas = [...deltaQueue];
  deltaQueue.length = 0;
  fetch("/api/deltas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deltas),
  });
}

async function pollForDeltas() {
  if (!editorActions) return;

  const response = await fetch(`/api/deltas?since=${lastSyncId}`);
  if (response.ok) {
    const data = await response.json();
    if (data.deltas.length > 0) {
      data.deltas.forEach((item: { id: number; delta: TilemapAction }) => {
        editorActions!.applyRemoteDelta(item.delta);
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

  mount("#root", {
    config,
    initialState: initData.state,
    onStateChange: (state, delta) => {
      deltaQueue.push(delta);
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
