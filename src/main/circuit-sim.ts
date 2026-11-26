/**
 * Circuit simulation feasibility spike — Blueprint PC.
 *
 * Pure TypeScript, zero imports, zero Node modules. Implements a Modified Nodal
 * Analysis (MNA) solver with dense Gaussian elimination, Newton-Raphson for
 * nonlinear devices (diodes/LEDs), and backward-Euler transient analysis.
 *
 * Feasibility spike: proves DC operating point and transient simulation work on
 * small circuits (<50 nodes) entirely client-side. Not a full SPICE replacement
 * — no BJT/MOSFET/BSIM models, no AC analysis, no adaptive timestep.
 *
 * DesignSpec mapping:
 *   - components with category "Resistor" → Resistor element
 *   - components with category "LED" or "Output" → Diode element (Shockley)
 *   - components with category "Power" → VoltageSource element (5V default)
 *   - components with category "Passive"/"Sensor"/"Display"/etc. → skipped (placeholder)
 *   - connections with net names → electrical nodes (same net = same node)
 *   - net "GND" or connection kind "ground" → reference node (0V)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CircuitNode {
  id: string;
  name: string;
  isGround: boolean;
}

export interface CircuitElement {
  id: string;
  type: 'resistor' | 'diode' | 'voltageSource' | 'capacitor' | 'inductor';
  /** Node indices into the node list (non-ground only for matrix stamps). */
  posNode: number; // index into CircuitNode[] (positive terminal)
  negNode: number; // index into CircuitNode[] (negative terminal, -1 if ground)
  value: number; // resistance (Ω), saturation current (A), voltage (V), capacitance (F), inductance (H)
}

export interface SimOptions {
  /** DC convergence tolerance. */
  vTol: number;
  /** Max Newton-Raphson iterations. */
  maxIter: number;
  /** GMIN conductance added to every node self-admittance (S). */
  gmin: number;
  /** Thermal voltage (V) for diode equation. */
  vt: number;
}

export interface DcResult {
  nodeVoltages: Map<string, number>;
  converged: boolean;
  iterations: number;
  message: string;
}

export interface TransientResult {
  timePoints: number[];
  nodeVoltagesOverTime: Map<string, number[]>;
  converged: boolean;
}

const DEFAULT_OPTIONS: SimOptions = {
  vTol: 1e-6,
  maxIter: 100,
  gmin: 1e-12,
  vt: 0.026,
};

// ---------------------------------------------------------------------------
// Netlist parsing
// ---------------------------------------------------------------------------

const DEFAULT_RESISTANCE = 1000; // 1 kΩ placeholder
const DEFAULT_VOLTAGE = 5.0; // 5 V default for power components
const DEFAULT_CAPACITANCE = 1e-6; // 1 µF placeholder
const DEFAULT_INDUCTANCE = 1e-3; // 1 mH placeholder

const DIODE_IS = 5e-36; // saturation current (A)
const DIODE_VF = 0.7;   // forward voltage (V), below which diode is off
const DIODE_RS = 100.0; // series resistance (ohms), above Vf

/** Map a component category to an element type, or null if unsupported. */
function categoryToElementType(category: string): 'resistor' | 'diode' | 'voltageSource' | 'capacitor' | 'inductor' | null {
  const c = category.toLowerCase();
  if (c === 'resistor' || c === 'passive') return 'resistor';
  if (c === 'capacitor') return 'capacitor';
  if (c === 'inductor') return 'inductor';
  if (c === 'led' || c === 'output' || c === 'actuator') return 'diode';
  if (c === 'power') return 'voltageSource';
  if (c === 'sensor' || c === 'display') return 'resistor'; // placeholder
  return null;
}

