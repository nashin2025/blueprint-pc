import { store } from './store'
import { pruneImages } from './images'
import { listCachedPartImages } from './partsearch'

/**
 * Deletes stored images that nothing references any more.
 *
 * References come from three places, and missing any one of them deletes images
 * that are still in use:
 *
 *   - the current design of each project (the big product renders)
 *   - every saved version, so history keeps showing the render from that time
 *   - the part-photo cache, because part thumbnails are not recorded on the
 *     component and would otherwise be deleted on every launch
 *
 * Run once at startup, and never touch a file some version still points at.
 */
export function pruneOrphanImages(): number {
  const referenced = new Set<string>()

  for (const project of store.list()) {
    if (project.spec.imageFile) referenced.add(project.spec.imageFile)
    for (const version of project.versions) {
      if (version.spec?.imageFile) referenced.add(version.spec.imageFile)
    }
  }

  for (const cached of listCachedPartImages()) referenced.add(cached)

  return pruneImages(referenced)
}