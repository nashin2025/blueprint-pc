import type { Component, DesignSpec } from '@shared/types'

/**
 * Prompt construction for the Info tab, kept free of imports so the self-check
 * can assert on it directly. The API calls live in ./info.ts.
 *
 * Every component and every connection goes into both prompts. A render that
 * only shows the "interesting" parts is a render of a different project, and a
 * description that skips half the build is not a description of this one.
 */

function partLabel(c: Component): string {
  return c.partName ?? c.name
}

/** "Arduino Nano D7 -> 220 ohm resistor pin 1" */
export function wiringLine(
  spec: DesignSpec,
  fromId: string,
  fromPin: string,
  toId: string,
  toPin: string
): string {
  const from = spec.components.find((c) => c.id === fromId)
  const to = spec.components.find((c) => c.id === toId)
  if (!from || !to) return ''
  return `${partLabel(from)} ${fromPin} -> ${partLabel(to)} ${toPin}`
}

/** One line per connection, in a stable order, skipping any that cannot resolve. */
export function wiringLines(spec: DesignSpec): string[] {
  return spec.connections
    .map((c) => wiringLine(spec, c.from.componentId, c.from.pin, c.to.componentId, c.to.pin))
    .filter(Boolean)
}

/** One line per component, with the pins the model assigned it. */
export function componentLines(spec: DesignSpec): string[] {
  return spec.components.map((c) => {
    const pins = c.pins.length > 0 ? `, pins: ${c.pins.join(', ')}` : ''
    const qty = c.quantity > 1 ? ` x${c.quantity}` : ''
    const note = c.notes ? ` (${c.notes})` : ''
    return `- ${partLabel(c)}${qty} [${c.category}]${pins}${note}`
  })
}

function joinNames(names: string[]): string {
  if (names.length === 0) return 'a small electronic assembly'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * A prompt tuned for a clean 3D CAD render rather than a photograph.
 *
 * A photograph of a breadboard hides as much as it shows: wires merge, pin
 * headers blur into the background, and a shallow depth of field quietly deletes
 * half the build. A CAD-style render shows the assembly as an object with
 * measurable shape, which is what a parts list is actually describing.
 *
 * Diffusion models have a prompt length ceiling (2000 characters on the NIM
 * FLUX family), and a render with 15 parts and 40 wires described in full gets
 * truncated mid-sentence. So: keep every component name, and let the wiring
 * detail be what gets dropped first, because wires are the least legible thing
 * in a render anyway.
 */
export function imagePromptFor(spec: DesignSpec): string {
  const parts = spec.components.map(partLabel)
  const wires = wiringLines(spec)

  const opening = [
    `Clean 3D CAD render of a finished electronics project called "${spec.title}".`,
    spec.summary || ''
  ]
    .filter(Boolean)
    .join(' ')

  const partsSentence = `The build contains ${parts.length} parts: ${joinNames(parts)}.`
  const wiringSentence = wires.length > 0 ? `Wiring: ${wires.join('; ')}. ` : ''

  const style = [
    `Precise technical product visualisation, three-quarter view from slightly above, orthographic feel, the whole assembly centred and fully in frame.`,
    `Matte materials: a green printed circuit board or a white breadboard, coloured jumper wires, a plain enclosure.`,
    `Soft even studio lighting, plain light grey background, faint contact shadow, crisp edges, everything in focus.`,
    `Every part listed above must be visible in the frame, arranged as a real assembled build.`,
    `No text, no labels, no captions, no watermark, no logos, no people, no hands, no tools, no desk, no clutter.`
  ].join(' ')

  const BUDGET = 1800
  const full = `${opening} ${partsSentence} ${wiringSentence}${style}`
  if (full.length <= BUDGET) return full

  const withoutWires = `${opening} ${partsSentence} ${style}`
  if (withoutWires.length <= BUDGET) return withoutWires

  return `${opening} ${style}`.slice(0, BUDGET)
}

/** System + user messages for the long description. */
export function summaryMessagesFor(spec: DesignSpec): { system: string; user: string } {
  const system = [
    `You write the product description for a build-it-yourself hardware project.`,
    `Write plainly and factually, the way a careful hobbyist documents their own build.`,
    ``,
    `Required structure, exactly this order:`,
    ``,
    `1. A short title line: the project name on its own line.`,
    ``,
    `2. Two paragraphs of prose: what it does, then how it works. Say what it is made of and what building it involves.`,
    ``,
    `3. A section headed exactly "Components and wiring".`,
    ``,
    `4. Under that heading, one line per component, in the order given. Each line must be:`,
    `   <part name> (<category>), <quantity> off. Pins it uses: <list>. Wired: <every connection it takes part in, written as "its pin -> other part's pin">.`,
    `   If a component has no connections, write "Wired: nothing, used as a mechanical part." instead.`,
    ``,
    `Rules:`,
    `- Cover EVERY component. Do not skip any, do not group them, do not summarise. If the list has 12 parts, there are 12 lines.`,
    `- Cover EVERY connection given to you. If two parts share three wires, list all three.`,
    `- Use only the components and connections provided. Never invent a part, a pin or a wire.`,
    `- No em dashes. No marketing language: avoid "seamless", "cutting-edge", "stunning", "game-changer", "delve", "leverage", "landscape", "tapestry".`,
    `- No exclamation marks. No rhetorical questions.`,
    `- Plain text only. No markdown, no bold, no bullet characters other than a plain hyphen at the start of a line.`
  ].join('\n')

  const user = [
    `Project: ${spec.title}`,
    ``,
    `What it does: ${spec.summary || 'not described'}`,
    `Difficulty: ${spec.difficulty}`,
    spec.estimatedTime ? `Estimated build time: ${spec.estimatedTime}` : '',
    ``,
    `COMPONENTS (${spec.components.length}) - cover all of these:`,
    ...componentLines(spec),
    ``,
    `CONNECTIONS (${spec.connections.length}) - every one of these must appear:`,
    ...wiringLines(spec).map((l) => `- ${l}`),
    ``,
    `Assembly steps: ${spec.steps.length}`,
    ``,
    `Write the description now, following the required structure exactly.`
  ]
    .filter(Boolean)
    .join('\n')

  return { system, user }
}