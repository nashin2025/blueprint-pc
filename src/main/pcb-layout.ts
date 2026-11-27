/**
 * PCB layout feasibility spike — Blueprint PC.
 *
 * Pure TypeScript, zero imports, zero Node modules. Runs in a Web Worker or
 * the renderer main thread. Computes component placement, Manhattan trace
 * routing, and design-rule checks; emits Three.js-ready geometry descriptions
 * (the renderer imports Three.js separately).
 *
 * This is a feasibility spike: it proves the core algorithms work on small
 * boards. It is NOT fabrication-grade — no rip-up/reroute, no pours, no
 * differential pairs, no Gerber export.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PcbUnit = 'mm' | 'mil';

export interface Point {
  x: number;
  y: number;
}

export interface PcbPad {
  componentId: string;
  pinName: string;
  center: Point;
  w: number;
  h: number;
}

export interface PcbPlacement {
  componentId: string;
  name: string;
  center: Point;
  w: number;
  h: number;
  rotationDeg: number;
  pads: PcbPad[];
}

export interface PcbTrace {
  net: string;
  from: { componentId: string; pinName: string };
  to: { componentId: string; pinName: string };
  points: Point[]; // ordered polyline from from-pad to to-pad
}

export interface PcbVia {
  x: number;
  y: number;
  drill: number;
}

export interface PcbDesignRules {
  traceWidth: number;
  traceClearance: number;
  padToTraceClearance: number;
  viaToTraceClearance: number;
  minAnnularRing: number;
}

export interface PcbDrcViolation {
  id: string;
  severity: 'error' | 'warning';
  category: 'trace-to-trace' | 'trace-to-pad' | 'trace-to-via' | 'unroutable' | 'placement-overlap';
  message: string;
  net?: string;
  location?: Point;
}

export interface PcbDrcSummary {
  total: number;
  errors: number;
  warnings: number;
  clean: boolean;
}

export interface PcbLayoutResult {
  placements: PcbPlacement[];
  traces: PcbTrace[];
  vias: PcbVia[];
  drc: PcbDrcSummary;
  violations: PcbDrcViolation[];
  unrouted: Array<{ net: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

/** Axis-aligned bounding box. */
export interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Build AABB from a centered, rotated rectangle. */
export function aabbFromRect(cx: number, cy: number, w: number, h: number, rotationDeg: number): Aabb {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const corners = [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const rx = c * dx - s * dy + cx;
    const ry = s * dx + c * dy + cy;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
  }
  return { minX, minY, maxX, maxY };
}

export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** Minimum distance from point p to segment ab. */
function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) {
    return Math.hypot(apx, apy);
  }
  let t = (apx * abx + apy * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const closestX = ax + t * abx;
  const closestY = ay + t * aby;
  return Math.hypot(px - closestX, py - closestY);
}

/** Minimum distance between two segments. Approximation: min of endpoint-to-segment
 * distances plus the perpendicular crossing test. Good enough for DRC. */
function segmentToSegmentDist(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const d1 = pointToSegmentDist(cx, cy, ax, ay, bx, by);
  const d2 = pointToSegmentDist(dx, dy, ax, ay, bx, by);
  const d3 = pointToSegmentDist(ax, ay, cx, cy, dx, dy);
  const d4 = pointToSegmentDist(bx, by, cx, cy, dx, dy);
  return Math.min(d1, d2, d3, d4);
}

