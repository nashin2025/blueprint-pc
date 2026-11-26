/**
 * Links into public CAD libraries.
 *
 * These are search links, not lookups. None of the four sites offers a keyless
 * API, and all of them change their markup, so sending the user to the site's own
 * search is both cheaper and more durable than scraping a result count that would
 * be wrong the moment the site is redesigned.
 *
 * Every URL below was opened and checked to land on results for the part rather
 * than on a generic landing page. GrabCAD is the one that needed care: `?q=` is
 * silently ignored and returns "Recent models", so it takes `?query=`.
 */

export interface CadSource {
  name: string
  /** What that library is actually good for, so the user picks the right one. */
  note: string
  url: string
}

/**
 * Categories whose parts have a physical shape worth modelling.
 *
 * Passives (resistors, capacitors, wire) and uncategorised parts are excluded:
 * nobody needs a STEP file for a 220 ohm resistor, and offering one makes the
 * list look padded.
 */
const CAD_CATEGORIES = new Set([
  'microcontroller',
  'sensor',
  'actuator',
  'power',
  'display',
  'connector',
  'structure'
])

/** True when a part of this category plausibly has a 3D model. Case-insensitive. */
export function hasCadModel(category: string): boolean {
  return CAD_CATEGORIES.has(category.toLowerCase())
}

/** Search links for a part, in the order most likely to have the model. */
export function cadSources(partName: string): CadSource[] {
  const q = encodeURIComponent(partName)
  return [
    {
      name: 'GrabCAD',
      note: 'STEP, IGES and SolidWorks mechanical models',
      url: `https://grabcad.com/library?query=${q}`
    },
    {
      name: 'SnapEDA',
      note: 'PCB footprints, schematic symbols and 3D STEP',
      url: `https://www.snapeda.com/search?q=${q}`
    },
    {
      name: 'Ultra Librarian',
      note: 'ECAD symbols, PCB footprints and 3D STEP',
      url: `https://app.ultralibrarian.com/search?queryText=${q}`
    },
    {
      name: 'Thingiverse',
      note: 'STL files for printed brackets and enclosures',
      url: `https://www.thingiverse.com/search?q=${q}`
    }
  ]
}