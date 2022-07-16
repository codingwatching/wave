import {makeNoise2D} from '../lib/open-simplex-2d.js';
import {assert, int} from './base.js';
import {BlockId, Column} from './engine.js';
import {kChunkWidth, kEmptyBlock, kWorldHeight} from './engine.js';

//////////////////////////////////////////////////////////////////////////////

const kIslandRadius = 1024;
const kSeaLevel = (kWorldHeight / 4) | 0;

const kCaveLevels = 3;
const kCaveDeltaY = 0;
const kCaveHeight = 8;
const kCaveRadius = 16;
const kCaveCutoff = 0.25;
const kCaveWaveHeight = 16;
const kCaveWaveRadius = 256;

interface Blocks {
  bedrock: BlockId,
  dirt: BlockId,
  grass: BlockId,
  leaves: BlockId,
  rock: BlockId,
  sand: BlockId,
  snow: BlockId,
  trunk: BlockId,
  water: BlockId,
};

//////////////////////////////////////////////////////////////////////////////

// Noise helpers:

let noise_counter = (Math.random() * (1 << 30)) | 0;
const noise2D = (): (x: number, y: number) => number => {
  return makeNoise2D(noise_counter++);
};

const minetest_noise_2d = (
    offset: number, scale: number, spread: number,
    octaves: int, persistence: number, lacunarity: number) => {
  const components = new Array(octaves).fill(null).map(noise2D);

  return (x: number, y: number): number => {
    let f = 1, g = 1;
    let result = 0;

    x /= spread;
    y /= spread;

    for (let i = 0; i < octaves; i++) {
      result += g * components[i](x * f, y * f);
      f *= lacunarity;
      g *= persistence;
    }
    return scale * result + offset;
  };
};

const ridgeNoise = (octaves: number, persistence: number, scale: number) => {
  const components = new Array(4).fill(null).map(noise2D);
  return (x: int, z: int) => {
    let result = 0, a = 1, s = scale;
    for (const component of components) {
      result += (1 - Math.abs(component(x * s, z * s))) * a;
      a *= persistence;
      s *= 2;
    }
    return result;
  };
};

// Noises instances used to build the heightmap.

const mgv7_np_cliff_select = minetest_noise_2d(
    0, 1, 512, 4, 0.7, 2.0);
const mgv7_np_mountain_select = minetest_noise_2d(
    0, 1, 512, 4, 0.7, 2.0);
const mgv7_np_terrain_ground = minetest_noise_2d(
    2, 8, 512, 6, 0.6, 2.0);
const mgv7_np_terrain_cliff = minetest_noise_2d(
    8, 16, 512, 6, 0.6, 2.0);

const mgv7_mountain_ridge = ridgeNoise(8, 0.5, 0.002);

const cave_noises = new Array(2 * kCaveLevels).fill(null).map(noise2D);

// Cave generation.

const carve_caves = (x: int, z: int, column: Column) => {
  const start = kSeaLevel - kCaveDeltaY * (kCaveLevels - 1) / 2;
  for (let i = 0; i < kCaveLevels; i++) {
    const carver_noise = cave_noises[2 * i + 0];
    const height_noise = cave_noises[2 * i + 1];
    const carver = carver_noise(x / kCaveRadius, z / kCaveRadius);
    if (carver > kCaveCutoff) {
      const dy = start + i * kCaveDeltaY;
      const height = height_noise(x / kCaveWaveRadius, z / kCaveWaveRadius);
      const offset = (dy + kCaveWaveHeight * height) | 0;
      const blocks = ((carver - kCaveCutoff) * kCaveHeight) | 0;
      for (let i = 0; i < 2 * blocks + 3; i++) {
        column.overwrite(kEmptyBlock, offset + i - blocks);
      }
    }
  }
}

// Tree generation.

const hash_fnv32 = (k: int) => {
  let result = 2166136261;
  for (let i = 0; i < 4; i++) {
    result ^= (k & 255);
    result *= 16777619;
    k = k >> 8;
  }
  return result;
};

const kMask = (1 << 15) - 1;
const has_tree = (x: int, z: int): boolean => {
  const base = hash_fnv32(((x & kMask) << 15) | (z & kMask));
  return (base & 63) <= 3;
};

// Terrain generation.

interface HeightmapResult {
  height: int,
  tile: BlockId,
  snow_depth: int,
};

const kHeightmapResult = {height: 0, tile: kEmptyBlock, snow_depth: 0};

const heightmap = (x: int, z: int, blocks: Blocks): HeightmapResult => {
  const base = Math.sqrt(x * x + z * z) / kIslandRadius;
  const falloff = 16 * base * base;
  if (falloff >= kSeaLevel) {
    kHeightmapResult.height = 0;
    kHeightmapResult.tile = kEmptyBlock;
    kHeightmapResult.snow_depth = 0;
    return kHeightmapResult;
  }

  const cliff_select = mgv7_np_cliff_select(x, z);
  const cliff_x = Math.max(Math.min(16 * Math.abs(cliff_select) - 4, 1), 0);

  const mountain_select = mgv7_np_mountain_select(x, z);
  const mountain_x = Math.sqrt(Math.max(8 * mountain_select, 0));

  const cliff = cliff_x - mountain_x;
  const mountain = -cliff;

  const height_ground = mgv7_np_terrain_ground(x, z);
  const height_cliff = cliff > 0
    ? mgv7_np_terrain_cliff(x, z)
    : height_ground;
  const height_mountain = mountain > 0
    ? height_ground + 64 * Math.pow((mgv7_mountain_ridge(x, z) - 1.25), 1.5)
    : height_ground;

  const height = (() => {
    if (height_mountain > height_ground) {
      return height_mountain * mountain + height_ground * (1 - mountain);
    } else if (height_cliff > height_ground) {
      return height_cliff * cliff + height_ground * (1 - cliff);
    }
    return height_ground;
  })();

  const truncated = (height - falloff) | 0;
  const abs_height = truncated + kSeaLevel;
  const tile = (() => {
    if (truncated < -1) return blocks.dirt;
    if (height_mountain > height_ground) {
      const base = height - (72 - 8 * mountain);
      return base > 0 ? blocks.snow : blocks.rock;
    }
    if (height_cliff > height_ground) return blocks.dirt;
    return truncated < 1 ? blocks.sand : blocks.grass;
  })();

  kHeightmapResult.height = abs_height;
  kHeightmapResult.tile = tile;
  kHeightmapResult.snow_depth = tile === blocks.snow
    ? height - (72 - 8 * mountain)
    : 0;
  return kHeightmapResult;
};

const loadChunk = (blocks: Blocks) => (x: int, z: int, column: Column) => {
  const {height, tile, snow_depth} = heightmap(x, z, blocks);
  if (tile === blocks.snow) {
    column.push(blocks.rock, height - snow_depth);
  } else if (tile !== blocks.rock) {
    column.push(blocks.rock, height - 4);
    column.push(blocks.dirt, height - 1);
  }
  column.push(tile, height);
  column.push(blocks.water, kSeaLevel);
  if (tile === blocks.grass && has_tree(x, z)) {
    column.push(blocks.leaves, height + 1);
  }
  carve_caves(x, z, column);
};

const loadFrontier = (blocks: Blocks) => (x: int, z: int, column: Column) => {
  const {height, tile} = heightmap(x, z, blocks);
  column.push(tile, height);
  column.push(blocks.water, kSeaLevel);
};

export {Blocks, loadChunk, loadFrontier};