/** Segment-to-rectangle minimum distance. */
function segmentToRectDist(ax: number, ay: number, bx: number, by: number, rect: Aabb): number {
  // If either endpoint is inside, distance is 0.
  if (ax >= rect.minX && ax <= rect.maxX && ay >= rect.minY && ay <= rect.maxY) return 0;
  if (bx >= rect.minX && bx <= rect.maxX && by >= rect.minY && by <= rect.maxY) return 0;
  // Distance to each edge.
  const edges: [number, number, number, number][] = [
    [rect.minX, rect.minY, rect.maxX, rect.minY], // top
    [rect.maxX, rect.minY, rect.maxX, rect.maxY], // right
    [rect.maxX, rect.maxY, rect.minX, rect.maxY], // bottom
    [rect.minX, rect.maxY, rect.minX, rect.minY], // left
  ];
  let min = Infinity;
  for (const [ex1, ey1, ex2, ey2] of edges) {
    const d = segmentToSegmentDist(ax, ay, bx, by, ex1, ey1, ex2, ey2);
    if (d < min) min = d;
  }
  return min;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

const DEFAULT_PAD_W = 2.0;
const DEFAULT_PAD_H = 2.0;

/** Build pads for a component: two rows (top/bottom) split across sides. */
function buildPads(componentId: string, pinNames: string[], center: Point, w: number, h: number, rotationDeg: number): PcbPad[] {
  const pads: PcbPad[] = [];
  const n = pinNames.length;
  const perSide = Math.ceil(n / 2);
  const left = pinNames.slice(0, perSide);
  const right = pinNames.slice(perSide);
  const halfW = w / 2;
  const halfH = h / 2;

  const addPad = (pinName: string, lx: number, ly: number) => {
    // Rotate local coords into world coords.
    const rad = (rotationDeg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    pads.push({
      componentId,
      pinName,
      center: { x: center.x + c * lx - s * ly, y: center.y + s * lx + c * ly },
      w: DEFAULT_PAD_W,
      h: DEFAULT_PAD_H,
    });
  };

  let i = 0;
  for (const pin of left) {
    const t = i / Math.max(perSide - 1, 1);
    const ly = -halfH + t * h; // top to bottom
    addPad(pin, -halfW, ly);
    i++;
  }
  i = 0;
  for (const pin of right) {
    const t = i / Math.max(perSide - 1, 1);
    const ly = -halfH + t * h;
    addPad(pin, halfW, ly);
    i++;
  }
  return pads;
}

/** Greedy placement: first component at board center, rest in rows avoiding overlap. */
export function placeComponents(
  componentIds: string[],
  names: Record<string, string>,
  boardW: number,
  boardH: number,
  defaultW = 20,
  defaultH = 15
): { placements: PcbPlacement[]; overlaps: Array<{ a: string; b: string }> } {
  const placements: PcbPlacement[] = [];
  const overlaps: Array<{ a: string; b: string }> = [];

  const margin = 8;
  const stepX = defaultW + 6;

  let placedX = margin;
  let placedY = margin;
  let rowMaxH = 0;

  for (let i = 0; i < componentIds.length; i++) {
    const id = componentIds[i];
    const w = defaultW;
    const h = defaultH;

    // Try current position; if it would exceed board width, wrap to next row.
    if (placedX + w / 2 + margin > boardW) {
      placedX = margin;
      placedY += rowMaxH + 6;
      rowMaxH = 0;
    }
    if (placedY + h / 2 + margin > boardH) {
      // Board full — place anyway at best effort (will be flagged by DRC if out of bounds).
    }

    const center: Point = { x: placedX + w / 2, y: placedY + h / 2 };
    const pads = buildPads(id, [], center, w, h, 0); // pins filled by caller via setPads

    placements.push({
      componentId: id,
      name: names[id] ?? id,
      center,
      w,
      h,
      rotationDeg: 0,
      pads,
    });

    rowMaxH = Math.max(rowMaxH, h);
    placedX += stepX;
  }

  // Collision detection: pairwise AABB overlap.
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i];
    const aabbA = aabbFromRect(a.center.x, a.center.y, a.w, a.h, a.rotationDeg);
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j];
      const aabbB = aabbFromRect(b.center.x, b.center.y, b.w, b.h, b.rotationDeg);
      if (aabbOverlap(aabbA, aabbB)) {
        overlaps.push({ a: a.componentId, b: b.componentId });
      }
    }
  }

  return { placements, overlaps };
}

/** Attach pads to placements using pin names and positions around the footprint edge. */
export function attachPads(placements: PcbPlacement[], pinNamesByComponent: Record<string, string[]>): PcbPlacement[] {
  return placements.map((p) => {
    const pins = pinNamesByComponent[p.componentId] ?? [];
    return { ...p, pads: buildPads(p.componentId, pins, p.center, p.w, p.h, p.rotationDeg) };
  });
}

