/**
 * Signal integrity analysis: pure functions for microstrip impedance,
 * crosstalk estimation, and propagation delay.
 *
 * All formulas are simplified first-order approximations suitable for
 * early-stage design review. They are not a substitute for a full-field
 * solver (e.g. HyperLynx, Si8000) but give designers directional guidance
 * during layout.
 *
 * Formulas:
 *   - Microstrip Z0: IPC-2141 / Hammerstad approximation
 *   - Effective dielectric constant: Hammerstad
 *   - Propagation delay: tpd = sqrt(ee) / c
 *   - Crosstalk: simplified coupled transmission line model
 */

import type {
  CrosstalkPair,
  CrosstalkResult,
  DielectricStackup,
  ImpedanceResult,
  MicrostripTrace,
  SiTraceResult
} from '@shared/types'

const SPEED_OF_LIGHT_MM_PER_NS = 299.792458 // mm/ns

// ---------------------------------------------------------------------------
// Microstrip impedance (IPC-2141 / Hammerstad)
// ---------------------------------------------------------------------------

/** Copper thickness in mm per oz. */
const COPPER_MM_PER_OZ = 0.035

function copperThicknessMm(copperOz: number): number {
  return copperOz * COPPER_MM_PER_OZ
}

/** Effective dielectric constant for a microstrip. */
function effectiveDielectricConstant(trace: MicrostripTrace): number {
  const er = trace.er
  const h = trace.heightMm
  const w = trace.widthMm

  // Hammerstad formula for effective permittivity
  const ratio = w / h
  const ee = (er + 1) / 2 + (er - 1) / 2 *
    (1 / Math.sqrt(1 + 12 * h / w) + 0.04 * (1 - ratio) * (1 - ratio))
  return ee
}

/** Characteristic impedance of a microstrip trace (ohms). */
export function microstripImpedance(trace: MicrostripTrace): ImpedanceResult {
  const h = trace.heightMm
  const w = trace.widthMm
  const t = copperThicknessMm(trace.copperOz)

  const ee = effectiveDielectricConstant(trace)

  // Hammerstad impedance formula
  const ratio = w / h
  let z0: number
  if (ratio <= 1) {
    z0 = 60 / Math.sqrt(ee) * Math.log(8 * h / (w + t) + w / (4 * (h + t)))
  } else {
    z0 = 120 * Math.PI / (Math.sqrt(ee) *
      (w / h + 1.393 + 0.667 * Math.log(w / h + 1.444)))
  }

  const delayNsPerMm = Math.sqrt(ee) / SPEED_OF_LIGHT_MM_PER_NS

  return { z0Ohms: z0, effectiveEr: ee, delayNsPerMm }
}

/** Analyse a single trace: impedance, delay, and optional crosstalk. */
export function analyseTrace(args: {
  traceWidthMm: number
  traceLengthMm: number
  stackup: DielectricStackup
  targetImpedanceOhms?: number
  aggressorTrace?: CrosstalkPair
}): SiTraceResult {
  const trace: MicrostripTrace = {
    widthMm: args.traceWidthMm,
    copperOz: args.stackup.copperOz,
    heightMm: args.stackup.thicknessMm,
    er: args.stackup.er
  }

  const impedance = microstripImpedance(trace)
  const tolerancePercent = args.targetImpedanceOhms
    ? Math.abs((impedance.z0Ohms - args.targetImpedanceOhms) / args.targetImpedanceOhms) * 100
    : 0

  const result: SiTraceResult = {
    traceWidthMm: args.traceWidthMm,
    traceLengthMm: args.traceLengthMm,
    impedance,
    withinTolerance: tolerancePercent <= 10,
    tolerancePercent
  }

  if (args.aggressorTrace) {
    result.crosstalk = estimateCrosstalk(args.aggressorTrace)
  }

  return result
}

// ---------------------------------------------------------------------------
// Crosstalk estimation (simplified coupled microstrip)
// ---------------------------------------------------------------------------

/** Estimate near-end and far-end crosstalk for two parallel traces. */
export function estimateCrosstalk(pair: CrosstalkPair): CrosstalkResult {
  const h = pair.heightMm
  const w = pair.widthMm
  const s = pair.separationMm
  const lengthMm = pair.lengthMm
  const riseTimeNs = pair.riseTimeNs

  // Simplified coupling coefficient based on trace geometry.
  // Closer spacing and wider traces increase coupling.
  // This is a first-order approximation; a real solver uses coupled-mode theory.
  const wOverH = w / h
  const sOverH = s / h

  // Coupling factor decreases exponentially with separation/height ratio.
  const coupling = Math.exp(-sOverH / 1.5) * (0.3 + 0.2 * Math.min(wOverH, 2))

  // Near-end crosstalk: proportional to coupling, limited by rise time.
  const nextFraction = coupling * Math.min(1, lengthMm / (riseTimeNs * 150))

  // Far-end crosstalk: proportional to coupling and length, limited by rise time.
  const fextFraction = coupling * Math.min(1, lengthMm / (riseTimeNs * 300)) * 0.5

  return {
    nextFraction: Math.min(1, nextFraction),
    fextFraction: Math.min(1, fextFraction),
    couplingCoefficient: Math.min(1, coupling)
  }
}

// ---------------------------------------------------------------------------
// Propagation delay
// ---------------------------------------------------------------------------

/** Propagation delay for a trace of given length (ns). */
export function propagationDelayNs(ee: number, lengthMm: number): number {
  return Math.sqrt(ee) * lengthMm / SPEED_OF_LIGHT_MM_PER_NS
}

// ---------------------------------------------------------------------------
// Reflection coefficient at a discontinuity
// ---------------------------------------------------------------------------

/** Reflection coefficient at a transition from Z1 to Z2. */
export function reflectionCoefficient(z1Ohms: number, z2Ohms: number): number {
  return (z2Ohms - z1Ohms) / (z2Ohms + z1Ohms)
}
