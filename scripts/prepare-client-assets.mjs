import fs from "fs/promises";
import path from "path";

const CWD = process.cwd();
const TILARIUM_PATH = path.join(CWD, "tilarium");
const CLIENT_PATH = path.join(CWD, "src", "client");
const CLIENT_PUBLIC_PATH = path.join(CLIENT_PATH, "public");

const ASSETS_SOURCE = path.join(TILARIUM_PATH, "example", "public", "assets");
const ASSETS_DEST = path.join(CLIENT_PUBLIC_PATH, "assets");

const DRAGON_SOURCE = path.join(ASSETS_SOURCE, "dragons.png");
const DRAGON_DEST = path.join(ASSETS_DEST, "dragons.png");

const TILESET_SOURCE = path.join(
  TILARIUM_PATH,
  "example",
  "src",
  "tileset-town.json"
);
const TILESET_DEST = path.join(CLIENT_PUBLIC_PATH, "town.json");

async function prepareAssets() {
  try {
    console.log("Preparing client assets...");

    // 1. Copy assets directory
    await fs.mkdir(ASSETS_DEST, { recursive: true });
    await fs.cp(ASSETS_SOURCE, ASSETS_DEST, { recursive: true });
    console.log(`Copied assets from ${ASSETS_SOURCE} to ${ASSETS_DEST}`);

    // 2. Copy dragon image
    await fs.copyFile(DRAGON_SOURCE, DRAGON_DEST);
    console.log(`Copied dragon from ${DRAGON_SOURCE} to ${DRAGON_DEST}`);

    // 3. Copy tileset file
    await fs.copyFile(TILESET_SOURCE, TILESET_DEST);
    console.log(`Copied tileset from ${TILESET_SOURCE} to ${TILESET_DEST}`);

    // 4. Modify tileset file paths to be root-relative
    const tilesetContent = await fs.readFile(TILESET_DEST, "utf-8");
    const tilesetJson = JSON.parse(tilesetContent);

    for (const tileId in tilesetJson.tiles) {
      const tile = tilesetJson.tiles[tileId];
      if (tile.src && !tile.src.startsWith("/")) {
        tile.src = `/${tile.src}`;
      }
    }

    await fs.writeFile(TILESET_DEST, JSON.stringify(tilesetJson, null, 2));
    console.log(`Updated asset paths in ${TILESET_DEST}`);

    console.log("Client assets prepared successfully.");
  } catch (error) {
    console.error("Error preparing client assets:", error);
    process.exit(1);
  }
}

prepareAssets();
