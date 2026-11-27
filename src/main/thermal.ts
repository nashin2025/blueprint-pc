/**
 * Thermal analysis: pure functions for junction temperature, power
 * dissipation, and thermal resistance estimation.
 *
 * All formulas are simplified first-order approximations suitable for
 * early-stage design review. They are not a substitute for CFD simulation
 * but give designers directional guidance during layout.
 *
 * Formulas:
 *   - Power dissipation: Pd = V * I (or I^2 * R, V^2 / R)
 *   - Junction temperature: Tj = Ta + Pd * Rja
 *   - Maximum allowable power: Pd_max = (Tj_max - Ta) / Rja
 *   - Thermal derating: derating factor = Pd / Pd_max
 */

import type { ThermalResult } from '@shared/types'

// ---------------------------------------------------------------------------
// Thermal resistance lookup by package type
// ---------------------------------------------------------------------------

/** Typical junction-to-ambient thermal resistance (C/W) by package. */
const PACKAGE_RJA: Record<string, number> = {
  'sop-8': 150,
  'dip-8': 85,
  'qfn-20': 45,
  'qfp-64': 60,
  'bga': 30,
  'smd-resistor': 200,
  'smd-capacitor': 200,
  'through-hole-resistor': 170,
  'electrolytic-cap': 85,
  'led': 150,
  'transistor-to-220': 60,
  'mosfet-dpak': 50,
  'default': 100
}

/** Estimate junction-to-ambient thermal resistance for a package. */
export function packageRjaCPerW(packageType: string): number {
  const key = packageType.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return PACKAGE_RJA[key] ?? PACKAGE_RJA['default']
}

// ---------------------------------------------------------------------------
// Power dissipation
// ---------------------------------------------------------------------------

/** Power dissipation from voltage and current: P = V * I. */
export function powerFromVoltageCurrent(voltageV: number, currentA: number): number {
  return Math.abs(voltageV) * Math.abs(currentA)
}

/** Power dissipation from current and resistance: P = I^2 * R. */
export function powerFromCurrentResistance(currentA: number, resistanceOhm: number): number {
  return currentA * currentA * Math.abs(resistanceOhm)
}

/** Power dissipation from voltage and resistance: P = V^2 / R. */
export function powerFromVoltageResistance(voltageV: number, resistanceOhm: number): number {
  return (voltageV * voltageV) / Math.abs(resistanceOhm)
}

// ---------------------------------------------------------------------------
// Junction temperature
// ---------------------------------------------------------------------------

/** Junction temperature: Tj = Ta + Pd * Rja. */
export function junctionTemperature(ambientC: number, powerW: number, rjaCPerW: number): number {
  return ambientC + powerW * rjaCPerW
}

/** Maximum allowable power: Pd_max = (Tj_max - Ta) / Rja. */
export function maxPower(ambientC: number, tJMaxC: number, rjaCPerW: number): number {
  const deltaT = tJMaxC - ambientC
  if (deltaT <= 0) return 0
  return deltaT / rjaCPerW
}

// ---------------------------------------------------------------------------
// Thermal analysis of a component
// ---------------------------------------------------------------------------

/** Analyse a component's thermal status. Returns junction temperature,
 *  maximum allowable power, and derating factor. */
export function analyseComponent(args: {
  ambientC: number
  powerW: number
  tJMaxC: number
  packageType: string
}): ThermalResult {
  const rja = packageRjaCPerW(args.packageType)
  const tJ = junctionTemperature(args.ambientC, args.powerW, rja)
  const pdMax = maxPower(args.ambientC, args.tJMaxC, rja)
  const derating = pdMax > 0 ? Math.min(1, args.powerW / pdMax) : 1

  // Determine status based on derating factor
  let status: 'ok' | 'warning' | 'critical' = 'ok'
  if (derating > 0.9) status = 'critical'
  else if (derating > 0.7) status = 'warning'

  return {
    junctionTemperatureC: tJ,
    maxAllowablePowerW: pdMax,
    deratingFactor: derating,
    rjaCPerW: rja,
    status,
    withinLimits: tJ <= args.tJMaxC
  }
}

// ---------------------------------------------------------------------------
// Board-level thermal estimate
// ---------------------------------------------------------------------------

/** Estimate board temperature rise from total power dissipation.
 *  Uses a simplified board thermal resistance model. */
export function boardTemperatureRise(ambientC: number, totalPowerW: number, boardRjaCPerW: number): number {
  return ambientC + totalPowerW * boardRjaCPerW
}
