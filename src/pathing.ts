import {assert, int, nonnull} from './base.js';

//////////////////////////////////////////////////////////////////////////////

class Point {
  readonly x: int;
  readonly y: int;
  readonly z: int;

  static origin = new Point(0, 0, 0);

  constructor(x: int, y: int, z: int) {
    this.x = x; this.y = y; this.z = z;
  }

  add(o: Point): Point {
    return new Point(int(this.x + o.x), int(this.y + o.y), int(this.z + o.z));
  }

  sub(o: Point): Point {
    return new Point(int(this.x - o.x), int(this.y - o.y), int(this.z - o.z));
  }

  distanceL2(o: Point): number {
    return Math.sqrt(this.distanceSquared(o));
  }

  distanceSquared(o: Point): int {
    const dx = this.x - o.x;
    const dy = this.y - o.y;
    const dz = this.z - o.z;
    return int(dx * dx + dy * dy + dz * dz);
  }

  equal(o: Point): boolean {
    return this.x === o.x && this.y === o.y && this.z === o.z;
  }

  toString(): string { return `Point(${this.x}, ${this.y}, ${this.z})`; }
};

//////////////////////////////////////////////////////////////////////////////

class Direction extends Point {
  static none = new Direction( 0,  0,  0);
  static n    = new Direction( 0,  0, -1);
  static ne   = new Direction( 1,  0, -1);
  static e    = new Direction( 1,  0,  0);
  static se   = new Direction( 1,  0,  1);
  static s    = new Direction( 0,  0,  1);
  static sw   = new Direction(-1,  0,  1);
  static w    = new Direction(-1,  0,  0);
  static nw   = new Direction(-1,  0, -1);
  static up   = new Direction( 0,  1,  0);
  static down = new Direction( 0, -1,  0);

  static all = [Direction.n, Direction.ne, Direction.e, Direction.se,
                Direction.s, Direction.sw, Direction.w, Direction.nw];

  static cardinal = [Direction.n, Direction.e, Direction.s, Direction.w];

  static diagonal = [Direction.ne, Direction.se, Direction.sw, Direction.nw];

  private constructor(x: int, y: int, z: int) { super(x, y, z); }

  static assert(point: Point): Direction {
    if (point.equal(Direction.none)) return Direction.none;
    return nonnull(Direction.all.filter(x => x.equal(point))[0]);
  }
};

//////////////////////////////////////////////////////////////////////////////

class AStarNode extends Point {
  public index: int | null = null;
  constructor(p: Point, public parent: AStarNode | null,
              public distance: number, public score: number) {
    super(p.x, p.y, p.z);
  }
}

// Min-heap implementation on lists of A* nodes. Nodes track indices as well.
type AStarHeap = AStarNode[];

const AStarHeapCheckInvariants = (heap: AStarHeap): void => {
  return; // Comment this line out to enable debug checks.
  heap.map(x => `(${x.index}, ${x.score})`).join('; ');
  heap.forEach((node, index) => {
    const debug = (label: string) => {
      const contents = heap.map(x => `(${x.index}, ${x.score})`).join('; ');
      return `Violated ${label} at ${index}: ${contents}`;
    };
    assert(node.index === index, () => debug('index'));
    if (index === 0) return;
    const parent_index = Math.floor((index - 1) / 2);
    assert(heap[parent_index]!.score <= node.score, () => debug('ordering'));
  });
};

const AStarHeapPush = (heap: AStarHeap, node: AStarNode): void => {
  assert(node.index === null);
  heap.push(node);
  AStarHeapify(heap, node, int(heap.length - 1));
};

const AStarHeapify = (heap: AStarHeap, node: AStarNode, index: int): void => {
  assert(0 <= index && index < heap.length);
  const score = node.score;

  while (index > 0) {
    const parent_index = int((index - 1) / 2);
    const parent = heap[parent_index]!;
    if (parent.score <= score) break;

    heap[index] = parent;
    parent.index = index;
    index = parent_index;
  }

  heap[index] = node;
  node.index = index;
  AStarHeapCheckInvariants(heap);
};

const AStarHeapExtractMin = (heap: AStarHeap): AStarNode => {
  assert(heap.length > 0);
  const result = heap[0]!;
  const node = heap.pop()!;
  result.index = null;

  if (!heap.length) return result;

  let index = int(0);
  while (2 * index + 1 < heap.length) {
    const c1 = heap[2 * index + 1]!;
    const c2 = heap[2 * index + 2] || c1;
    if (node.score <= Math.min(c1.score, c2.score)) break;

    const child_index = int(2 * index + (c1.score > c2.score ? 2 : 1));
    const child = (c1.score > c2.score ? c2 : c1);
    heap[index] = child;
    child.index = index;
    index = child_index;
  }

  heap[index] = node;
  node.index = index;
  AStarHeapCheckInvariants(heap);
  return result;
};

//////////////////////////////////////////////////////////////////////////////

type Check = (p: Point) => boolean;

const AStarUnitCost = 16;
const AStarUpCost   = 64;
const AStarDownCost = 4;
const AStarLimit = int(256);