/** Parse DesignSpec into nodes + elements. Net names define electrical nodes. */
export function parseNetlist(
  components: Array<{ id: string; name: string; category: string; pins: string[] }>,
  connections: Array<{ from: { componentId: string; pin: string }; to: { componentId: string; pin: string }; kind: string; net?: string }>
): { nodes: CircuitNode[]; elements: CircuitElement[]; nodeIndex: Map<string, number> } {
  // Collect all pin references with their net names.
  // Key: "componentId:pinName" → net name or auto-generated node id.
  const pinToNet = new Map<string, string>();
  const netToPins = new Map<string, Array<{ componentId: string; pin: string }>>();

  let autoNodeCounter = 0;
  const autoNode = () => `auto_${autoNodeCounter++}`;

  for (const conn of connections) {
    const net = conn.net ?? autoNode();
    const fromKey = `${conn.from.componentId}:${conn.from.pin}`;
    const toKey = `${conn.to.componentId}:${conn.to.pin}`;
    pinToNet.set(fromKey, net);
    pinToNet.set(toKey, net);
    if (!netToPins.has(net)) netToPins.set(net, []);
    netToPins.get(net)!.push({ componentId: conn.from.componentId, pin: conn.from.pin });
    netToPins.get(net)!.push({ componentId: conn.to.componentId, pin: conn.to.pin });
  }

  // Assign node indices. Ground nets (net "GND" or kind "ground") are node 0.
  const nodeIndex = new Map<string, number>();
  const nodes: CircuitNode[] = [];
  let groundIndex = -1;

  const nets = Array.from(netToPins.keys());
  for (let i = 0; i < nets.length; i++) {
    const net = nets[i];
    const isGround = net.toUpperCase() === 'GND';
    const idx = nodes.length;
    nodeIndex.set(net, idx);
    nodes.push({ id: net, name: net, isGround });
    if (isGround) groundIndex = idx;
  }

  // If no explicit ground, create one.
  if (groundIndex === -1) {
    groundIndex = nodes.length;
    nodeIndex.set('GND', groundIndex);
    nodes.push({ id: 'GND', name: 'GND', isGround: true });
  }

  // Build elements from components that have pins connected to nets.
  const elements: CircuitElement[] = [];
  let elemCounter = 0;

  for (const comp of components) {
    const type = categoryToElementType(comp.category);
    if (!type) continue;

    // Find connected pins for this component.
    const connectedPins: Array<{ pin: string; nodeIdx: number }> = [];
    for (const pin of comp.pins) {
      const key = `${comp.id}:${pin}`;
      const net = pinToNet.get(key);
      if (net) {
        connectedPins.push({ pin, nodeIdx: nodeIndex.get(net)! });
      }
    }

    if (connectedPins.length < 2) continue; // Need at least 2 connections to form an element.

    const value =
      type === 'resistor' ? DEFAULT_RESISTANCE :
      type === 'diode' ? DIODE_IS :
      type === 'voltageSource' ? DEFAULT_VOLTAGE :
      type === 'capacitor' ? DEFAULT_CAPACITANCE :
      DEFAULT_INDUCTANCE;

    elements.push({
      id: `elem_${elemCounter++}`,
      type,
      posNode: connectedPins[0].nodeIdx,
      negNode: connectedPins[1].nodeIdx,
      value,
    });
  }

  return { nodes, elements, nodeIndex };
}

// ---------------------------------------------------------------------------
// MNA system builder
// ---------------------------------------------------------------------------

/** Build MNA matrices [G B; Bᵀ 0] × [V; I_vs] = [I_src; V_vs].
 *
 * Returns { A: dense matrix (n+m)×(n+m), b: RHS vector (n+m), vsourceCount: m,
 * nodeCount: n } where n = non-ground nodes, m = voltage sources.
 */
