/**
 * Top-level router for the mobile experience. Two screens:
 *   - PublishedIndex:        list of quarters + published versions
 *   - PublishedScheduleView: read-only grid for a single version
 *
 * No react-router dependency — just a single "selected schedule" state.
 * The mobile surface is deliberately shallow; if we ever need deeper
 * navigation (quarter detail, prof detail, room detail) we'll reach for
 * a router then, not now.
 */
import { useState } from "react"
import { findPublishedById } from "./publishedFixtures"
import { PublishedIndex } from "./PublishedIndex"
import { PublishedScheduleView } from "./PublishedScheduleView"
import "./mobile.css"

export function MobileViewer() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = selectedId ? findPublishedById(selectedId) : null

  if (selected) {
    return (
      <PublishedScheduleView
        schedule={selected}
        onBack={() => setSelectedId(null)}
      />
    )
  }

  return <PublishedIndex onOpen={setSelectedId} />
}
