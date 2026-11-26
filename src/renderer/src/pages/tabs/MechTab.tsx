import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import type { CadDiscoveryProgress, DesignSpec, IpcResult } from '@shared/types'
import { hasCadModel } from '@/lib/cadSources'

interface Props {
  spec: DesignSpec
  /** Persist a discovered or user-pasted model URL back to the project. */
  onModelUrlChange: (partId: string, modelUrl: string) => void
  /** Report canvas zoom percentage up to the app-level status bar. */
  onCanvasZoom: (zoom: number) => void
}

const CATEGORY_COLOURS: Record<string, string> = {
  power: '#e0b34a',
  ground: '#8b8b9a',
  signal: '#4f8cff',
  data: '#46c79a',
  connector: '#6b6b7a',
  passive: '#9aa0a6',
  actuator: '#ff9e4d',
  structure: '#a0a8b0',
  other: '#b0b8c0'
}

function geometryForCategory(category: string): { type: 'box' | 'cylinder'; size: number } {
  switch (category) {
    case 'power':
      return { type: 'cylinder', size: 1.2 }
    case 'microcontroller':
    case 'display':
    case 'connector':
    case 'structure':
      return { type: 'box', size: 1.4 }
    case 'sensor':
    case 'passive':
    case 'actuator':
      return { type: 'box', size: 0.8 }
    default:
      return { type: 'box', size: 1.0 }
  }
}

function modelExt(url: string): 'gltf' | 'glb' | 'stl' | 'obj' | null {
  const base = url.split('?')[0].split('#')[0]
  const ext = base.split('.').pop()?.toLowerCase()
  if (ext === 'gltf' || ext === 'glb') return 'gltf'
  if (ext === 'stl') return 'stl'
  if (ext === 'obj') return 'obj'
  return null
}

function partNameOrSlug(c: { name: string; partName?: string; slug?: string }): string {
  return c.partName ?? c.name
}