export function buildMnaSystem(nodes: CircuitNode[], elements: CircuitElement[], options: SimOptions = DEFAULT_OPTIONS): {
  A: number[][];
  b: number[];
  nodeCount: number;
  vsourceCount: number;
  vsourceNodeMap: Map<number, number>; // matrix row index → element index
} {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const nonGroundNodes = nodes.filter((n) => !n.isGround);
  const n = nonGroundNodes.length;
  const vsources = elements.filter((e) => e.type === 'voltageSource');
  const m = vsources.length;
  const size = n + m;

  // Map node index → matrix row (ground excluded).
  const nodeToRow = new Map<number, number>();
  let row = 0;
  for (const node of nonGroundNodes) {
    nodeToRow.set(nodes.indexOf(node), row);
    row++;
  }

  // Map voltage source → matrix column/row index.
  const vsourceToCol = new Map<number, number>();
  const vsourceNodeMap = new Map<number, number>();
  for (let i = 0; i < m; i++) {
    vsourceToCol.set(elements.indexOf(vsources[i]), n + i);
    vsourceNodeMap.set(n + i, i);
  }

  const A: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
  const b: number[] = Array(size).fill(0);

  const g = opts.gmin;

  // Add GMIN to every non-ground node self-admittance.
  for (const node of nonGroundNodes) {
    const r = nodeToRow.get(nodes.indexOf(node))!;
    A[r][r] += g;
  }

  // Stamp resistors: G[pos][pos] += 1/R, G[neg][neg] += 1/R, G[pos][neg] -= 1/R, G[neg][pos] -= 1/R
  // Ground (negNode === groundIndex) skips the ground row/col.
  const groundIdx = nodes.findIndex((n) => n.isGround);
  for (const el of elements) {
    if (el.type === 'resistor') {
      const conductance = 1 / el.value;
      const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
      const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
      if (posRow !== undefined && posRow !== -1) {
        A[posRow][posRow] += conductance;
        if (negRow !== undefined && negRow !== -1) {
          A[posRow][negRow] -= conductance;
          A[negRow][posRow] -= conductance;
          A[negRow][negRow] += conductance;
        }
      } else if (negRow !== undefined && negRow !== -1) {
        A[negRow][negRow] += conductance;
      }
    } else if (el.type === 'voltageSource') {
      const col = vsourceToCol.get(elements.indexOf(el))!;
      const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
      const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
      // Voltage source fixes V_pos - V_neg = value.
      if (posRow !== undefined && posRow !== -1) {
        A[posRow][col] += 1;
        A[col][posRow] += 1;
      }
      if (negRow !== undefined && negRow !== -1) {
        A[negRow][col] -= 1;
        A[col][negRow] -= 1;
      }
      b[col] = el.value;
    } else if (el.type === 'diode') {
      // Nonlinear: handled in Newton-Raphson via Jacobian. For the base MNA,
      // we stamp a placeholder conductance (GMIN) — the NR loop re-stamps.
      const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
      const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
      if (posRow !== undefined && posRow !== -1) {
        A[posRow][posRow] += g;
        if (negRow !== undefined && negRow !== -1) {
          A[posRow][negRow] -= g;
          A[negRow][posRow] -= g;
          A[negRow][negRow] += g;
        }
      } else if (negRow !== undefined && negRow !== -1) {
        A[negRow][negRow] += g;
      }
    } else if (el.type === 'capacitor') {
      // DC: open circuit. GMIN only.
      const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
      const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
      if (posRow !== undefined && posRow !== -1) {
        A[posRow][posRow] += g;
        if (negRow !== undefined && negRow !== -1) {
          A[posRow][negRow] -= g;
          A[negRow][posRow] -= g;
          A[negRow][negRow] += g;
        }
      } else if (negRow !== undefined && negRow !== -1) {
        A[negRow][negRow] += g;
      }
    } else if (el.type === 'inductor') {
      // DC: short circuit (0Ω) → just conductance, no voltage stamp.
      const conductance = 1 / Math.max(el.value, 1e-9);
      const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
      const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
      if (posRow !== undefined && posRow !== -1) {
        A[posRow][posRow] += conductance;
        if (negRow !== undefined && negRow !== -1) {
          A[posRow][negRow] -= conductance;
          A[negRow][posRow] -= conductance;
          A[negRow][negRow] += conductance;
        }
      } else if (negRow !== undefined && negRow !== -1) {
        A[negRow][negRow] += conductance;
      }
    }
  }

  return { A, b, nodeCount: n, vsourceCount: m, vsourceNodeMap };
}