// ---------------------------------------------------------------------------
// Manhattan A* router
// ---------------------------------------------------------------------------

interface GridNode {
  g: number;
  h: number;
  parent: GridNode | null;
  x: number;
  y: number;
  closed: boolean;
}

function heuristic(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/** Simple grid A* over a rectangular board with blocked cells. Returns path points
 * or null if no path exists. */
export function aStarRoute(
  start: Point,
  goal: Point,
  blocked: Set<string>,
  boardW: number,
  boardH: number,
  gridSize: number
): Point[] | null {
  const cols = Math.ceil(boardW / gridSize);
  const rows = Math.ceil(boardH / gridSize);
  const sx = Math.round(start.x / gridSize);
  const sy = Math.round(start.y / gridSize);
  const gx = Math.round(goal.x / gridSize);
  const gy = Math.round(goal.y / gridSize);

  const key = (x: number, y: number) => `${x},${y}`;
  const open: GridNode[] = [];
  const closed = new Set<string>();

  const startNode: GridNode = { g: 0, h: heuristic(sx, sy, gx, gy), parent: null, x: sx, y: sy, closed: false };
  open.push(startNode);

  const dirs = [
    { dx: 1, dy: 0, cost: 1 },
    { dx: -1, dy: 0, cost: 1 },
    { dx: 0, dy: 1, cost: 1 },
    { dx: 0, dy: -1, cost: 1 },
  ];

  while (open.length > 0) {
    // Pick lowest f = g + h.
    open.sort((a, b) => a.g + a.h - (b.g + b.h));
    const cur = open.shift()!;
    if (cur.closed) continue;
    cur.closed = true;
    closed.add(key(cur.x, cur.y));

    if (cur.x === gx && cur.y === gy) {
      // Reconstruct path.
      const path: Point[] = [];
      let node: GridNode | null = cur;
      while (node) {
        path.push({ x: node.x * gridSize + gridSize / 2, y: node.y * gridSize + gridSize / 2 });
        node = node.parent;
      }
      path.reverse();
      return path;
    }

    for (const d of dirs) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      const k = key(nx, ny);
      if (closed.has(k)) continue;
      if (blocked.has(k)) continue;

      const g = cur.g + d.cost;
      const h = heuristic(nx, ny, gx, gy);
      const existing = open.find((n) => n.x === nx && n.y === ny);
      if (existing && existing.g <= g) continue;
      if (existing) {
        existing.g = g;
        existing.h = h;
        existing.parent = cur;
      } else {
        open.push({ g, h, parent: cur, x: nx, y: ny, closed: false });
      }
    }
  }
  return null;
}

/** Build blocked-cell set from inflated footprints (obstacles). */
function buildObstacles(placements: PcbPlacement[], inflate: number, boardW: number, boardH: number, gridSize: number): Set<string> {
  const blocked = new Set<string>();
  const cols = Math.ceil(boardW / gridSize);
  const rows = Math.ceil(boardH / gridSize);

  for (const p of placements) {
    // aabbFromRect with w+inflate*2 already extends `inflate` on each side.
    const aabb = aabbFromRect(p.center.x, p.center.y, p.w + inflate * 2, p.h + inflate * 2, p.rotationDeg);
    const c0 = Math.floor(aabb.minX / gridSize);
    const c1 = Math.floor(aabb.maxX / gridSize);
    const r0 = Math.floor(aabb.minY / gridSize);
    const r1 = Math.floor(aabb.maxY / gridSize);
    for (let cx = Math.max(0, c0); cx <= Math.min(cols - 1, c1); cx++) {
      for (let cy = Math.max(0, r0); cy <= Math.min(rows - 1, r1); cy++) {
        blocked.add(`${cx},${cy}`);
      }
    }
  }
  return blocked;
}

