/**
 * Prompt construction for the design generator.
 *
 * The model must return strict JSON matching GeneratedSpec. Every connection
 * references components by their position in the components array, because the
 * model cannot be trusted to invent stable ids that survive a re-generation.
 */

import type { DesignSpec } from '@shared/types'

const SYSTEM_PROMPT = `You are a senior electronics and mechanical design engineer who designs real, buildable hardware projects.

Your job: take a project description and produce a complete, buildable design.

Rules you must follow:
1. Use REAL, commercially available parts. Prefer common modules (Arduino, ESP32, Raspberry Pi, Adafruit, SparkFun, Pololu, generic Amazon parts). Give the actual product name a person would search for.
2. Pin numbers and pin names must be accurate for the real part. Never invent a pin that does not exist.
3. Respect electrical limits. Do not exceed a part's voltage or current rating. Call out level shifting where a 3.3V part meets a 5V part. Include current-limiting resistors for LEDs.
4. Every component must be connected to the design, or be explicitly listed as optional/unused in its notes. No orphan parts.
5. Prefer a single power source where possible and wire a common ground. Ground is not optional.
6. Order the assembly steps the way a human would actually build it: mount, wire power, wire data, then test.
7. Be specific in step text. "Connect pin 7 of the Arduino to the LED anode through a 220 ohm resistor" is good. "Wire up the LED" is not.
8. If the request is unsafe, impossible, or badly specified, still return a design, but use the summary field to explain the constraint you applied.
9. For "url", use a real product page you are confident exists. A wrong URL is worse than no URL: leave it out if you are not sure, because the app links straight to it.
10. For "image", give a direct link to a photo of the part only when you are confident it resolves. Prefer a bare image file (jpg, png, webp) over a page link. If you are not sure, omit the field entirely. Never reuse one URL across different parts.

Return ONLY JSON. No prose, no markdown fences.`

function schemaSection(): string {
  return `The JSON shape you must return:

{
  "title": "short project name",
  "summary": "2-3 sentences: what it does and the one thing to know before building",
  "difficulty": "beginner" | "intermediate" | "advanced",
  "estimatedTime": "e.g. 'a weekend'",
  "components": [
    {
      "name": "short display name",
      "partName": "exact purchasable product name",
      "category": "Microcontroller | Sensor | Actuator | Power | Display | Passive | Connector | Structure | Other",
      "quantity": 1,
      "unitPrice": 12.99,
      "url": "https://...",
      "image": "https://... direct link to a product photo, or omit",
      "pins": ["VCC", "GND", "SDA", "SCL"],
      "notes": "optional wiring or usage note"
    }
  ],
  "connections": [
    {
      "from": { "componentIndex": 0, "pin": "D2" },
      "to": { "componentIndex": 1, "pin": "SIG" },
      "kind": "signal" | "power" | "ground" | "data",
      "net": "optional net name like 5V, GND, SDA",
      "label": "optional short label"
    }
  ],
  "steps": [
    {
      "title": "short imperative title",
      "body": "precise instruction, referencing real pin names",
      "componentIds": [0, 1]
    }
  ]
}

componentIndex and componentIds are ZERO-BASED indexes into the components array.
steps.componentIds uses the same zero-based component indexes.
Set unitPrice to a realistic USD price, or omit it when you genuinely do not know.`
}

function buildUserPrompt(request: {
  prompt: string
  currentSpec?: DesignSpec
}): string {
  const parts: string[] = [`Project request:\n${request.prompt}`]

  if (request.currentSpec) {
    const s = request.currentSpec
    parts.push(
      `You are refining an EXISTING design. Current design:\n` +
        JSON.stringify(
          {
            title: s.title,
            summary: s.summary,
            components: s.components.map((c) => ({
              name: c.name,
              partName: c.partName,
              category: c.category,
              quantity: c.quantity,
              pins: c.pins
            })),
            connections: s.connections.map((c) => ({
              from: c.from,
              to: c.to,
              kind: c.kind,
              net: c.net
            })),
            steps: s.steps.map((st) => ({ title: st.title, body: st.body }))
          },
          null,
          2
        )
    )
    parts.push(
      `Apply ONLY the change described in the project request. Keep every part, connection and step that is not affected. Return the COMPLETE updated design, not a diff.`
    )
  }

  parts.push(schemaSection())
  return parts.join('\n\n')
}

export function buildMessages(request: {
  prompt: string
  currentSpec?: DesignSpec
}): { system: string; user: string } {
  return {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(request)
  }
}