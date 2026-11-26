import { useCallback, useState } from 'react'
import type { Component } from '@shared/types'

interface Props {
  /** The component being inspected. Null when nothing is selected. */
  component: Component | null
  /** Called when the user changes a property. */
  onChange: (updates: Partial<Component>) => void
  /** Called when the user closes the inspector. */
  onClose: () => void
}

export default function InspectorPanel({ component, onChange, onClose }: Props) {
  if (!component) return null

  const [name, setName] = useState(component.name)
  const [partName, setPartName] = useState(component.partName ?? '')
  const [category, setCategory] = useState(component.category)
  const [subcategory, setSubcategory] = useState(component.subcategory ?? '')
  const [quantity, setQuantity] = useState(String(component.quantity))
  const [unitPrice, setUnitPrice] = useState(String(component.unitPrice ?? ''))
  const [designator, setDesignator] = useState(component.designator ?? '')
  const [notes, setNotes] = useState(component.notes ?? '')

  const handleSave = useCallback(() => {
    onChange({
      name,
      partName: partName || undefined,
      category,
      subcategory: subcategory || undefined,
      quantity: Math.max(1, parseInt(quantity, 10) || 1),
      unitPrice: unitPrice ? parseFloat(unitPrice) : undefined,
      designator: designator || undefined,
      notes: notes || undefined
    })
  }, [name, partName, category, subcategory, quantity, unitPrice, designator, notes, onChange])

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full md:w-80 max-w-[90vw] bg-surface-1 border-l border-line shadow-2xl flex flex-col animate-fade-up">
      <div className="flex items-center justify-between border-b border-line px-4 py-3 bg-surface-0/50">
        <h3 className="text-sm font-semibold tracking-tight">Inspector</h3>
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1.5 text-[12px] text-ink-dim transition hover:bg-surface-2 hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="space-y-2">
          <label className="label">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field"
          />
        </div>

        <div className="space-y-2">
          <label className="label">Part name / MPN</label>
          <input
            value={partName}
            onChange={(e) => setPartName(e.target.value)}
            placeholder="Manufacturer part number"
            className="input-field"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="label">Category</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="input-field"
            />
          </div>
          <div className="space-y-2">
            <label className="label">Subcategory</label>
            <input
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              placeholder="e.g. Microcontroller"
              className="input-field"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="label">Designator</label>
            <input
              value={designator}
              onChange={(e) => setDesignator(e.target.value)}
              placeholder="R1, C2, U1…"
              className="input-field font-mono"
            />
          </div>
          <div className="space-y-2">
            <label className="label">Quantity</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input-field font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="label">Unit price</label>
            <input
              type="number"
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="0.00"
              className="input-field font-mono"
            />
          </div>
          <div className="space-y-2">
            <label className="label">Unit price currency</label>
            <select
              value="USD"
              onChange={() => {}}
              className="input-field"
            >
              <option>USD</option>
              <option>MVR</option>
              <option>EUR</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="label">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="textarea-field"
          />
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-line/50">
          <button
            onClick={onClose}
            className="btn-ghost"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn-primary"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