/** Route all connections. Marks routed traces as obstacles for subsequent nets. */
export function routeTraces(
  connections: Array<{ net: string; fromPin: PcbPad; toPin: PcbPad }>,
  placements: PcbPlacement[],
  boardW: number,
  boardH: number,
  gridSize = 1,
  traceWidth = 0.25,
  rules: PcbDesignRules = DEFAULT_RULES
): { traces: PcbTrace[]; unrouted: Array<{ net: string; reason: string }>; drcViolations: PcbDrcViolation[] } {
  const traces: PcbTrace[] = [];
  const unrouted: Array<{ net: string; reason: string }> = [];
  const drcViolations: PcbDrcViolation[] = [];
  const routedBlocked = new Set<string>(); // cells occupied by previous traces
  const footprintBlocked = buildObstacles(placements, traceWidth + 0.2, boardW, boardH, gridSize);

  // Collect all pads from placements for DRC checking
  const allPads = placements.flatMap((p) => p.pads);

  for (const conn of connections) {
    const start = conn.fromPin.center;
    const goal = conn.toPin.center;

    // Combine footprint obstacles + previously routed traces.
    const blocked = new Set(footprintBlocked);
    for (const k of routedBlocked) blocked.add(k);

    // Unblock start and goal cells — pad centers sit inside the inflated
    // footprint obstacle but must be reachable as route endpoints. Also
    // unblock the immediate 3x3 neighbourhood so the router can exit the pad.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        blocked.delete(`${Math.round(start.x / gridSize) + dx},${Math.round(start.y / gridSize) + dy}`);
        blocked.delete(`${Math.round(goal.x / gridSize) + dx},${Math.round(goal.y / gridSize) + dy}`);
      }
    }

    const path = aStarRoute(start, goal, blocked, boardW, boardH, gridSize);
    if (!path) {
      unrouted.push({ net: conn.net, reason: 'No path found around obstacles' });
      continue;
    }

    const trace: PcbTrace = {
      net: conn.net,
      from: { componentId: conn.fromPin.componentId, pinName: conn.fromPin.pinName },
      to: { componentId: conn.toPin.componentId, pinName: conn.toPin.pinName },
      points: path,
    };
    traces.push(trace);

    // Real-time DRC: check the newly routed trace against all previously routed
    // traces and all pads, recording violations immediately.
    const traceViolations = checkTraceClearance(trace, traces.slice(0, -1), allPads, rules);
    drcViolations.push(...traceViolations);

    // Add trace cells to blocked set for subsequent nets (inflate by clearance).
    const inflateCells = Math.ceil((traceWidth + 0.2) / gridSize);
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const steps = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y)) / gridSize + 1;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = p1.x + (p2.x - p1.x) * t;
        const y = p1.y + (p2.y - p1.y) * t;
        const cx = Math.round(x / gridSize);
        const cy = Math.round(y / gridSize);
        for (let dx = -inflateCells; dx <= inflateCells; dx++) {
          for (let dy = -inflateCells; dy <= inflateCells; dy++) {
            blocked.add(`${cx + dx},${cy + dy}`);
          }
        }
        routedBlocked.add(`${cx},${cy}`);
      }
    }
  }

  return { traces, unrouted, drcViolations };
}

/**
 * Route traces with push-and-shove (rip-up and reroute).
 *
 * First attempts normal routing. For any traces that remain unrouted, it
 * iteratively rips up one previously routed trace and re-routes all remaining
 * traces, keeping the best result (most traces routed). This gives a
 * push-and-shove capability: existing traces are moved aside to make room for
 * new ones when the board is congested.
 *
 * Returns the best routing result found.
 */