// ---------------------------------------------------------------------------
// Linear solver
// ---------------------------------------------------------------------------

/** Gaussian elimination with partial pivoting. Solves Ax = b. Returns x or null if singular. */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  // Augmented matrix.
    const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot: find row with max abs value in this column.
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row][col]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = row;
      }
    }
    if (maxVal < 1e-15) return null; // Singular.

    // Swap rows.
    if (maxRow !== col) {
      const tmp = M[col];
      M[col] = M[maxRow];
      M[maxRow] = tmp;
    }

    // Eliminate below.
    const pivot = M[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / pivot;
      for (let k = col; k <= n; k++) {
        M[row][k] -= factor * M[col][k];
      }
    }
  }

  // Back substitution.
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * x[j];
    }
    x[i] = sum / M[i][i];
  }
  return x;
}

// ---------------------------------------------------------------------------
// Diode (Shockley) model for Newton-Raphson
// ---------------------------------------------------------------------------

/** Diode current: piecewise linear model.
 * Below Vf: I = 0 (off). Above Vf: I = (Vd - Vf) / Rs.
 */
function diodeCurrent(v: number): number {
  if (v < DIODE_VF) return 0;
  return (v - DIODE_VF) / DIODE_RS;
}

/** Diode conductance: dI/dV = 1/Rs above Vf, 0 below. */
function diodeConductance(v: number): number {
  if (v < DIODE_VF) return DIODE_IS; // tiny leakage below Vf
  return 1.0 / DIODE_RS;
}

// ---------------------------------------------------------------------------
// DC operating point with Newton-Raphson
// ---------------------------------------------------------------------------

/** Solve DC operating point. Handles linear circuits in one iteration;
 * nonlinear (diode) circuits via Newton-Raphson with Jacobian re-stamping. */
