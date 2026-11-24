# Avatar assets

All avatars share one rigged base: 49 joints, one animation, the same body UVs and the same photo-ready face panel. Each outfit is built into its own GLB.

| Outfit | Model | Body atlas (256×256) | Face placeholder (128×128) | Triangles |
|---|---|---|---|---|
| Leather jacket (default) | `ps1_character_textured.glb` | `ps1_character_texture.png` | `ps1_face_placeholder.png` | 512 |
| Kurta salwar | `ps1_character_kurta_salwar.glb` | `ps1_kurta_salwar_texture.png` | `ps1_kurta_salwar_face.png` | 568 |

The leather jacket has a skinned collar (`Jacket_Collar` material, `ps1_character_collar.png`, 64×64). The kurta salwar also has a skinned skirt piece (`Kurta_Skirt` material, `ps1_kurta_salwar_skirt.png`, 128×128) and looser legs, so use its GLB rather than only swapping the body atlas.

## Face

Replace the `Face_Photo` texture with a fitted photo to personalize any outfit. The panel is projected straight from the front, so it is one island with no seam down the middle of the face.

`ps1_face_profile.json` tells the app how to fit a photo: texture size, where the eyes, nose, mouth, chin and hairline should land (UV, origin top-left), the panel silhouette (`outlineUv`), the human face oval photos are masked to (`ovalUv`), and `surfaceAspect` (the square texture covers an area narrower than it is tall).

The photo app in `app/` also uses, per outfit, masks of skin (red) and hair (green) for the body and both head sides, the two head-side textures (`Side_ViewerLeft`, `Side_ViewerRight`), and a hair overlay (kept on top of the photo). `ps1_side_profile.json` and `ps1_face_depth.png` describe the head sides. `ps1_outfits.json` lists every outfit and its files.

## Adding an outfit

Add a module to `tools/outfits/` with an `id`, output `files`, `bodyColor` and `faceColor`, `skinColors`, `hairColors`, `baseSkin` and `baseHair`, plus optional `deform` (move body vertices) and `pieces` (extra skinned geometry). List it in `OUTFITS` in `tools/build_avatars.js`, and add it to the viewer's menu. Positions are bind-pose mesh units; the rest pose that viewers show is different.

## Credit (required)

This work is based on ["Base for a ps1 style character"](https://sketchfab.com/3d-models/base-for-a-ps1-style-character-b00cffd4773f4b8f8aed8c18a47ff54a) by MR_Fisher, licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Modified: textured, face re-UVed, and clothing geometry added. The credit is also stored in each GLB (`asset.copyright`); keep it in the app and in exports. The unmodified source is in `reference_base_ps1/`.

## Commands

```sh
npm install        # validator and viewer (development only)
npm run build      # regenerate every GLB and its textures
npm test           # validate the GLBs and check orientation, colors, clothing and face UVs
npm run preview    # contact sheets in .preview/
npm run viewer     # three.js viewer at http://localhost:5178
```

Building needs no dependencies beyond Node.
