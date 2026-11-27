/**
 * Footprint editor: define or edit a component land pattern (pad array) and
 * save it to the active design spec.
 *
 * The editor computes pad positions locally so the preview always matches what
 * gets saved. The canonical land-pattern math lives in src/main/footprint-generator.ts
 * and is reachable through the footprints:generate-land-pattern IPC channel.
 */

import { useState, useEffect } from 'react'
import type { DesignSpec, Footprint, FootprintPad, LandPatternParams } from '@shared/types'
import { newId } from '../state/useApp'
import { TrashIcon } from './Icons'

type FootprintKind = LandPatternParams['type']

interface FootprintEditorProps {
  spec: DesignSpec
  onSave: (footprint: Footprint) => void
  onCancel: () => void
  /** When editing an existing footprint, its id is preserved on save. */
  footprint?: Footprint
}

const DEFAULTS: Record<FootprintKind, Partial<LandPatternParams>> = {
  sop: { pinCount: 8, pitch: 1.27, bodyWidth: 6.0, bodyHeight: 4.0, padWidth: 0.6, padLength: 1.0 },
  dip: { pinCount: 8, pitch: 2.54, bodyWidth: 10.2, bodyHeight: 6.4, padWidth: 0.7, padLength: 1.6 },
  qfn: { pinCount: 16, pitch: 0.5, bodyWidth: 4.0, bodyHeight: 4.0, padWidth: 0.25, padLength: 0.6 },
  'smd-resistor': { bodyWidth: 1.6, bodyHeight: 0.8, padWidth: 0.9, padLength: 0.6 },
  'smd-capacitor': { bodyWidth: 1.6, bodyHeight: 0.8, padWidth: 0.9, padLength: 0.6 },
  custom: {}
}

const SIDE_FIELDS: FootprintKind[] = ['sop', 'dip', 'qfn']

function emptyParams(type: FootprintKind): LandPatternParams {
  return {
    type,
    pinCount: DEFAULTS[type].pinCount ?? 0,
    pitch: DEFAULTS[type].pitch ?? 0,
    bodyWidth: DEFAULTS[type].bodyWidth ?? 0,
    bodyHeight: DEFAULTS[type].bodyHeight ?? 0,
    padWidth: DEFAULTS[type].padWidth ?? 0.6,
    padLength: DEFAULTS[type].padLength ?? 1.0,
    padToBodyClearance: 0,
    customPads: []
  }
}

/**
 * Mirror of generateLandPattern in src/main/footprint-generator.ts. Kept in the
 * renderer so the preview updates instantly without an IPC round trip. The saved
 * footprint is built from the same math.
 */
