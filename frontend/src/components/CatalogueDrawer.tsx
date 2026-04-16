import { useEffect } from "react"
import { Catalogue } from "./Catalogue"
import type { CatalogueProps } from "./Catalogue"

/**
 * CatalogueDrawer — slide-out wrapper for the Catalogue.
 *
 * The Catalogue is always mounted (preserves search/filter state between
 * opens). The drawer slides in from the left via CSS transform.
 * A scrim behind it closes the drawer on click or Escape.
 */

export interface CatalogueDrawerProps extends CatalogueProps {
  open: boolean
  onClose: () => void
}

export function CatalogueDrawer({
  open,
  onClose,
  ...catalogueProps
}: CatalogueDrawerProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return (
    <>
      <div
        className={
          "catalogue-drawer__scrim" +
          (open ? " catalogue-drawer__scrim--visible" : "")
        }
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={
          "catalogue-drawer" + (open ? " catalogue-drawer--open" : "")
        }
        aria-hidden={!open}
      >
        <div className="catalogue-drawer__header">
          <span className="catalogue-drawer__title">Add Courses</span>
          <button
            type="button"
            className="catalogue-drawer__close"
            onClick={onClose}
            aria-label="Close catalogue"
          >
            ×
          </button>
        </div>
        <Catalogue {...catalogueProps} />
      </div>
    </>
  )
}