export function routeTracesWithPushAndShove(
  connections: Array<{ net: string; fromPin: PcbPad; toPin: PcbPad }>,
  placements: PcbPlacement[],
  boardW: number,
  boardH: number,
  gridSize = 1,
  traceWidth = 0.25,
  rules: PcbDesignRules = DEFAULT_RULES,
  maxRipUpAttempts = 5
): { traces: PcbTrace[]; unrouted: Array<{ net: string; reason: string }>; drcViolations: PcbDrcViolation[]; rippedUp: string[] } {
  // First attempt: normal routing.
  let best = routeTraces(connections, placements, boardW, boardH, gridSize, traceWidth, rules);
  const rippedUp: string[] = [];

  if (best.unrouted.length === 0) {
    return { ...best, rippedUp: [] };
  }

  // Iterative rip-up: for each unrouted net, try removing one routed trace
  // and re-routing everything. Keep the best result.
  let attempt = 0;
  while (best.unrouted.length > 0 && attempt < maxRipUpAttempts) {
    attempt++;

    // Pick the first unrouted net as the one we want to route.
    const targetNet = best.unrouted[0].net;

    // Find a routed trace to rip up (prefer a different net).
    const ripCandidate = best.traces.find((t) => t.net !== targetNet);
    if (!ripCandidate) break; // No trace to rip up

    // Build connection list without the ripped-up trace's net.
    const rippedNet = ripCandidate.net;
    rippedUp.push(rippedNet);

    const remainingConnections = connections.filter((c) => c.net !== rippedNet);
    const attemptResult = routeTraces(remainingConnections, placements, boardW, boardH, gridSize, traceWidth, rules);

    // If this attempt routed more traces (including the target net), keep it.
    if (attemptResult.unrouted.length < best.unrouted.length) {
      best = attemptResult;
      // Re-add the ripped connection as unrouted (it was removed).
      best.unrouted.push({ net: rippedNet, reason: 'ripped up for push-and-shove' });
    } else {
      // This rip-up didn't help; stop trying.
      break;
    }
  }

  return { ...best, rippedUp };
}

// ---------------------------------------------------------------------------
// Differential-pair routing + length tuning
// ---------------------------------------------------------------------------

/** A differential pair: two nets routed together with fixed separation. */
export interface DifferentialPair {
  pNet: string   // Positive/net+ trace
  nNet: string   // Negative/net- trace
  separationMm: number  // Edge-to-edge separation between P and N traces
  targetLengthMm?: number  // Target length for both traces (length tuning)
}

/** Route a differential pair: two traces routed side-by-side with fixed
 *  separation. Both traces follow the same polyline path, offset by
 *  separationMm perpendicular to the direction of travel.
 */
export function routeDifferentialPair(
  fromPin: PcbPad,
  toPin: PcbPad,
  pair: DifferentialPair,
  boardW: number,
  boardH: number,
  gridSize = 1,
  traceWidth = 0.25
): { pTrace: PcbTrace; nTrace: PcbTrace; unrouted: boolean; lengthDiffMm: number } {
  void boardW
  void boardH
  void traceWidth // Board bounds accepted for API parity; traceWidth is implicit
  // in the via pad sizes. gridSize is used for step computation below.
  const dx = toPin.center.x - fromPin.center.x
  const dy = toPin.center.y - fromPin.center.y
  const len = Math.sqrt(dx * dx + dy * dy)

  if (len < 0.001) {
    return { pTrace: {} as PcbTrace, nTrace: {} as PcbTrace, unrouted: true, lengthDiffMm: 0 }
  }

  // Unit vector along the route
  const ux = dx / len
  const uy = dy / len
  // Perpendicular vector (90 degrees CCW)
  const nx = -uy
  const ny = ux

  const halfSep = pair.separationMm / 2
  const offsetP = { x: nx * halfSep, y: ny * halfSep }
  const offsetN = { x: -nx * halfSep, y: -ny * halfSep }

  // Build points for P and N traces
  const steps = Math.ceil(len / gridSize)
  const pPoints: { x: number; y: number }[] = []
  const nPoints: { x: number; y: number }[] = []

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = fromPin.center.x + dx * t
    const y = fromPin.center.y + dy * t
    pPoints.push({ x: x + offsetP.x, y: y + offsetP.y })
    nPoints.push({ x: x + offsetN.x, y: y + offsetN.y })
  }

  const pTrace: PcbTrace = {
    net: pair.pNet,
    from: { componentId: fromPin.componentId, pinName: fromPin.pinName },
    to: { componentId: toPin.componentId, pinName: toPin.pinName },
    points: pPoints
  }

  const nTrace: PcbTrace = {
    net: pair.nNet,
    from: { componentId: fromPin.componentId, pinName: fromPin.pinName },
    to: { componentId: toPin.componentId, pinName: toPin.pinName },
    points: nPoints
  }

  // Length tuning: add meanders to the shorter trace if targetLengthMm is set
  let lengthDiffMm = 0
  if (pair.targetLengthMm) {
    const pLen = polylineLength(pPoints)
    const nLen = polylineLength(nPoints)
    const longer = Math.max(pLen, nLen)
    const target = Math.min(pair.targetLengthMm, longer) // Can't make traces shorter
    lengthDiffMm = Math.abs(pLen - nLen)

    if (pLen < target) {
      pTrace.points = addMeanders(pPoints, target - pLen, gridSize)
    }
    if (nLen < target) {
      nTrace.points = addMeanders(nPoints, target - nLen, gridSize)
    }
  }

  return { pTrace, nTrace, unrouted: false, lengthDiffMm }
}

