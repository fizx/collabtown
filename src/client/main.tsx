import { mount, TileConfig, TilemapState } from "tilarium";
import "tilarium/dist/TilemapEditor.css";
import "./style.css";

let config: TileConfig | null = null;
let initialState: TilemapState | null = null;

const render = () => {
  if (config && initialState) {
    mount("#root", {
      config,
      initialState,
      onStateChange: (state) => {
        // Here you would save the state to your backend
        console.log("state changed", state);
      },
    });
  }
};

fetch("/town.json")
  .then((res) => res.json())
  .then((data) => {
    config = data;
    render();
  });

fetch("http://localhost:3000/tilemap.json")
  .then((res) => res.json())
  .then((data) => {
    initialState = data;
    render();
  })
  .catch(() => {
    // If the tilemap doesn't exist, we can start with an empty state.
    initialState = {
      placedTiles: [],
      tileToReplace: null,
      backgroundTileId: null,
    };
    render();
  });
