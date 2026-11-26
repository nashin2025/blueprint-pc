/**
 * Physical-style layout for a part's pins.
 *
 * The catalogue stores pins as a flat list with a type, a name and a function.
 * That is the *logical* pinout. This module derives the *placement*: where each
 * pin sits on a package outline, so we can draw an interactive board like a real
 * chip diagram instead of a plain table.
 *
 * We do not have true per-package pad coordinates (the source does not supply
 * them), so this is a schematic layout: pins distributed down the two sides of a
 * package body, in order, the way a DIP or a two-row header reads. It is honest
 * about being a diagram, not a manufacturing footprint, and it is stable: the
 * same pin list always produces the same picture.
 *
 * Pure and import-free so the self-check can run it under
 * `--experimental-strip-types`, the same reason `partArt.ts` is pure.
 */

/** Coarse function class for a pin, used to colour it. */
export type PinCategory = 'power' | 'ground' | 'signal' | 'data' | 'unknown'

/** The pin fields this module reads. A subset of CataloguePin, kept local so the
 * module has no imports and the self-check can construct inputs by hand. */
export interface LayoutPin {
  type?: string | null
  label: string
  voltage?: string | null
  function?: string | null
  connectsTo?: string | null
}

/**
 * Classify a pin from its own text.
 *
 * Ground and power are checked before signal, because a pin labelled "GND" or
 * "3V3" is power even though its function text may mention a signal. I2C/SPI/
 * UART pins are data; anything with a GPIO/IO/number label is a generic signal.
 */
export function pinCategory(pin: LayoutPin): PinCategory {
  const text = [pin.type, pin.label, pin.voltage, pin.function]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (/\b(gnd|ground|vss|earth|0v)\b/.test(text)) return 'ground'
  if (/\b(vcc|vin|vdd|vbat|3v3|5v|3\.3|5\.0|power|vbus|avdd|dvdd)\b/.test(text) || /\d+\s?v\b/.test(text)) {
    return 'power'
  }
  if (/\b(sda|scl|mosi|miso|sck|i2c|spi|uart|tx|rx|data|din|dout|ce|cs|dc|rst|reset)\b/.test(text)) {
    return 'data'
  }
  // Generic signal: a GPIO/IO/ADC/A-pin designator. A bare number is NOT enough
  // — "Contact 1" on a passive connector is a terminal, not a signal, and
  // without more text the honest classification is unknown.
  if (/\b(gpio|io\d*|a\d|adc|dac|pwm|in|out|input|output)\b/.test(text)) {
    return 'signal'
  }
  return 'unknown'
}

/** Colour for a category, matching the app's wire-colour tokens. */
export function categoryColor(category: PinCategory): string {
  switch (category) {
    case 'power':
      return '#e0b34a'
    case 'ground':
      return '#8b8b9a'
    case 'data':
      return '#46c79a'
    case 'signal':
      return '#4f8cff'
    default:
      return '#6b6b7a'
  }
}

export interface LaidPin {
  index: number
  category: PinCategory
  color: string
  side: 'left' | 'right'
  /** Contact pad centre. */
  padX: number
  padY: number
  /** Trace line from the label edge to the pad. */
  lineX1: number
  lineY1: number
  lineX2: number
  lineY2: number
  /** Label chip rectangle (top-left + size). */
  labelX: number
  labelY: number
  labelW: number
  labelH: number
}

export interface PackageLayout {
  width: number
  height: number
  board: { x: number; y: number; w: number; h: number }
  pins: LaidPin[]
}

const VIEW_W = 260
const BOARD_W = 104
const ROW_GAP = 24
const PAD_R = 4.5
const LABEL_H = 18
// Sized so a label chip on either side fits inside VIEW_W with a 2px margin:
// boardX = (260-104)/2 = 78; left chip = 78 - LINE_LEN(16) - LABEL_W = 2;
// right edge = 182 + 16 + LABEL_W = 260 - 2. Verified by the self-check.
const LABEL_W = 60
const LINE_LEN = 16
const TOP_PAD = 22

/**
 * Lay out pins down the two sides of a package body.
 *
 * The first half of the pins run down the left side (top to bottom), the second
 * half down the right side, so the list reads in order around the chip. Returns
 * coordinates in a fixed-width viewBox; height grows with pin count.
 */
export function layoutPackage(pins: LayoutPin[]): PackageLayout {
  const n = pins.length
  const leftCount = Math.ceil(n / 2)
  const rows = Math.max(leftCount, n - leftCount, 1)
  const boardX = (VIEW_W - BOARD_W) / 2
  const boardY = TOP_PAD - PAD_R
  const boardH = rows * ROW_GAP
  const height = Math.max(boardH + TOP_PAD + 10, 80)

  const laid: LaidPin[] = pins.map((pin, i) => {
    const isLeft = i < leftCount
    const row = isLeft ? i : i - leftCount
    const padY = TOP_PAD + row * ROW_GAP
    const side: 'left' | 'right' = isLeft ? 'left' : 'right'
    const padX = isLeft ? boardX : boardX + BOARD_W
    const category = pinCategory(pin)

    // Trace line runs from the label chip to the pad, horizontally.
    const lineX1 = isLeft ? padX - LINE_LEN : padX + LINE_LEN
    const lineX2 = padX
    // Label chip sits just beyond the trace line.
    const labelX = isLeft ? padX - LINE_LEN - LABEL_W : padX + LINE_LEN
    const labelY = padY - LABEL_H / 2

    return {
      index: i,
      category,
      color: categoryColor(category),
      side,
      padX,
      padY,
      lineX1,
      lineY1: padY,
      lineX2,
      lineY2: padY,
      labelX,
      labelY,
      labelW: LABEL_W,
      labelH: LABEL_H
    }
  })

  return {
    width: VIEW_W,
    height,
    board: { x: boardX, y: boardY, w: BOARD_W, h: boardH },
    pins: laid
  }
}