# V10.0.0 — Graphics Overhaul & Core Logic Bug Fixes

Release date: 2026-11-23

## Graphics & Visual Upgrades

- **Separate Outdoor & Indoor PMREM Environment Lighting**: Split sky environment reflections from warm architectural indoor studio reflections, eliminating washed-out pastel haze indoors and restoring rich dark woods, crimson carpets, emerald chalkboards, and natural hair/fabric contrast.
- **Complete Character Redesign (Vietnamese 20/11 Aesthetic)**:
  - Fixed hair dome geometry clipping through character faces across all scenes.
  - Added expressive faces with catchlights, brows, subtle rosy cheeks, and warm smiles.
  - Added culturally authentic outfits: traditional Vietnamese **Áo Dài** (mandarin collar, brooch, sash, flowing silk panels) for female teachers, tailored blazer + tie + glasses for male teachers, and crisp white school uniforms with flush red scarves (`khăn quàng đỏ`) and pleated skirts/trousers for students.
- **Campus & Architecture**:
  - Added windows, sills, and vertical 20/11 banners on the south-facing (`+Z`) facades of both Tòa Xanh and Tòa Hồng.
  - Upgraded the Welcome Gate with clean tiered roof fascias, grounded side pillars, and bracketed glowing festival lanterns (removed floating corner cones).
  - Replaced sharp cone mountains with layered rolling hills and upgraded campus trees with Vietnamese flame-tree (`phượng vĩ`) and golden blossom clusters.
  - Improved default Campus establishing camera framing so the Welcome Gate, protagonist, Honda Cub scooter, fountain, and both buildings are clearly visible together.
- **Open Hallways & Stairwells**:
  - Replaced opaque 4.25m solid stairwell side walls with low concrete curbs and tempered glass balustrades + steel handrails so hallways, banners, and classroom doors remain visually open.
  - Fixed corridor floor gloss overlay so it respects floor stairwell cutouts on Floors 2 and 3.
  - Adjusted hallway floor banners and default overview camera framing to avoid overlapping classroom door signage.
- **Classroom & Room Overhauls (Floors 1–3, Blue & Pink Buildings)**:
  - Widened classroom podium (`bục giảng`) to 5.8m so both teacher and open-leg teacher desk rest squarely on top (fixing floating legs in Room 101 and levitating teacher in Room 102).
  - Upgraded Room 101 emerald chalkboard with radial slate shading, corner chalk flowers, padded typography, and front-face-only material mapping.
  - Repositioned Pink Room 101 balloons and side-wall bunting clear of banners/clock/camera, and replaced monolithic display blocks with 4-legged wooden tables and runners.
  - Raised Room 102 ceiling projector clear of the front slogan, moved desk vase clear of the `01/04` counter, added front-face-only slide material, and replaced the flat wall newspaper sign with a richly illustrated multi-column Vietnamese wall newspaper (`Báo Tường 20/11`).
  - Added a 3-painting centerpiece gallery feature wall with museum track lighting in Room 103, and upgraded all 6 gallery paintings & 6 Room 301 nostalgic photos with multi-layered painterly illustrations rendered synchronously via cached `CanvasTexture`.
  - Upgraded Room 201 (multi-part executive armchairs in Pink Boardroom; stage steps, pleated curtains, footlights & mic stand in Blue Auditorium), Room 202 (sculpted golden chalice trophies & TV camera lenses/ON-AIR tally lights), Room 301 (4 distinct 3D keepsakes: fountain pen, chalk box, open lesson plan, gold 20/11 medal), and Room 302 (branched Hoa Đào & Hoa Mai tribute trees with fairy lights and cord-hung cards; ribbon-wrapped gifts & wax-sealed letters).
  - Added 3D golden & rose celebration petal particle bursts during the flower gifting ceremony.
- **UI & Typography Polish**:
  - Removed broken Three.js r128 `KTX2Loader.js` CDN script (eliminating HTTP 404 / `ERR_BLOCKED_BY_ORB` on load).
  - Surfaced a clean scene-location badge in the HUD, first-person control hints, 3D interactive hover cursor + Vietnamese tooltips, and consistent `Inter` typography with crisp Vietnamese diacritics.

## Core Logic Bug Fixes

- **First-Person Movement**: Fixed inverted `A`/`D` strafing vector math in first-person POV and upgraded third-person WASD to move relative to camera horizontal heading.
- **Collision & Room Bounds**: Added missing interior colliders across Rooms 201, 202, 301, and 302, and synced walkable/camera/exit-door bounds dynamically to each room's real `activeRoomSpec`.
- **Waypoint Pathfinding**:
  - Campus building entry now routes around the central fountain and flower beds.
  - Hallway classroom entry traverses the open front corridor lane before turning into doorways, preventing walking through staircases.
  - Room exit and gift-ceremony approach align to the central aisle first to avoid clipping desks.
- **Door Exit Mapping**: Clicking 3D exit doors inside Rooms 102, 103, 202, and 302 now returns the protagonist to the actual room door (`ROOM_DOOR_X[sceneMode]`) instead of stale `lastExitedDoorX`.
- **Orbit Drag vs. Click**: Ignored canvas `click` events after >6px pointer drags so orbiting the camera never accidentally triggers 3D interactions.
- **Scene Transitions & Memory Cleanup**: Reset `campusEnterBuildingAnim`, `introElapsed`, entrance door swing angles, stale room refs, and `ceilingFans` cleanly on scene switches; reused/disposed custom chalkboard textures instead of leaking into `TEXTURE_CACHE`.
- **Text Wrapping & Anthology Spread**: Fixed `slideWrapLines()` dropping words on the last line; applied proper word wrapping to chalkboard wishes, Pink 301 frames, and certificates; preserved poem `\n` line breaks in the Anthology open-book spread and safely cleared page-turn timers on close.
- **Modals & Persistence**:
  - Synced active highlight styles on Tribute Tree selection buttons (`🌸`/`🌼`) and Pink 301 tabs (`📷`/`💌`).
  - Added validation for empty inputs & missing photo selection, rendered `#p301-photo-caption` onto uploaded photos, persisted Pink 301 hung frames and Pink 302 table offerings across room visits (fixing slot index replacement bug), fixed Pink 302 button label (`Miễn phí`), added Prev/Next controls in Artwork & Photo Zoom modals, added Escape & backdrop-click modal closing, and modernized clipboard copy with `navigator.clipboard.writeText`.
- **Character Animations**: Hooked up idle life animations for seated Room 101 students, Pink 101 decorating students, and Pink 201 boardroom teachers.

## Verification

- Verified `script.js` syntax (`node --check`) and HTML-to-JS DOM ID consistency (116 HTML IDs, 0 missing references).
- Verified live in headless Chromium across Intro, Campus, Blue & Pink Hallway 1, Blue & Pink Room 101, Room 102, and Room 103: **0 HTTP 404/network errors** and **0 uncaught JS console errors**.
