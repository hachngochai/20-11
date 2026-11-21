# 3D Character Assets — Sources and Runtime Fallback

Version: character update V6 (2026-11-21)

The application optionally loads two **CC0 1.0** rigged and animated GLB character assets at runtime. Files are hosted by the respective public asset service, not copied into this repository.

| Role in the demo | Asset | Source | Pinned HTTPS download | License |
| --- | --- | --- | --- | --- |
| Male standing characters | Casual Walker (hoodie, jeans, sneakers) | https://tevy.dev/models/casual-walker | https://tevy.dev/models/casual-walker/v1/lod1.glb | CC0 1.0 |
| Female standing characters | Hiker (outdoor clothing) | https://tevy.dev/models/hiker | https://tevy.dev/models/hiker/v1/lod1.glb | CC0 1.0 |

The player and teacher roles may request the higher-detail `lod0.glb` variants at the same pinned version path.

License: https://creativecommons.org/publicdomain/zero/1.0/

The source provider documents a shared 56-bone humanoid skeleton, and the animation clips `idle`, `walk`, `look_around`, and `wave`.

Implementation: Three.js r128, GLTFLoader, KTX2Loader, MeshoptDecoder, and SkeletonUtils.  Assets need Internet access and a browser/WebGL decoder compatible with these compressed models. The procedural character is preserved as an automatic fallback if scripts, downloads, decoders, or loading fail.

**Important visual scope:** The external assets are currently stylized *casual* people, not custom-modeled Vietnamese school uniforms or teacher `áo dài`. Seated characters deliberately retain the existing seated-pose geometry because these GLBs do not provide an authored sit clip. Rigging and wardrobe matching require a later modeling pass.

Staircase: two flights, an intermediate landing and turning path are constructed procedurally in `script.js`, without third-party mesh assets.
