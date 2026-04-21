/**
 * Desktop twin of MobileBrandEyebrow. Sits above the topbar title so the
 * SCAD wordmark + :Prototype status travels with the brand across surfaces.
 * Kept as a separate component from the mobile one because the typographic
 * treatment diverges (topbar context vs. page-header context) and the CSS
 * classes live in App.css instead of mobile.css.
 */
export function BrandEyebrow() {
  return (
    <div className="brand-eyebrow">
      SCAD<span className="brand-eyebrow__tag">:Prototype</span>
    </div>
  )
}