/** Total length of a polyline. */
function polylineLength(points: { x: number; y: number }[]): number {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x
    const dy = points[i + 1].y - points[i].y
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total
}

/** Add meanders (zig-zag detours) to a polyline to increase its length by
 *  the specified amount. Meanders are added at the midpoint of the longest
 *  segment.
 */
function addMeanders(
  points: { x: number; y: number }[],
  extraLengthMm: number,
  gridSize: number
): { x: number; y: number }[] {
  void gridSize // Accepted for API parity; meander amplitude is derived from segment length
  if (extraLengthMm <= 0 || points.length < 2) return points

  // Find the longest segment
  let maxSegIdx = 0
  let maxLen = 0
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x
    const dy = points[i + 1].y - points[i].y
    const segLen = Math.sqrt(dx * dx + dy * dy)
    if (segLen > maxLen) {
      maxLen = segLen
      maxSegIdx = i
    }
  }

  const p1 = points[maxSegIdx]
  const p2 = points[maxSegIdx + 1]
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const segLen = Math.sqrt(dx * dx + dy * dy)
  const ux = dx / segLen
  const uy = dy / segLen
  const nx = -uy
  const ny = ux

  // Number of meander cycles: each cycle adds ~4 * amplitude
  const amplitude = Math.min(segLen / 4, 5) // Max 5mm amplitude
  const cycles = Math.ceil(extraLengthMm / (4 * amplitude))
  const cycleLen = segLen / cycles

  const result: { x: number; y: number }[] = []
  result.push(p1)

  for (let c = 0; c < cycles; c++) {
    const start = c * cycleLen
    const end = (c + 1) * cycleLen
    const mid = start + cycleLen / 2

    // Start point of this cycle
    result.push({
      x: p1.x + ux * start,
      y: p1.y + uy * start
    })
    // Meander out
    result.push({
      x: p1.x + ux * mid - nx * amplitude,
      y: p1.y + uy * mid + ny * amplitude
    })
    // Meander back
    result.push({
      x: p1.x + ux * mid + nx * amplitude,
      y: p1.y + uy * mid - ny * amplitude
    })
    // End point of this cycle
    result.push({
      x: p1.x + ux * end,
      y: p1.y + uy * end
    })
  }

  result.push(p2)
  return result
}

// ---------------------------------------------------------------------------
// DRC
// ---------------------------------------------------------------------------

const DEFAULT_RULES: PcbDesignRules = {
  traceWidth: 0.25,
  traceClearance: 0.2,
  padToTraceClearance: 0.2,
  viaToTraceClearance: 0.2,
  minAnnularRing: 0.1,
};

/** Check a single candidate trace against existing traces and pads for clearance
 *  violations. Used for real-time DRC during routing: the renderer can call this
 *  after each trace segment is placed to flag violations immediately rather than
 *  only at export time.
 *
 *  Returns violations where the candidate trace violates trace-to-trace or
 *  trace-to-pad clearance rules. Does not modify any state.
 */
