# V9.0.0 — Visual Clarity & Layout Clearance

Release date: 2026-11-21

## Fixes

- Added bounded 2D footprint validation for independent furniture and people in rooms 101, 102 and 103. Desks/chairs/seated students remain deliberately grouped.
- Moved the classroom wall clock away from overlapping signage and ceiling.
- Adjusted the reading student, gallery visitors, display furniture and collision footprints to improve walk-through clearance.
- Separated coplanar canvas and book-cover faces from underlying geometry and enabled polygon offset on flat artwork.
- Added subtle, Ultra-only hard-surface edge highlights for desks, chairs, podium, book covers and stair treads.
- Increased anisotropic texture filtering, enabled texture mipmaps and tightened shadow filtering.
- Lightened vignette and reduced distant fog, particularly in Ultra mode.
- Added versioned static asset URLs: `script.js?v=9.0.0` and `style.css?v=9.0.0`.

## Preserved

- Two distinct camera modes and keyboard movement in first-person mode.
- Two-flight stair routes with intermediate landings and floor-specific stairs.
- Synchronized gifting and speech choreography.
- Room 102 on-board swipeable slide deck.
- Room 103 anthology book view and reading/page-turn animation.

## Verification scope

- JavaScript syntax and HTML-script element ID consistency checked.
- Static AABB clearance simulations for reserved independent groups in rooms 101, 102, 103 passed.
- Full browser-based WebGL visual regression test and real-device frame-rate benchmark were **not** performed. Collisions between animated limb geometry and irregular props may still require visual inspection.
