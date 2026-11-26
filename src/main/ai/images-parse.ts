/**
 * Pure helpers for image generation. Kept free of imports so they can be
 * exercised directly by the self-check without pulling in the fetch layer.
 */

/**
 * NIM's genai catalog is not consistent about how it returns an image: different
 * model families answer with `artifacts[]`, `images[]`, `data[]`, or bare
 * strings. Accept every shape seen in the docs rather than coupling to one
 * family, and return null rather than throwing so the caller can report
 * "no image" instead of crashing.
 */
export function firstImageBase64(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const j = json as Record<string, unknown>

  const artifacts = j.artifacts
  if (Array.isArray(artifacts) && artifacts.length > 0) {
    const a = artifacts[0] as { base64?: string }
    if (typeof a?.base64 === 'string' && a.base64.length > 0) return a.base64
  }

  const images = j.images
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0]
    if (typeof first === 'string' && first.length > 0) return first
    if (typeof first === 'object' && first !== null) {
      const f = first as { b64_json?: string; base64?: string }
      if (typeof f.b64_json === 'string' && f.b64_json.length > 0) return f.b64_json
      if (typeof f.base64 === 'string' && f.base64.length > 0) return f.base64
    }
  }

  const data = j.data
  if (Array.isArray(data) && data.length > 0) {
    const d = data[0] as { b64_json?: string }
    if (typeof d?.b64_json === 'string' && d.b64_json.length > 0) return d.b64_json
  }

  return null
}

/**
 * The image model becomes a URL path segment on NIM's genai host, so a value
 * containing `..`, `?`, `#` or whitespace must be rejected rather than encoded:
 * encoding would silently send the request somewhere the user did not ask for.
 */
export function modelPathSegment(model: string): string {
  const ALLOWED = /^[A-Za-z0-9._\-/]+$/
  if (!ALLOWED.test(model)) {
    throw new Error(`"${model}" is not a valid image model id.`)
  }

  // Dots and slashes are allowed characters, which means a value like
  // "../../etc/passwd" passes the character test. Reject traversal segments
  // explicitly rather than relying on the URL parser to normalise them.
  const segments = model.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`"${model}" is not a valid image model id.`)
  }

  return model
}