export function solveDc(
  nodes: CircuitNode[],
  elements: CircuitElement[],
  options: SimOptions = DEFAULT_OPTIONS
): DcResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const nonGroundNodes = nodes.filter((n) => !n.isGround);
  const n = nonGroundNodes.length;
  const vsources = elements.filter((e) => e.type === 'voltageSource');
  const m = vsources.length;
  const size = n + m;

  if (size === 0) {
    return {
      nodeVoltages: new Map(),
      converged: true,
      iterations: 0,
      message: 'No non-ground nodes to solve.',
    };
  }

  const groundIdx = nodes.findIndex((nd) => nd.isGround);
  const nodeToRow = new Map<number, number>();
  let row = 0;
  for (const node of nonGroundNodes) {
    nodeToRow.set(nodes.indexOf(node), row);
    row++;
  }

  // Initial guess: half the max source voltage everywhere, except nodes tied
  // to a voltage source start at the source voltage, and voltage-source
  // current entries start at 0. Diode anodes start at 0.5V (safe, low current)
  // to avoid the first NR step swinging into diode overflow.
  let maxSourceV = 0;
  for (const el of elements) {
    if (el.type === 'voltageSource' && el.value > maxSourceV) {
      maxSourceV = el.value;
    }
  }
  const initV = maxSourceV / 2;
  let voltages = new Array(size).fill(initV);
  // Voltage-source currents start at 0.
  for (let i = 0; i < m; i++) {
    voltages[n + i] = 0;
  }
  for (const el of elements) {
    if (el.type === 'voltageSource' && el.posNode !== groundIdx) {
      const r = nodeToRow.get(el.posNode);
      if (r !== undefined) voltages[r] = el.value;
    }
    // Diode anodes: start at 0.5V (safe, low current for Is=1e-12)
    if (el.type === 'diode' && el.posNode !== groundIdx) {
      const r = nodeToRow.get(el.posNode);
      if (r !== undefined) voltages[r] = 0.5;
    }
  }

  const vsourceToCol = new Map<number, number>();
  for (let i = 0; i < m; i++) {
    vsourceToCol.set(elements.indexOf(vsources[i]), n + i);
  }

  let converged = false;
  let iterations = 0;

  for (let iter = 0; iter < opts.maxIter; iter++) {
    iterations = iter + 1;

    // Build Jacobian and RHS for this iteration.
    const A: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
    const b: number[] = Array(size).fill(0);
    const g = opts.gmin;

    // GMIN on every non-ground node.
    for (const node of nonGroundNodes) {
      const r = nodeToRow.get(nodes.indexOf(node))!;
      A[r][r] += g;
    }

    for (const el of elements) {
      if (el.type === 'resistor') {
        const conductance = 1 / el.value;
        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        if (posRow !== undefined && posRow !== -1) {
          A[posRow][posRow] += conductance;
          if (negRow !== undefined && negRow !== -1) {
            A[posRow][negRow] -= conductance;
            A[negRow][posRow] -= conductance;
            A[negRow][negRow] += conductance;
          }
        } else if (negRow !== undefined && negRow !== -1) {
          A[negRow][negRow] += conductance;
        }
      } else if (el.type === 'voltageSource') {
        const col = vsourceToCol.get(elements.indexOf(el))!;
        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        if (posRow !== undefined && posRow !== -1) {
          A[posRow][col] += 1;
          A[col][posRow] += 1;
        }
        if (negRow !== undefined && negRow !== -1) {
          A[negRow][col] -= 1;
          A[col][negRow] -= 1;
        }
        b[col] = el.value;
      } else if (el.type === 'diode') {
        // Nonlinear: current depends on node voltages.
        const vPos = el.posNode === groundIdx ? 0 : voltages[nodeToRow.get(el.posNode)!];
        const vNeg = el.negNode === groundIdx ? 0 : voltages[nodeToRow.get(el.negNode)!];
        const vd = vPos - vNeg;
        const iD = diodeCurrent(vd);
        const gD = diodeConductance(vd);

        // Newton-Raphson linearization:
        // iD(Vd) ≈ iD_k + gD_k × (Vd - Vd_k) = gD_k × Vd + (iD_k - gD_k × Vd_k)
        // KCL at pos: current leaving through diode + resistor = 0
        // (1/R)×(V_pos - V_src) + gD_k×Vd + (iD_k - gD_k×Vd_k) = 0
        // b[posRow] = gD_k × Vd_k - iD_k   (moved to RHS)
        // b[negRow] = iD_k - gD_k × Vd_k
        const iDLinearized = iD - gD * vd; // iD_k - gD_k × Vd_k
        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        if (posRow !== undefined && posRow !== -1) {
          b[posRow] += -iDLinearized; // = gD_k × Vd_k - iD_k
          A[posRow][posRow] += gD;
          if (negRow !== undefined && negRow !== -1) {
            A[posRow][negRow] -= gD;
          }
        }
        if (negRow !== undefined && negRow !== -1) {
          b[negRow] += iDLinearized; // = iD_k - gD_k × Vd_k
          A[negRow][negRow] += gD;
          if (posRow !== undefined && posRow !== -1) {
            A[negRow][posRow] -= gD;
          }
        }
      } else if (el.type === 'capacitor') {
        // DC: open circuit (GMIN only).
        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        if (posRow !== undefined && posRow !== -1) {
          A[posRow][posRow] += g;
          if (negRow !== undefined && negRow !== -1) {
            A[posRow][negRow] -= g;
            A[negRow][posRow] -= g;
            A[negRow][negRow] += g;
          }
        } else if (negRow !== undefined && negRow !== -1) {
          A[negRow][negRow] += g;
        }
      } else if (el.type === 'inductor') {
        // DC: short.
        const conductance = 1 / Math.max(el.value, 1e-9);
        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        if (posRow !== undefined && posRow !== -1) {
          A[posRow][posRow] += conductance;
          if (negRow !== undefined && negRow !== -1) {
            A[posRow][negRow] -= conductance;
            A[negRow][posRow] -= conductance;
            A[negRow][negRow] += conductance;
          }
        } else if (negRow !== undefined && negRow !== -1) {
          A[negRow][negRow] += conductance;
        }
      }
    }

    // Solve Newton-Raphson step: A × ΔV = b − A·V (residual).
    // For linear circuits, one iteration gives the exact solution.
    const AV = new Array(size).fill(0);
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let j = 0; j < size; j++) {
        sum += A[i][j] * voltages[j];
      }
      AV[i] = sum;
    }
    const residual = new Array(size);
    for (let i = 0; i < size; i++) {
      residual[i] = b[i] - AV[i];
    }
    const delta = solveLinearSystem(A, residual);
    if (delta === null) {
      return {
        nodeVoltages: new Map(),
        converged: false,
        iterations,
        message: 'Singular matrix — possible floating node or voltage-source conflict.',
      };
    }

    let maxChange = 0;
    for (let i = 0; i < size; i++) {
      // Under-relaxation (damping 0.6) helps Newton-Raphson converge on
      // stiff nonlinear circuits (diodes/LEDs). Voltage limiting prevents
      // the diode exponential from overflowing on the first iteration.
      const MAX_STEP = 1.0; // max volts per iteration
      let step = 0.6 * delta[i];
      step = Math.max(-MAX_STEP, Math.min(MAX_STEP, step));
      voltages[i] += step;
      if (Math.abs(step) > maxChange) maxChange = Math.abs(step);
    }
    if (maxChange < opts.vTol) {
      converged = true;
      break;
    }
  }

  const nodeVoltages = new Map<string, number>();
  for (const node of nonGroundNodes) {
    const r = nodeToRow.get(nodes.indexOf(node))!;
    nodeVoltages.set(node.id, voltages[r]);
  }
  // Ground is 0V.
  const groundNode = nodes.find((nd) => nd.isGround);
  if (groundNode) nodeVoltages.set(groundNode.id, 0);

  if (!converged) {
    return {
      nodeVoltages,
      converged: false,
      iterations,
      message: `Did not converge after ${opts.maxIter} iterations.`,
    };
  }

  return {
    nodeVoltages,
    converged: true,
    iterations,
    message: `Converged in ${iterations} iteration${iterations === 1 ? '' : 's'}.`,
  };
}