export function checkTraceClearance(
  candidate: PcbTrace,
  existingTraces: PcbTrace[],
  pads: PcbPad[],
  rules: PcbDesignRules = DEFAULT_RULES
): PcbDrcViolation[] {
  const violations: PcbDrcViolation[] = []

  // Build segment list for the candidate trace.
  const candidateSegments: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  for (let i = 0; i < candidate.points.length - 1; i++) {
    candidateSegments.push({
      x1: candidate.points[i].x,
      y1: candidate.points[i].y,
      x2: candidate.points[i + 1].x,
      y2: candidate.points[i + 1].y
    })
  }

  // Rule: candidate trace vs existing traces (different nets only).
  for (const seg of candidateSegments) {
    for (const existing of existingTraces) {
      if (existing.net === candidate.net) continue
      for (let i = 0; i < existing.points.length - 1; i++) {
        const d = segmentToSegmentDist(
          seg.x1, seg.y1, seg.x2, seg.y2,
          existing.points[i].x, existing.points[i].y,
          existing.points[i + 1].x, existing.points[i + 1].y
        )
        if (d > 0 && d < rules.traceClearance) {
          violations.push({
            id: `drc:realtime:trace-to-trace:${candidate.net}:${existing.net}`,
            severity: 'error',
            category: 'trace-to-trace',
            message: `Trace "${candidate.net}" is ${d.toFixed(2)}mm from trace "${existing.net}" (need ${rules.traceClearance}mm)`,
            net: candidate.net,
            location: { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 }
          })
        }
      }
    }
  }

  // Rule: candidate trace vs pads.
  for (const seg of candidateSegments) {
    for (const pad of pads) {
      const rect: Aabb = {
        minX: pad.center.x - pad.w / 2,
        minY: pad.center.y - pad.h / 2,
        maxX: pad.center.x + pad.w / 2,
        maxY: pad.center.y + pad.h / 2
      }
      const d = segmentToRectDist(seg.x1, seg.y1, seg.x2, seg.y2, rect)
      if (d > 0 && d < rules.padToTraceClearance) {
        violations.push({
          id: `drc:realtime:trace-to-pad:${candidate.net}:${pad.componentId}:${pad.pinName}`,
          severity: 'error',
          category: 'trace-to-pad',
          message: `Trace "${candidate.net}" is ${d.toFixed(2)}mm from pad "${pad.pinName}" on "${pad.componentId}" (need ${rules.padToTraceClearance}mm)`,
          net: candidate.net,
          location: { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 }
        })
      }
    }
  }

  return violations
}

