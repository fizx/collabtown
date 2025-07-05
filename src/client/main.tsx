import {
  mount,
  TileConfig,
  TilemapState,
  TilemapAction,
  EditorActions,
} from "tilarium";
import "tilarium/dist/TilemapEditor.css";
import "./style.css";

const deltaQueue: TilemapAction[] = [];
let debounceTimer: number | null = null;

function sendDeltas() {
  if (deltaQueue.length === 0) {
    return;
  }

  const deltas = [...deltaQueue];
  deltaQueue.length = 0;

  fetch("/api/deltas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deltas),
  });
}

async function main() {
  const [config, initialState] = await Promise.all([
    fetch("/town.json").then((res) => res.json()),
    fetch("/api/init").then((res) => res.json()),
  ]);

  mount("#root", {
    config,
    initialState,
    onStateChange: (state, delta) => {
      deltaQueue.push(delta);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(sendDeltas, 1000);
    },
  });
}

main();