function computeFootprint(params: LandPatternParams): {
  pads: FootprintPad[]
  outlineW: number
  outlineH: number
  name: string
  description: string
} {
  const { type } = params
  const pinCount = params.pinCount ?? 0
  const pitch = params.pitch ?? 0
  const bodyW = params.bodyWidth ?? 0
  const bodyH = params.bodyHeight ?? 0
  const padW = params.padWidth ?? 0.6
  const padL = params.padLength ?? 1.0
  const clearance = params.padToBodyClearance ?? 0

  const pads: FootprintPad[] = []
  let name = ''
  let description = ''
  let outlineW = bodyW
  let outlineH = bodyH

  if (type === 'custom') {
    const custom = params.customPads ?? []
    custom.forEach((c: { x: number; y: number; w: number; h: number }, i: number) => {
      pads.push({ id: `p${i + 1}`, x: c.x, y: c.y, w: c.w, h: c.h, shape: 'rect' })
    })
    name = 'Custom footprint'
    description = `Custom land pattern with ${custom.length} pad(s).`
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of pads) {
      minX = Math.min(minX, p.x - p.w / 2)
      minY = Math.min(minY, p.y - p.h / 2)
      maxX = Math.max(maxX, p.x + p.w / 2)
      maxY = Math.max(maxY, p.y + p.h / 2)
    }
    const margin = 0.5
    outlineW = maxX - minX + 2 * margin
    outlineH = maxY - minY + 2 * margin
  } else if (type === 'smd-resistor' || type === 'smd-capacitor') {
    const xL = -bodyW / 2 - clearance - padW / 2
    const xR = bodyW / 2 + clearance + padW / 2
    pads.push({ id: 'p1', x: xL, y: 0, w: padW, h: padL, shape: 'rect' })
    pads.push({ id: 'p2', x: xR, y: 0, w: padW, h: padL, shape: 'rect' })
    name = type === 'smd-resistor' ? '0603 resistor' : '0603 capacitor'
    description = `Two-pad SMD ${name} land pattern, ${bodyW}x${bodyH}mm body.`
  } else if (type === 'sop' || type === 'dip') {
    const perSide = pinCount / 2
    const span = (perSide - 1) * pitch
    const startY = -span / 2
    const sideOffset = bodyW / 2 + clearance + padW / 2
    for (let i = 0; i < perSide; i++) {
      const y = startY + i * pitch
      pads.push({ id: `p${i + 1}`, x: -sideOffset, y, w: padW, h: padL, shape: 'rect' })
      pads.push({ id: `p${perSide + i + 1}`, x: sideOffset, y, w: padW, h: padL, shape: 'rect' })
    }
    name = `${type === 'sop' ? 'SOP' : 'DIP'}${pinCount}`
    description = `${pinCount}-pin ${type.toUpperCase()} land pattern, ${bodyW}x${bodyH}mm body, ${pitch}mm pitch.`
  } else if (type === 'qfn') {
    const perSide = pinCount / 4
    const span = (perSide - 1) * pitch
    const start = -span / 2
    const offX = bodyW / 2 + clearance + padW / 2
    const offY = bodyH / 2 + clearance + padW / 2
    for (let i = 0; i < perSide; i++) {
      const x = start + i * pitch
      pads.push({ id: `p${i + 1}`, x, y: -offY, w: padL, h: padW, shape: 'rect' })
      pads.push({ id: `p${perSide + i + 1}`, x, y: offY, w: padL, h: padW, shape: 'rect' })
    }
    for (let i = 0; i < perSide; i++) {
      const y = start + i * pitch
      pads.push({ id: `p${perSide * 2 + i + 1}`, x: -offX, y, w: padW, h: padL, shape: 'rect' })
      pads.push({ id: `p${perSide * 3 + i + 1}`, x: offX, y, w: padW, h: padL, shape: 'rect' })
    }
    name = `QFN${pinCount}`
    description = `${pinCount}-pin QFN land pattern, ${bodyW}x${bodyH}mm body, ${pitch}mm pitch.`
    if (params.centerPad) {
      pads.push({
        id: 'p-thermal',
        x: 0,
        y: 0,
        w: params.centerPad.w,
        h: params.centerPad.h,
        shape: 'rect'
      })
      description += ` with centre thermal pad ${params.centerPad.w}x${params.centerPad.h}mm.`
    }
  }

  return { pads, outlineW, outlineH, name, description }
}