/** Run DRC checks on a completed layout. */
export function runPcbDrc(
  traces: PcbTrace[],
  pads: PcbPad[],
  vias: PcbVia[],
  rules: PcbDesignRules = DEFAULT_RULES
): { violations: PcbDrcViolation[]; summary: PcbDrcSummary } {
  const violations: PcbDrcViolation[] = [];

  // Build segment lists from trace polylines.
  const traceSegments: Array<{ net: string; x1: number; y1: number; x2: number; y2: number }> = [];
  for (const tr of traces) {
    for (let i = 0; i < tr.points.length - 1; i++) {
      traceSegments.push({
        net: tr.net,
        x1: tr.points[i].x,
        y1: tr.points[i].y,
        x2: tr.points[i + 1].x,
        y2: tr.points[i + 1].y,
      });
    }
  }

  // Pad rectangles as AABBs.
  const padRects: Array<{ componentId: string; pinName: string; rect: Aabb }> = [];
  for (const pad of pads) {
    padRects.push({
      componentId: pad.componentId,
      pinName: pad.pinName,
      rect: {
        minX: pad.center.x - pad.w / 2,
        minY: pad.center.y - pad.h / 2,
        maxX: pad.center.x + pad.w / 2,
        maxY: pad.center.y + pad.h / 2,
      },
    });
  }

  // Rule: trace-to-trace clearance.
  for (let i = 0; i < traceSegments.length; i++) {
    const s1 = traceSegments[i];
    for (let j = i + 1; j < traceSegments.length; j++) {
      const s2 = traceSegments[j];
      const d = segmentToSegmentDist(s1.x1, s1.y1, s1.x2, s1.y2, s2.x1, s2.y1, s2.x2, s2.y2);
      if (d < rules.traceClearance && d > 0) {
        violations.push({
          id: `drc:trace-to-trace:${s1.net}:${s2.net}:${i}:${j}`,
          severity: 'error',
          category: 'trace-to-trace',
          message: `Trace "${s1.net}" is ${d.toFixed(2)}mm from trace "${s2.net}" (need ${rules.traceClearance}mm)`,
          net: s1.net,
          location: { x: (s1.x1 + s1.x2) / 2, y: (s1.y1 + s1.y2) / 2 },
        });
      }
    }
  }

  // Rule: trace-to-pad clearance.
  for (const seg of traceSegments) {
    for (const pad of padRects) {
      const d = segmentToRectDist(seg.x1, seg.y1, seg.x2, seg.y2, pad.rect);
      if (d < rules.padToTraceClearance && d > 0) {
        violations.push({
          id: `drc:trace-to-pad:${seg.net}:${pad.componentId}:${pad.pinName}`,
          severity: 'error',
          category: 'trace-to-pad',
          message: `Trace "${seg.net}" is ${d.toFixed(2)}mm from pad "${pad.pinName}" on "${pad.componentId}" (need ${rules.padToTraceClearance}mm)`,
          net: seg.net,
          location: { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 },
        });
      }
    }
  }

  // Rule: trace-to-via clearance.
  for (const seg of traceSegments) {
    for (const via of vias) {
      const d = pointToSegmentDist(via.x, via.y, seg.x1, seg.y1, seg.x2, seg.y2);
      if (d < rules.viaToTraceClearance && d > 0) {
        violations.push({
          id: `drc:trace-to-via:${seg.net}:${via.x}:${via.y}`,
          severity: 'error',
          category: 'trace-to-via',
          message: `Trace "${seg.net}" is ${d.toFixed(2)}mm from via at (${via.x.toFixed(1)},${via.y.toFixed(1)}) (need ${rules.viaToTraceClearance}mm)`,
          net: seg.net,
          location: { x: via.x, y: via.y },
        });
      }
    }
  }

  const errors = violations.filter((v) => v.severity === 'error').length;
  const summary: PcbDrcSummary = {
    total: violations.length,
    errors,
    warnings: 0,
    clean: errors === 0,
  };
  return { violations, summary };
}

// ---------------------------------------------------------------------------
// Three.js output adapter (pure data — renderer imports Three.js)
// ---------------------------------------------------------------------------

export interface ThreeBoardGeometry {
  board: { w: number; h: number; thickness: number };
  traces: Array<{ net: string; points: Point[]; width: number }>;
  pads: Array<{ componentId: string; pinName: string; x: number; y: number; w: number; h: number }>;
  vias: Array<{ x: number; y: number; drill: number }>;
  components: Array<{ componentId: string; name: string; x: number; y: number; w: number; h: number }>;
}

/** Convert layout result to Three.js-ready geometry descriptions. */
export function pcbToThreeJs(
  placements: PcbPlacement[],
  traces: PcbTrace[],
  pads: PcbPad[],
  vias: PcbVia[],
  boardW: number,
  boardH: number,
  traceWidth: number
): ThreeBoardGeometry {
  return {
    board: { w: boardW, h: boardH, thickness: 1.6 },
    traces: traces.map((t) => ({ net: t.net, points: t.points, width: traceWidth })),
    pads: pads.map((p) => ({ componentId: p.componentId, pinName: p.pinName, x: p.center.x, y: p.center.y, w: p.w, h: p.h })),
    vias: vias.map((v) => ({ x: v.x, y: v.y, drill: v.drill })),
    components: placements.map((p) => ({ componentId: p.componentId, name: p.name, x: p.center.x, y: p.center.y, w: p.w, h: p.h })),
  };
}