// ---------------------------------------------------------------------------
// Transient analysis (backward Euler)
// ---------------------------------------------------------------------------

/** Run transient analysis from t=0 to tEnd with step dt.
 * Uses backward Euler: (G + C/dt) × x[n+1] = b + (C/dt) × x[n].
 * Capacitors contribute history terms; inductors contribute history terms.
 * Nonlinear diodes handled via Newton-Raphson at each timestep.
 */
export function runTransient(
  nodes: CircuitNode[],
  elements: CircuitElement[],
  tEnd: number,
  dt: number,
  options: SimOptions = DEFAULT_OPTIONS
): TransientResult {
  const nonGroundNodes = nodes.filter((n) => !n.isGround);
  const n = nonGroundNodes.length;
  const vsources = elements.filter((e) => e.type === 'voltageSource');
  const m = vsources.length;
  const size = n + m;

  const groundIdx = nodes.findIndex((nd) => nd.isGround);
  const nodeToRow = new Map<number, number>();
  let row = 0;
  for (const node of nonGroundNodes) {
    nodeToRow.set(nodes.indexOf(node), row);
    row++;
  }
  const vsourceToCol = new Map<number, number>();
  for (let i = 0; i < m; i++) {
    vsourceToCol.set(elements.indexOf(vsources[i]), n + i);
  }

  // State: capacitor voltages and inductor currents (history terms).
  // Keyed by element index.
  const capVoltage = new Map<number, number>(); // element index → voltage across cap
  const indCurrent = new Map<number, number>(); // element index → current through inductor
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.type === 'capacitor') capVoltage.set(i, 0);
    if (el.type === 'inductor') indCurrent.set(i, 0);
  }

  const steps = Math.ceil(tEnd / dt);

  const timePoints: number[] = [];
  const nodeVoltagesOverTime = new Map<string, number[]>();
  for (const node of nonGroundNodes) {
    nodeVoltagesOverTime.set(node.id, []);
  }
  const groundNode = nodes.find((nd) => nd.isGround);
  if (groundNode) nodeVoltagesOverTime.set(groundNode.id, []);

  let converged = true;

  let voltages = new Array(size).fill(0);

  for (let step = 0; step <= steps; step++) {
    const t = step * dt;
    timePoints.push(t);

    // Record voltages.
    for (const node of nonGroundNodes) {
      const r = nodeToRow.get(nodes.indexOf(node))!;
      nodeVoltagesOverTime.get(node.id)!.push(voltages[r]);
    }
    if (groundNode) nodeVoltagesOverTime.get(groundNode.id)!.push(0);

    if (step === steps) break;

    // Build MNA system for this timestep.
    const A: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
    const b: number[] = Array(size).fill(0);
    const g = options?.gmin ?? DEFAULT_OPTIONS.gmin;

    for (const node of nonGroundNodes) {
      const r = nodeToRow.get(nodes.indexOf(node))!;
      A[r][r] += g;
    }

    for (let ei = 0; ei < elements.length; ei++) {
      const el = elements[ei];
      if (el.type === 'resistor') {
        const conductance = 1 / el.value;
        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        if (posRow !== undefined && posRow !== -1) {
          A[posRow][posRow] += conductance;
          if (negRow !== undefined && negRow !== -1) {
            A[posRow][negRow] -= conductance;
            A[negRow][posRow] -= conductance;
            A[negRow][negRow] += conductance;
          }
        } else if (negRow !== undefined && negRow !== -1) {
          A[negRow][negRow] += conductance;
        }
      } else if (el.type === 'voltageSource') {
        const col = vsourceToCol.get(elements.indexOf(el))!;
        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        if (posRow !== undefined && posRow !== -1) {
          A[posRow][col] += 1;
          A[col][posRow] += 1;
        }
        if (negRow !== undefined && negRow !== -1) {
          A[negRow][col] -= 1;
          A[col][negRow] -= 1;
        }
        b[col] = el.value;
      } else if (el.type === 'diode') {
        const vPos = el.posNode === groundIdx ? 0 : voltages[nodeToRow.get(el.posNode)!];
        const vNeg = el.negNode === groundIdx ? 0 : voltages[nodeToRow.get(el.negNode)!];
        const vd = vPos - vNeg;
        const gD = diodeConductance(vd);
        const iD = diodeCurrent(vd) - gD * vd; // linearized current source

        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        if (posRow !== undefined && posRow !== -1) {
          b[posRow] -= iD;
          A[posRow][posRow] += gD;
          if (negRow !== undefined && negRow !== -1) {
            A[posRow][negRow] -= gD;
          }
        }
        if (negRow !== undefined && negRow !== -1) {
          b[negRow] += iD;
          A[negRow][negRow] += gD;
          if (posRow !== undefined && posRow !== -1) {
            A[negRow][posRow] -= gD;
          }
        }
      } else if (el.type === 'capacitor') {
        // Backward Euler: I = C × dV/dt ≈ C × (v[n+1] - v[n]) / dt
        // Equivalent: conductance C/dt in parallel with current source C×v[n]/dt
        // flowing INTO the positive terminal from the history model.
        const vCap = capVoltage.get(ei) ?? 0;
        const gc = el.value / dt;
        const histCurrent = gc * vCap;

        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        if (posRow !== undefined && posRow !== -1) {
          A[posRow][posRow] += gc;
          b[posRow] += histCurrent;
          if (negRow !== undefined && negRow !== -1) {
            A[posRow][negRow] -= gc;
            A[negRow][posRow] -= gc;
            b[negRow] -= histCurrent;
            A[negRow][negRow] += gc;
          }
        } else if (negRow !== undefined && negRow !== -1) {
          A[negRow][negRow] += gc;
          b[negRow] -= histCurrent;
        }
        // Update history after solving (will be set after this step).
      } else if (el.type === 'inductor') {
        // Backward Euler: V = L × dI/dt ≈ L × (i[n+1] - i[n]) / dt
        // Equivalent: conductance dt/L in series with voltage source L×i[n]/dt.
        const iL = indCurrent.get(ei) ?? 0;
        const gl = dt / el.value;

        // Treat as resistor with conductance gl between pos and neg,
        // plus a voltage source of histVoltage in series.
        // Simplified: stamp as resistor + modify b.
        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        if (posRow !== undefined && posRow !== -1) {
          A[posRow][posRow] += gl;
          b[posRow] += iL;
          if (negRow !== undefined && negRow !== -1) {
            A[posRow][negRow] -= gl;
            A[negRow][posRow] -= gl;
            b[negRow] -= iL;
            A[negRow][negRow] += gl;
          }
        } else if (negRow !== undefined && negRow !== -1) {
          A[negRow][negRow] += gl;
          b[negRow] -= iL;
        }
      }
    }

    // Compute residual = b − A·V for Newton step.
    const AV = new Array(size).fill(0);
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let j = 0; j < size; j++) {
        sum += A[i][j] * voltages[j];
      }
      AV[i] = sum;
    }
    const residual = new Array(size);
    for (let i = 0; i < size; i++) {
      residual[i] = b[i] - AV[i];
    }
    const delta = solveLinearSystem(A, residual);
    if (delta === null) {
      converged = false;
      break;
    }

    let maxChange = 0;
    for (let i = 0; i < size; i++) {
      voltages[i] += delta[i];
      if (Math.abs(delta[i]) > maxChange) maxChange = Math.abs(delta[i]);
    }

    // Update capacitor voltages and inductor currents.
    for (let ei = 0; ei < elements.length; ei++) {
      const el = elements[ei];
      if (el.type === 'capacitor') {
        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        const vPos = posRow !== -1 ? voltages[posRow!] : 0;
        const vNeg = negRow !== -1 ? voltages[negRow!] : 0;
        capVoltage.set(ei, vPos - vNeg);
      }
      if (el.type === 'inductor') {
        const posRow = el.posNode === groundIdx ? -1 : nodeToRow.get(el.posNode);
        const negRow = el.negNode === groundIdx ? -1 : nodeToRow.get(el.negNode);
        const vPos = posRow !== -1 ? voltages[posRow!] : 0;
        const vNeg = negRow !== -1 ? voltages[negRow!] : 0;
        // Approximate inductor current from voltage / conductance.
        indCurrent.set(ei, (vPos - vNeg) * el.value / dt);
      }
    }
  }

  return { timePoints, nodeVoltagesOverTime, converged };
}

// ---------------------------------------------------------------------------
// Convenience: full DC simulation from raw DesignSpec arrays
// ---------------------------------------------------------------------------

export interface SimCircuitInput {
  components: Array<{ id: string; name: string; category: string; pins: string[] }>;
  connections: Array<{ from: { componentId: string; pin: string }; to: { componentId: string; pin: string }; kind: string; net?: string }>;
}

/** Run DC simulation on a DesignSpec-shaped input. Returns node voltages. */
export function simulateDc(input: SimCircuitInput, options?: SimOptions): DcResult {
  const { nodes, elements } = parseNetlist(input.components, input.connections);
  return solveDc(nodes, elements, options);
}

/** Run transient simulation on a DesignSpec-shaped input. */
export function simulateTransient(
  input: SimCircuitInput,
  tEnd: number,
  dt: number,
  options?: SimOptions
): TransientResult {
  const { nodes, elements } = parseNetlist(input.components, input.connections);
  return runTransient(nodes, elements, tEnd, dt, options);
}
