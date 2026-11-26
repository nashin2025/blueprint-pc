import { useCallback, useEffect, useState } from 'react'
import type { CartItem } from '@shared/types'
import { CartIcon, TrashIcon } from '../components/Icons'

interface CartDrawerProps {
  open: boolean
  onClose: () => void
  projectId: string | null
}

export default function CartDrawer({ open, onClose, projectId }: CartDrawerProps) {
  const [cart, setCart] = useState<{ id: string; createdAt: number; updatedAt: number } | null>(null)
  const [items, setItems] = useState<CartItem[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const loadCart = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const cartRes = await window.api.cartGetOrCreate(projectId)
      if (cartRes.ok && cartRes.data) {
        setCart(cartRes.data)
        const itemsRes = await window.api.cartList(cartRes.data.id)
        if (itemsRes.ok && itemsRes.data) setItems(itemsRes.data)
      }
    } catch {
      // Ignore errors — cart is optional
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open && projectId) loadCart()
  }, [open, projectId, loadCart])

  async function handleRemove(componentId: string) {
    if (!cart) return
    setLoading(true)
    try {
      await window.api.cartRemove({ cartId: cart.id, componentId })
      const itemsRes = await window.api.cartList(cart.id)
      if (itemsRes.ok && itemsRes.data) setItems(itemsRes.data)
    } catch {
      // Ignore
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    if (!cart) return
    setExporting(true)
    try {
      const res = await window.api.cartExport(cart.id)
      if (res.ok && res.data) {
        // Trigger download
        const blob = new Blob([res.data], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `cart_${projectId}_${Date.now()}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch {
      // Ignore
    } finally {
      setExporting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end p-4"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm" onClick={(e) => e.stopPropagation()} />
      <div className="relative z-10 w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden bg-surface-0 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h3 className="text-sm font-semibold tracking-tight">Shopping Cart</h3>
          <button
            onClick={onClose}
            className="btn-ghost p-1.5 hover:bg-surface-1"
          >
            <span className="sr-only">Close</span>
            <TrashIcon size={16} className="text-ink-dim" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
              <p className="mt-2 text-[12px] text-ink-dim">Loading cart…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-surface-1 mb-4 text-ink-faint">
                <CartIcon size={20} />
              </div>
              <h3 className="text-sm font-medium">Your cart is empty</h3>
              <p className="mt-1 text-[12px] text-ink-dim">
                Add parts from the part library or BOM to build your order.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface-1 p-3">
                  <div className="flex size-8 items-center justify-center rounded-md bg-surface-2 text-ink-dim shrink-0">
                    <CartIcon size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm font-medium truncate">{item.componentName}</span>
                      <span className="ml-auto text-[11px] font-mono text-ink-dim">{item.unitPriceCurrency.toUpperCase()} {item.unitPrice?.toFixed(2) ?? '—'}</span>
                    </div>
                    {item.componentPartName && (
                      <span className="text-[11px] text-ink-faint">{item.componentPartName}</span>
                    )}
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[11px] text-ink-faint">Qty {item.quantity}</span>
                      {item.retailerUrl && (
                        <a
                          href={item.retailerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-accent underline underline-offset-2 hover:text-accent/90"
                        >
                          Buy
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(item.componentId)}
                    className="btn-ghost p-1 hover:bg-surface-2"
                    title="Remove"
                  >
                    <TrashIcon size={14} className="text-ink-dim" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-line px-5 py-3 flex items-center justify-between">
          <div className="text-right">
            <div className="text-[11px] text-ink-faint">Total items</div>
            <div className="text-sm font-semibold">
              {items.reduce((sum, i) => sum + i.quantity, 0)}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="btn-secondary text-sm"
            >
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <button
              onClick={onClose}
              className="btn-primary text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
