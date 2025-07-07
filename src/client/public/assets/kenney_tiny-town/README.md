# Autotiling Conventions for Tiny Town Tileset

This document explains the naming convention used in `tiles.txt` to support autotiling functionality. The convention follows a `group:variant-directions` pattern.

## Pattern Breakdown

`group:variant-directions`

- **`group`**: The primary type of the tile. Tiles will only autotile with other tiles of the same group.

  - _Examples: `grass`, `dirt`, `forest_green`, `wall_stone`_

- **`variant` (optional)**: A cosmetic variation of the tile. This allows for different styles within the same group that can still connect to each other.

  - _Examples: `smooth`, `rough`, `with_flowers`, `alt1`_

- **`directions`**: A suffix indicating the connectivity rules for the tile. It specifies which adjacent sides must contain a tile of the same `group` for this tile to be used. The directions are represented by the letters N, E, S, and W.

## Bitmask Mapping

The direction suffix is based on a 4-bit bitmask system, where each cardinal direction corresponds to a bit:

- **N** (North): `1`
- **E** (East): `2`
- **S** (South): `4`
- **W** (West): `8`

A tile's `directions` suffix is formed by combining the letters for the required neighbors. The rendering engine calculates a mask value by summing the values of the present neighbors and selects the tile with the matching `directions` suffix.

### Example

- `dirt-NE` is used when a dirt tile has neighbors of the `dirt` group to its North and East, but not South or West.
- The calculated mask would be `1 (N) + 2 (E) = 3`.
- The autotiling system will look for a tile named `dirt-NE` (or similar) to place in that location.
- A tile with no suffix or a suffix like `SWEN` (e.g., `dirt-SWEN`) represents the "full" or "center" tile, used when it is surrounded on all four sides by tiles of the same group. The mask value is `1+2+4+8 = 15`.

## Special Cases

- **Multi-tile objects**: Some objects, like `well-N` and `well-S`, are meant to be placed together as a pair.
- **Directional-only tiles**: Some tiles like fences (`fence-EW`, `fence-SN`) only connect horizontally or vertically.
- **Single tiles**: Tiles with no direction suffix (e.g., `mushrooms`, `beehive`) are standalone objects and do not participate in autotiling.

## Fallback Behavior

If the autotiling system calculates a bitmask for which there is no corresponding tile (e.g., a `dirt-NW` tile is needed but not defined in the tileset), it should use a fallback tile. The recommended fallback is the "center" tile for that group, which is the one with the `SWEN` suffix. This ensures that the terrain remains visually consistent even if specific corner or edge pieces are missing.