export default function MechTab({ spec, onModelUrlChange, onCanvasZoom }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [modelsLoaded, setModelsLoaded] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState<Record<string, string>>({})
  const [modelUrls, setModelUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const discoveredRef = useRef<Set<string>>(new Set())
  const [noCadFound, setNoCadFound] = useState<Set<string>>(new Set())
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [cadProgress, setCadProgress] = useState<CadDiscoveryProgress | null>(null)
  const cadPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ---------------------------------------------------------------------------
  // GrabCAD Community Library state
  // ---------------------------------------------------------------------------

  const [grabcadAuthenticated, setGrabcadAuthenticated] = useState<boolean | null>(null)
  const [grabcadEmail, setGrabcadEmail] = useState('')
  const [grabcadPassword, setGrabcadPassword] = useState('')
  const [grabcadLoginError, setGrabcadLoginError] = useState<string | null>(null)
  const [grabcadLoginLoading, setGrabcadLoginLoading] = useState(false)
  const [grabcadSearchingPartId, setGrabcadSearchingPartId] = useState<string | null>(null)
  const [grabcadSearchResults, setGrabcadSearchResults] = useState<
    Record<string, { id: string; name: string; url: string }[]>
  >({})
  const [grabcadDownloadingSlug, setGrabcadDownloadingSlug] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Poll bulk discovery progress
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!cadProgress?.running) {
      if (cadPollRef.current !== null) {
        clearInterval(cadPollRef.current)
        cadPollRef.current = null
      }
      return
    }
    if (cadPollRef.current !== null) return
    cadPollRef.current = setInterval(async () => {
      try {
        const res = await window.api.catalogue.cadDiscoveryStatus()
        const data = res.data
        if (data) setCadProgress(data as never)
      } catch {
        // Ignore - the renderer may not be ready yet.
      }
    }, 2000)
    return () => {
      if (cadPollRef.current !== null) {
        clearInterval(cadPollRef.current)
        cadPollRef.current = null
      }
    }
  }, [cadProgress])

  // ---------------------------------------------------------------------------
  // GrabCAD auth status check on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.api.catalogue.grabcad.status()
        if (cancelled) return
        if (res.ok && res.data) setGrabcadAuthenticated(res.data.authenticated)
      } catch {
        // GrabCAD status is non-fatal; leave as null (unknown).
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const startBulkDiscovery = useCallback(async () => {
    try {
      const res = await window.api.catalogue.runCadDiscovery()
      const data = res.data
      if (data) setCadProgress(data as never)
    } catch {
      // Ignore - discovery will be retried on next poll if needed.
    }
  }, [])

  const handleGrabcadLogin = useCallback(async () => {
    setGrabcadLoginLoading(true)
    setGrabcadLoginError(null)
    try {
      const res: IpcResult<{ cookie: string }> = await window.api.catalogue.grabcad.login({
        email: grabcadEmail,
        password: grabcadPassword
      })
      if (res.ok) {
        setGrabcadAuthenticated(true)
        setGrabcadLoginError(null)
      } else {
        setGrabcadLoginError(res.error ?? 'Login failed')
      }
    } catch (err) {
      setGrabcadLoginError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setGrabcadLoginLoading(false)
    }
  }, [grabcadEmail, grabcadPassword])

  const handleGrabcadLogout = useCallback(async () => {
    try {
      await window.api.catalogue.grabcad.logout()
      setGrabcadAuthenticated(false)
      setGrabcadLoginError(null)
      setGrabcadSearchResults({})
    } catch {
      // Ignore
    }
  }, [])

  const handleGrabcadSearch = useCallback(
    async (partId: string, query: string) => {
      setGrabcadSearchingPartId(partId)
      try {
        const res: IpcResult<{ id: string; name: string; url: string }[]> =
          await window.api.catalogue.grabcad.search({ query })
        if (res.ok) {
          setGrabcadSearchResults((prev) => ({ ...prev, [partId]: res.data ?? [] }))
        } else {
          setGrabcadSearchResults((prev) => ({ ...prev, [partId]: [] }))
          setGrabcadLoginError(res.error ?? 'Search failed')
        }
      } catch (err) {
        setGrabcadSearchResults((prev) => ({ ...prev, [partId]: [] }))
        setGrabcadLoginError(err instanceof Error ? err.message : 'Search failed')
      } finally {
        if (grabcadSearchingPartId === partId) setGrabcadSearchingPartId(null)
      }
    },
    []
  )

  const handleGrabcadDownload = useCallback(
    async (partId: string, slug: string) => {
      setGrabcadDownloadingSlug(slug)
      try {
        const res: IpcResult<{
          slug: string
          archiveUrl: string
          files: string[]
          extractDir: string
          localFile: string | null
        }> = await window.api.catalogue.grabcad.download({ slug })

        if (res.ok && res.data?.localFile) {
          const localFile = res.data.localFile

          const fileUrl = `file://${localFile}`
          void loadModel(fileUrl, partNameOrSlug(spec.components.find((c) => c.id === partId)!), partId)
          setDownloaded((prev) => new Set([...prev, partId]))
          setNoCadFound((prev) => {
            const next = new Set(prev)
            next.delete(partId)
            return next
          })
        } else {
          setGrabcadLoginError(res.error ?? 'Download failed')
        }
      } catch (err) {
        setGrabcadLoginError(err instanceof Error ? err.message : 'Download failed')
      } finally {
        setGrabcadDownloadingSlug(null)
      }
    },
    []
  )

  // ---------------------------------------------------------------------------
  // Model loading
  // ---------------------------------------------------------------------------

  const loadModel = useCallback(
    (url: string, partName: string, partId: string) => {
      const ext = modelExt(url)
      if (!ext) {
        setLoadError((prev) => ({ ...prev, [partId]: 'Not a 3D model file (need .stl, .obj, .gltf, or .glb)' }))
        return
      }

      let loader: any
      if (ext === 'gltf') loader = new GLTFLoader()
      else if (ext === 'stl') loader = new STLLoader()
      else loader = new OBJLoader()

      setLoading((prev) => new Set([...prev, partId]))
      setLoadError((prev) => {
        const next = { ...prev }
        delete next[partId]
        return next
      })

      loader.load(
        url,
        (gltf: any) => {
          const scene = containerRef.current?.querySelector('[data-three-scene]') as HTMLElement | null
          if (!scene) return

          const obj = gltf.scene || gltf
          obj.traverse((child: any) => {
            if (child.isMesh) {
              child.castShadow = true
              child.receiveShadow = true
            }
          })
          obj.name = partName
          ;(scene as any).add(obj)
          setModelsLoaded((prev) => new Set([...prev, partId]))
          setLoading((prev) => {
            const next = new Set(prev)
            next.delete(partId)
            return next
          })
        },
        undefined,
        (err: ErrorEvent | Error) => {
          setLoadError((prev) => ({ ...prev, [partId]: err instanceof Error ? err.message : String(err) }))
          setLoading((prev) => {
            const next = new Set(prev)
            next.delete(partId)
            return next
          })
        }
      )
    },
    []
  )

  // ---------------------------------------------------------------------------
  // Three.js scene
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1e)
    scene.fog = new THREE.FogExp2(0x1a1a1e, 0.15)

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100)
    camera.position.set(5, 5, 5)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.maxPolarAngle = Math.PI / 2 - 0.05

    const ambient = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambient)

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
    dirLight.position.set(5, 10, 7)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 1024
    dirLight.shadow.mapSize.height = 1024
    scene.add(dirLight)

    const fillLight = new THREE.PointLight(0x4f8cff, 0.3)
    fillLight.position.set(-5, 2, 5)
    scene.add(fillLight)

    const grid = new THREE.GridHelper(20, 40, 0x444444, 0x2a2a2e)
    scene.add(grid)

    const parts = spec.components
    const boxSize = 2.2
    const gridCols = Math.ceil(Math.sqrt(parts.length))
    const gridRows = Math.ceil(parts.length / gridCols)

    parts.forEach((part, i) => {
      const col = i % gridCols
      const row = Math.floor(i / gridCols)
      const x = (col - gridCols / 2) * boxSize
      const z = (row - gridRows / 2) * boxSize

      const { type, size } = geometryForCategory(part.category)
      let mesh: THREE.Mesh
      if (type === 'cylinder') {
        const geo = new THREE.CylinderGeometry(size * 0.6, size * 0.6, size * 1.2, 16)
        mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: CATEGORY_COLOURS[part.category] ?? '#b0b8c0' }))
      } else {
        const geo = new THREE.BoxGeometry(size, size * 0.6, size)
        mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: CATEGORY_COLOURS[part.category] ?? '#b0b8c0' }))
      }
      mesh.position.set(x, 0, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.name = part.name
      mesh.userData = { partId: part.id, partName: part.name }
      scene.add(mesh)
    })

    let frameId: number
    const lastZoomReport = useRef(0)
    const initialDistance = Math.sqrt(5 * 5 + 5 * 5 + 5 * 5) // camera starts at (5,5,5)
    const animate = () => {
      frameId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)

      // Report zoom to the status bar, throttled to ~30ms.
      const now = Date.now()
      if (now - lastZoomReport.current > 30) {
        lastZoomReport.current = now
        const distance = camera.position.length()
        const zoom = Math.round((initialDistance / Math.max(distance, 0.1)) * 100)
        onCanvasZoom(Math.min(Math.max(zoom, 10), 500))
      }
    }
    animate()

    const onResize = () => {
      if (!container) return
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight)
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(frameId)
      controls.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [spec.components, onCanvasZoom])

  // ---------------------------------------------------------------------------
  // Persist model URLs from the component spec into local state
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setModelUrls((prev) => {
      const next = { ...prev }
      let changed = false
      spec.components.forEach((c) => {
        if (c.modelUrl && !next[c.id]) {
          next[c.id] = c.modelUrl
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [spec.components])

  // ---------------------------------------------------------------------------
  // Auto-load any model URL we have for a part that isn't rendered yet
  // ---------------------------------------------------------------------------

  useEffect(() => {
    spec.components.forEach((c) => {
      const url = modelUrls[c.id]
      if (!url) return
      if (modelsLoaded.has(c.id) || loading.has(c.id)) return
      if (!modelExt(url)) return
      void loadModel(url, partNameOrSlug(c), c.id)
    })
  }, [spec.components, modelUrls, modelsLoaded, loading])

  // ---------------------------------------------------------------------------
  // Auto-discover a model URL from each part's product page
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const c of spec.components) {
        if (cancelled) return
        if (discoveredRef.current.has(c.id)) continue
        if (c.modelUrl) continue
        if (!c.url) continue
        if (!hasCadModel(c.category)) continue
        discoveredRef.current.add(c.id)
        const res = await window.api.catalogue.findModelUrl({
          productUrl: c.url,
          partName: partNameOrSlug(c)
        })
        if (cancelled) return
        if (res.ok && res.data) {
          const modelUrl = res.data
          setModelUrls((prev) => ({ ...prev, [c.id]: modelUrl }))
          setNoCadFound((prev) => {
            const next = new Set(prev)
            next.delete(c.id)
            return next
          })
          void onModelUrlChange(c.id, modelUrl)
        } else if (res.ok && !res.data) {
          setNoCadFound((prev) => new Set([...prev, c.id]))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [spec.components, onModelUrlChange])

  // ---------------------------------------------------------------------------
  // Auto-load any locally downloaded model file for a part
  // ---------------------------------------------------------------------------

  useEffect(() => {
    spec.components.forEach((c) => {
      if (!c.modelFilePath || downloaded.has(c.id) || loading.has(c.id)) return
      const fileUrl = `file://${c.modelFilePath}`
      void loadModel(fileUrl, partNameOrSlug(c), c.id)
      setDownloaded((prev) => new Set([...prev, c.id]))
    })
  }, [spec.components, downloaded, loading])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Mechanical</h2>
            <p className="text-[13px] text-ink-dim">
              3D CAD view of your build. Rotate to orbit, scroll to zoom, right-click to pan.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div className="text-right hidden sm:block">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                {spec.components.length} parts
              </div>
              <div className="text-sm font-medium">
                {modelsLoaded.size} loaded · {spec.components.length - modelsLoaded.size} primitive
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              {cadProgress && (
                <div className="mt-1 sm:mt-0 text-[11px]">
                  {cadProgress.running ? (
                    <span className="text-yellow-500 animate-pulse inline-flex items-center gap-1">
                      ● Discovering CAD {cadProgress.done}/{cadProgress.toDiscover}
                      {cadProgress.found > 0 && ` · ${cadProgress.found} found`}
                      {cadProgress.blocked > 0 && ` · ${cadProgress.blocked} blocked`}
                    </span>
                  ) : (
                    <span className="text-ink-faint inline-flex items-center gap-1">
                      Bulk discovery: {cadProgress.done} saved · {cadProgress.found} found
                      {cadProgress.blocked > 0 && ` · ${cadProgress.blocked} blocked`}
                      {cadProgress.failed > 0 && ` · ${cadProgress.failed} no match`}
                    </span>
                  )}
                  {cadProgress.blocked > 0 && (
                    <p className="mt-1 text-[10px] text-red-500">
                      SnapEDA is blocked (403) — automated CAD discovery can't run right now.
                    </p>
                  )}
                </div>
              )}
              <button
                onClick={startBulkDiscovery}
                disabled={cadProgress?.running}
                className="rounded px-3 py-1.5 text-[11px] font-medium transition ${cadProgress?.running ? 'cursor-not-allowed opacity-50 bg-line/50 text-ink-faint border border-line' : 'bg-accent text-white border-transparent hover:bg-accent/90'}"
              >
                {cadProgress?.running ? 'Discovering…' : 'Discover CAD (SnapEDA)'}
              </button>
            </div>
          </div>
        </div>

        {/* GrabCAD auth card */}
        <div className="rounded-lg border border-line bg-surface-1 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold tracking-tight">GrabCAD Community Library</h3>
            {grabcadAuthenticated === null ? (
              <span className="text-[10px] text-ink-faint animate-pulse">Checking…</span>
            ) : grabcadAuthenticated ? (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex h-2 w-2 rounded-full bg-green-500"></span>
                <span className="text-[10px] text-green-500 font-medium">Signed in</span>
                <button
                  onClick={handleGrabcadLogout}
                  className="ml-2 rounded border border-line/50 bg-transparent px-2 py-0.5 text-[10px] text-ink-dim hover:bg-surface-2 transition"
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>

          {grabcadAuthenticated === null ? (
            <div className="h-8 flex items-center justify-center text-[10px] text-ink-faint animate-pulse">
              Checking GrabCAD status…
            </div>
          ) : grabcadAuthenticated ? (
            <p className="text-[11px] text-ink-dim">
              Search the GrabCAD Community Library and download CAD models for your parts.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handleGrabcadLogin()
              }}
              className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end"
            >
              <input
                type="email"
                placeholder="Email"
                value={grabcadEmail}
                onChange={(e) => setGrabcadEmail(e.target.value)}
                className="rounded border border-line bg-surface-0 px-2 py-1.5 text-[11px] outline-none focus:border-line-bright"
              />
              <input
                type="password"
                placeholder="Password"
                value={grabcadPassword}
                onChange={(e) => setGrabcadPassword(e.target.value)}
                className="rounded border border-line bg-surface-0 px-2 py-1.5 text-[11px] outline-none focus:border-line-bright"
              />
              <button
                type="submit"
                disabled={grabcadLoginLoading}
                className="rounded px-3 py-1.5 text-[11px] font-medium transition ${grabcadLoginLoading ? 'cursor-not-allowed opacity-50 bg-line/50 text-ink-faint border border-line' : 'bg-accent text-white border-transparent hover:bg-accent/90'}"
              >
                {grabcadLoginLoading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
          {grabcadLoginError && (
            <p className="mt-2 text-[10px] text-red-500">{grabcadLoginError}</p>
          )}
        </div>

        <p className="mt-2 mb-3 rounded-lg border border-line bg-surface-1 px-3 py-2 text-[12px] text-ink-dim">
          Model URLs are discovered automatically from each part's product page. Paste a direct
          <span className="font-mono text-xs">.stl</span>, <span className="font-mono text-xs">.obj</span>, or
          <span className="font-mono text-xs">.gltf/.glb</span> URL into a part row to override, then click Load.
          Some hosts block cross-origin model loading — those parts stay as primitives.
        </p>
      </div>

      {/* 3D scene */}
      <div className="flex-1 min-h-[600px] rounded-lg border border-line bg-surface-0 relative flex flex-col">
        <div
          ref={containerRef}
          className="flex-1 rounded-lg border-b-0 border-t border-l border-r border-line bg-surface-0 relative"
          data-three-scene
        >
          {spec.components.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-ink-faint">
              <div className="mb-2 opacity-50">📦</div>
              <p>No parts in this design. Add parts in the PART tab.</p>
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-line bg-surface-1 flex items-center justify-between text-[11px] text-ink-faint">
          <span>{spec.components.length} parts</span>
          <span>Rotate to orbit · Scroll to zoom · Right-click to pan</span>
        </div>
      </div>

      {/* Parts table */}
      {spec.components.length > 0 && (
        <div className="mt-6 border border-line rounded-lg bg-surface-1 overflow-hidden">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-line bg-surface-2/60">
                <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-ink-faint">Part</th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-ink-faint">Category</th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-ink-faint">Model</th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-ink-faint">Model URL</th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-ink-faint text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {spec.components.map((c) => {
                const loaded = modelsLoaded.has(c.id)
                const err = loadError[c.id]
                const isLoading = loading.has(c.id)
                const currentUrl = modelUrls[c.id] ?? c.url ?? ''
                const hasLocalFile = Boolean(c.modelFilePath)
                const isGrabcadSearching = grabcadSearchingPartId === c.id
                const results = grabcadSearchResults[c.id]
                const showResults = results && results.length > 0

                return (
                  <tr key={c.id} className="border-b border-line/50 hover:bg-surface-2/40 group">
                    <td className="px-4 py-3 text-[13px] text-ink truncate">
                      {c.partName ?? c.name}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-ink-dim">
                      <span className={`inline-block size-2.5 rounded-full mr-2 ${c.category === 'power' ? 'bg-[#e0b34a]' : c.category === 'ground' ? 'bg-[#8b8b9a]' : c.category === 'signal' ? 'bg-[#4f8cff]' : c.category === 'data' ? 'bg-[#46c79a]' : 'bg-[#b0b8c0]'}`}></span>
                      {c.category}
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      {loaded ? (
                        <span className="inline-flex items-center gap-1 text-green-500 font-mono">
                          ● Loaded
                        </span>
                      ) : isLoading ? (
                        <span className="inline-flex items-center gap-1 text-yellow-500 font-mono animate-pulse">
                          Loading…
                        </span>
                      ) : downloading.has(c.id) ? (
                        <span className="inline-flex items-center gap-1 text-yellow-500 font-mono animate-pulse">
                          Downloading…
                        </span>
                      ) : downloaded.has(c.id) ? (
                        <span className="inline-flex items-center gap-1 text-blue-500 font-mono">
                          Local
                        </span>
                      ) : noCadFound.has(c.id) ? (
                        <span className="inline-flex items-center gap-1 text-red-500 font-mono">
                          No CAD
                        </span>
                      ) : (
                        <span className="text-ink-faint">Primitive</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {hasLocalFile ? (
                          <span className="text-xs text-ink-faint truncate max-w-[200px]">
                            Local file: {c.modelFilePath!.split(/[/\\]/).pop()}
                          </span>
                        ) : (
                          <input
                            type="text"
                            value={currentUrl}
                            onChange={(e) => setModelUrls((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            placeholder="Paste .stl/.obj/.gltf URL…"
                            className="flex-1 min-w-[200px] rounded border border-line bg-surface-0 px-2 py-1.5 text-[11px] outline-none focus:border-line-bright"
                          />
                        )}
                        <button
                          onClick={async () => {
                            const url = c.modelFilePath ?? modelUrls[c.id] ?? c.url
                            if (!url) return
                            if (c.modelFilePath) {
                              void loadModel(`file://${c.modelFilePath}`, partNameOrSlug(c), c.id)
                              setDownloaded((prev) => new Set([...prev, c.id]))
                              return
                            }
                            setDownloading((prev) => new Set([...prev, c.id]))
                            try {
                              const res = await window.api.catalogue.downloadModelByUrl({
                                modelUrl: url
                              })
                              if (res.ok && res.data) {
                                const localPath = res.data
                                setDownloaded((prev) => new Set([...prev, c.id]))
                                void loadModel(`file://${localPath}`, partNameOrSlug(c), c.id)
                                setNoCadFound((prev) => {
                                  const next = new Set(prev)
                                  next.delete(c.id)
                                  return next
                                })
                              }
                            } finally {
                              setDownloading((prev) => {
                                const next = new Set(prev)
                                next.delete(c.id)
                                return next
                              })
                            }
                          }}
                          disabled={
                            isLoading ||
                            downloading.has(c.id) ||
                            (!c.modelFilePath && !modelUrls[c.id] && !c.url)
                          }
                          className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${isLoading || downloading.has(c.id) || (!c.modelFilePath && !modelUrls[c.id] && !c.url) ? 'cursor-not-allowed opacity-50 bg-line/50 text-ink-faint border border-line' : c.modelFilePath ? 'bg-blue-500 text-white border-blue-500/30 hover:bg-blue-600' : 'bg-accent text-white border-transparent hover:bg-accent/90'}`}
                        >
                          {isLoading ? 'Loading…' : downloading.has(c.id) ? 'Downloading…' : c.modelFilePath ? 'Load local' : 'Download'}
                        </button>
                      </div>

                      {/* GrabCAD search per part */}
                      {grabcadAuthenticated && (
                        <div className="mt-3 pt-3 border-t border-line/50">
                          <button
                            onClick={() => {
                              if (showResults) {
                                setGrabcadSearchResults((prev) => ({ ...prev, [c.id]: [] }))
                              } else {
                                void handleGrabcadSearch(c.id, c.partName ?? c.name)
                              }
                            }}
                            className="w-full rounded border border-line bg-surface-0 px-2 py-1.5 text-[11px] font-medium text-ink transition hover:bg-surface-2"
                          >
                            {isGrabcadSearching ? 'Searching…' : showResults ? 'Hide GrabCAD results' : 'Search GrabCAD'}
                          </button>
                          {showResults && (
                            <div className="mt-2">
                              <table className="w-full text-left text-[11px] border border-line rounded bg-surface-0 overflow-hidden">
                                <thead>
                                  <tr className="border-b border-line bg-surface-2/40">
                                    <th className="px-2 py-1.5 text-ink-faint">GrabCAD model</th>
                                    <th className="px-2 py-1.5 text-ink-faint text-right w-24">Download</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {results.map((model) => (
                                    <tr key={model.id} className="border-b border-line/50 hover:bg-surface-2/30">
                                      <td className="px-2 py-1.5 text-ink truncate max-w-[200px]">{model.name}</td>
                                      <td className="px-2 py-1.5 text-right">
                                        <button
                                          onClick={() => void handleGrabcadDownload(c.id, model.id)}
                                          disabled={grabcadDownloadingSlug === model.id}
                                          className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${grabcadDownloadingSlug === model.id ? 'cursor-not-allowed opacity-50 bg-line/50 text-ink-faint border border-line' : 'bg-accent text-white border-transparent hover:bg-accent/90'}`}
                                        >
                                          {grabcadDownloadingSlug === model.id ? 'Downloading…' : 'Download'}
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                      {err && (
                        <p className="mt-1 text-[10px] text-red-500">{err}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline hover:text-accent/90 text-[11px]">
                          Open source
                        </a>
                      ) : (
                        <span className="text-[11px] text-ink-faint">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
