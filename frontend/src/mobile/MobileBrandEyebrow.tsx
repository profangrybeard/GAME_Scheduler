/**
 * Shared brand eyebrow for the mobile surface: the SCAD wordmark with a
 * small orange ":Prototype" tag appended. Used above the main headline on
 * every mobile screen so the under-construction status travels with the
 * brand, wherever the user lands.
 */
export function MobileBrandEyebrow() {
  return (
    <div className="mobile-eyebrow">
      SCAD<span className="mobile-eyebrow-tag">:Prototype</span>
    </div>
  )
}