const AStarKey = (p: Point, source: Point): int => {
  const result = (((p.x - source.x) & 0x3ff) << 0) |
                 (((p.y - source.y) & 0x3ff) << 10) |
                 (((p.z - source.z) & 0x3ff) << 20);
  return result as int;
};

const AStarHeuristic = (source: Point, target: Point) => {
  let dx = target.x - source.x;
  let dy = target.y - source.y;
  let dz = target.z - source.z;
  if (dx !== 0 || dy !== 0 || dz !== 0) {
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= length;
    dy /= length;
    dz /= length;
  }

  return (p: Point): number => {
    const ax = p.x - target.x;
    const ay = p.y - target.y;
    const az = p.z - target.z;

    const dot = ax * dx + ay * dy + az * dz;
    const ox = ax - dot * dx;
    const oy = ay - dot * dy;
    const oz = az - dot * dz;
    const off = Math.sqrt(ox * ox + oy * oy + oz * oz);

    const base = AStarUnitCost * (Math.abs(ax) + Math.abs(az) + off);
    return base + ay * (ay > 0 ? AStarDownCost : -AStarUpCost);
  };
};

const AStarHeight =
    (source: Point, target: Point, check: Check): int | null => {
  const {up, down} = Direction;
  if (!check(target)) {
    const jump = check(source.add(up)) && check(target.add(up));
    return jump ? int(target.y + 1) : null;
  }
  let floor = target.add(down);
  while (floor.y >= 0 && check(floor)) {
    floor = floor.add(down);
  }
  return int(floor.y + 1);
};

const AStarNeighbors = (source: Point, check: Check): Point[] => {
  const result = [];
  const {up, down} = Direction;

  const adjust = (p: Point, y: int) => {
    return y === p.y ? p : new Point(p.x, y, p.z);
  };

  for (const dir of Direction.cardinal) {
    const next = source.add(dir);
    const ny = AStarHeight(source, next, check);
    if (ny === null) continue;

    result.push(adjust(next, ny));

    if (ny < next.y && check(source.add(up)) && check(next.add(up))) {
      const jump = next.add(dir);
      if (check(jump) && check(jump.add(up))) {
        let floor = jump.add(down);
        while (floor.y >= 0 && check(floor)) {
          floor = floor.add(down);
        }
        const jy = int(floor.y + 1);
        if (jy > ny) result.push(adjust(jump, jy));
      }
    }
  }
  return result;
};

const AStar = (source: Point, target: Point, check: Check,
               limit?: int, record?: Point[]): Point[] => {
  console.log(`AStar: ${source.toString()} -> ${target.toString()}`);

  let count = 0;
  limit = limit ? limit : AStarLimit;

  let best: AStarNode | null = null;
  const map: Map<int, AStarNode> = new Map();
  const heap: AStarHeap = [];

  const heuristic = AStarHeuristic(source, target);
  const score = heuristic(source);
  const node = new AStarNode(source, null, 0, score);
  map.set(AStarKey(source, source), node);
  AStarHeapPush(heap, node);

  while (count < limit && heap.length > 0) {
    const cur = AStarHeapExtractMin(heap);
    console.log(`  ${count}: ${cur.toString()}: distance = ${cur.distance}, score = ${cur.score}`);
    if (record) record.push(cur);
    count++;

    if (cur.equal(target)) {
      best = cur;
      break;
    }

    for (const next of AStarNeighbors(cur, check)) {
      const dy = next.y - cur.y;
      const xz = Math.abs(next.x - cur.x) + Math.abs(next.z - cur.z);
      const ud = dy * (dy > 0 ? AStarUpCost : -AStarDownCost);
      const distance = cur.distance + xz * AStarUnitCost + ud;
      const key = AStarKey(next, source);
      const existing = map.get(key);

      // index !== null is a check to see if we've already popped this node
      // from the heap. We need it because our heuristic is not admissible.
      //
      // Using such a heuristic substantially speeds up search in easy cases,
      // with the downside that we don't always find an optimal path.
      if (existing && existing.index !== null && existing.distance > distance) {
        existing.score += distance - existing.distance;
        existing.distance = distance;
        existing.parent = cur;
        AStarHeapify(heap, existing, existing.index);
      } else if (!existing) {
        const score = distance + heuristic(next);
        const created = new AStarNode(next, cur, distance, score);
        AStarHeapPush(heap, created);
        map.set(key, created);
      }
    }
  }

  if (best === null) {
    const heuristic = (x: AStarNode) => x.score - x.distance;
    for (const node of map.values()) {
      if (!best || heuristic(node) < heuristic(best)) best = node;
    }
  }

  const result: Point[] = [];
  while (best) {
    result.push(best);
    best = best.parent;
  }
  console.log(`Found ${result.length}-node path:`);
  for (let i = result.length - 1; i >= 0; i--) {
    console.log(`  ${result[i].toString()}`);
  }
  return result.reverse();
};

//////////////////////////////////////////////////////////////////////////////

export {AStar, Check, Direction, Point};