export default function FootprintEditor({
  spec,
  onSave,
  onCancel,
  footprint: editingFootprint
}: FootprintEditorProps) {
  const [type, setType] = useState<FootprintKind>(editingFootprint ? 'sop' : 'sop')
  const [name, setName] = useState(editingFootprint?.name ?? `Footprint ${(spec.footprints ?? []).length + 1}`)
  const [description, setDescription] = useState(editingFootprint?.description ?? '')
  const [params, setParams] = useState<LandPatternParams>(emptyParams('sop'))
  const [centerPadW, setCenterPadW] = useState(2.0)
  const [centerPadH, setCenterPadH] = useState(2.0)
  const [customPadsJson, setCustomPadsJson] = useState('[]')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editingFootprint) {
      const next = emptyParams(type)
      setParams(next)
      if (type === 'custom') setCustomPadsJson('[]')
    }
  }, [type, editingFootprint])

  const computed = computeFootprint({
    ...params,
    ...(type === 'qfn' ? { centerPad: { w: centerPadW, h: centerPadH } } : {}),
    ...(type === 'custom'
      ? {
          customPads: (() => {
            try {
              const parsed = JSON.parse(customPadsJson || '[]')
              return Array.isArray(parsed) ? parsed : []
            } catch {
              return []
            }
          })()
        }
      : {})
  })

  // In edit mode we keep the existing pads/outline and only allow renaming.
  const previewPads = editingFootprint ? editingFootprint.pads : computed.pads
  const outlineW = editingFootprint ? editingFootprint.outlineW : computed.outlineW
  const outlineH = editingFootprint ? editingFootprint.outlineH : computed.outlineH

  const scale = Math.min(220 / Math.max(outlineW, 1), 150 / Math.max(outlineH, 1), 30)
  const bodyPxW = outlineW * scale
  const bodyPxH = outlineH * scale

  function num(field: keyof LandPatternParams, value: string) {
    const parsed = parseFloat(value)
    if (!Number.isFinite(parsed)) return
    setParams((prev: LandPatternParams) => ({ ...prev, [field]: parsed }))
  }

  function save() {
    setError('')
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Footprint needs a name.')
      return
    }
    const existing = spec.footprints ?? []
    const nameTaken = existing.some((f) => f.name === trimmed && f.id !== (editingFootprint?.id ?? ''))
    if (nameTaken) {
      setError(`A footprint named "${trimmed}" already exists.`)
      return
    }

    if (editingFootprint) {
      onSave({ ...editingFootprint, name: trimmed, description: description.trim() || undefined })
      return
    }

    let customPads = computed.pads
    if (type === 'custom') {
      try {
        const parsed = JSON.parse(customPadsJson || '[]')
        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty')
        customPads = parsed as unknown as FootprintPad[]
      } catch {
        setError('Custom pads must be a non-empty JSON array of {x, y, w, h}.')
        return
      }
    }

    const { pads: finalPads, outlineW: w, outlineH: h, name: computedName, description: computedDesc } =
      computeFootprint({ ...params, customPads })
    const footprint: Footprint = {
      id: newId('fp'),
      name: trimmed || computedName,
      description: description.trim() || computedDesc || undefined,
      pads: finalPads,
      outlineW: w,
      outlineH: h,
      createdAt: Date.now()
    }
    onSave(footprint)
  }

  const showSideFields = SIDE_FIELDS.includes(type) && !editingFootprint

  const renderPad = (p: FootprintPad) => {
    const px = (p.x + outlineW / 2) * scale
    const py = (p.y + outlineH / 2) * scale
    return (
      <div
        key={p.id}
        className="absolute border border-accent bg-accent/10 rounded-sm flex items-center justify-center text-[9px] font-mono text-accent"
        style={{
          left: `${px - (p.w * scale) / 2}px`,
          top: `${py - (p.h * scale) / 2}px`,
          width: `${Math.max(p.w * scale, 6)}px`,
          height: `${Math.max(p.h * scale, 6)}px`
        }}
        title={`Pad ${p.id} • ${p.w}x${p.h}mm • (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`}
      >
        {p.id}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">{editingFootprint ? 'Edit footprint' : 'Footprint editor'}</h3>
        <button onClick={onCancel} className="btn-ghost p-1.5 hover:bg-surface-1" title="Close">
          <span className="sr-only">Close editor</span>
          <TrashIcon size={14} className="text-ink-dim" />
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/50 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-caption uppercase tracking-wider text-ink-faint">Type</span>
            </div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as FootprintKind)}
              disabled={!!editingFootprint}
              className="w-full rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <option value="sop">SOP / SOIC</option>
              <option value="dip">DIP</option>
              <option value="qfn">QFN</option>
              <option value="smd-resistor">0603 resistor</option>
              <option value="smd-capacitor">0603 capacitor</option>
              <option value="custom">Custom pads</option>
            </select>
          </div>

          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-caption uppercase tracking-wider text-ink-faint">Name &amp; description</span>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SOIC-8"
              className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes about this land pattern"
              rows={2}
              className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            />
          </div>

          {showSideFields && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-caption uppercase tracking-wider text-ink-faint">Pins &amp; pitch</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-ink-faint">Pin count</label>
                  <input
                    type="number"
                    value={params.pinCount ?? ''}
                    onChange={(e) => num('pinCount', e.target.value)}
                    min="0"
                    className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-ink-faint">Pitch (mm)</label>
                  <input
                    type="number"
                    value={params.pitch ?? ''}
                    onChange={(e) => num('pitch', e.target.value)}
                    step="0.01"
                    className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-caption uppercase tracking-wider text-ink-faint">Body &amp; pads</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-ink-faint">Body width (mm)</label>
                <input
                  type="number"
                  value={params.bodyWidth ?? ''}
                  onChange={(e) => num('bodyWidth', e.target.value)}
                  step="0.01"
                  className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-ink-faint">Body height (mm)</label>
                <input
                  type="number"
                  value={params.bodyHeight ?? ''}
                  onChange={(e) => num('bodyHeight', e.target.value)}
                  step="0.01"
                  className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-ink-faint">Pad width (mm)</label>
                <input
                  type="number"
                  value={params.padWidth ?? ''}
                  onChange={(e) => num('padWidth', e.target.value)}
                  step="0.01"
                  className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-ink-faint">Pad length (mm)</label>
                <input
                  type="number"
                  value={params.padLength ?? ''}
                  onChange={(e) => num('padLength', e.target.value)}
                  step="0.01"
                  className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-ink-faint">Edge clearance (mm)</label>
                <input
                  type="number"
                  value={params.padToBodyClearance ?? ''}
                  onChange={(e) => num('padToBodyClearance', e.target.value)}
                  step="0.01"
                  className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
              </div>
              {type === 'qfn' && !editingFootprint && (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-ink-faint">Thermal pad W (mm)</label>
                    <input
                      type="number"
                      value={centerPadW}
                      onChange={(e) => setCenterPadW(parseFloat(e.target.value) || 0)}
                      step="0.01"
                      className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-ink-faint">Thermal pad H (mm)</label>
                    <input
                      type="number"
                      value={centerPadH}
                      onChange={(e) => setCenterPadH(parseFloat(e.target.value) || 0)}
                      step="0.01"
                      className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {type === 'custom' && !editingFootprint && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-caption uppercase tracking-wider text-ink-faint">Custom pads</span>
              </div>
              <textarea
                value={customPadsJson}
                onChange={(e) => setCustomPadsJson(e.target.value)}
                rows={4}
                placeholder='[{ "x": 0, "y": 0, "w": 1, "h": 1 }]'
                className="rounded border border-input bg-surface-0 px-3 py-2 text-[12px] font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              />
              <p className="text-[11px] text-ink-faint">
                JSON array of pads with x, y, w, h in mm relative to the body centre.
              </p>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="card p-4 flex-1 min-h-[300px] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-caption uppercase tracking-wider text-ink-faint">Preview</span>
              <span className="text-[11px] text-ink-faint">{previewPads.length} pad(s)</span>
            </div>
            <div
              className="relative flex items-center justify-center border border-line rounded-lg bg-surface-0/50"
              style={{ width: bodyPxW, height: bodyPxH }}
            >
              <div
                className="absolute top-1/2 left-1/2 border border-dashed border-ink-faint"
                style={{
                  width: bodyPxW,
                  height: bodyPxH,
                  transform: `translate(-50%, -50%)`
                }}
              />
              {previewPads.map(renderPad)}
            </div>
            <div className="mt-2 text-[11px] text-ink-faint">
              {outlineW.toFixed(2)}x{outlineH.toFixed(2)}mm body • origin at centre
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="btn-ghost flex-1 text-[12px]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!!error}
              className="btn-primary flex-1 text-[12px]"
            >
              {editingFootprint ? 'Save changes' : 'Save footprint'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
