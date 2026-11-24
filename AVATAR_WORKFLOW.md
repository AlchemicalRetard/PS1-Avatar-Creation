# Photo-to-avatar workflow

## Product goal

Turn one user photo into a recognizable, low-poly, PS1-inspired avatar using prepared base heads, bodies, outfits, and hairstyles. The photo personalizes the face texture; it does not reconstruct a complete person or infer a hidden body.

## Workflow principle

Use an orchestrator to move a job through explicit stages. Keep image geometry, texture generation, and mesh validation in deterministic computer-vision and 3D code. Use an AI agent only for bounded decisions that benefit from language or visual judgment, such as explaining why a photo is unsuitable or suggesting a safe retry. Do not make a free-running agent responsible for modifying arbitrary meshes or deciding when a job is complete.

## First-version stages

1. **Upload and consent** — Explain the use of the photo and retention period. Accept JPEG/PNG, enforce size limits, and store the original in temporary private storage.
2. **Photo check** — Detect whether there is one usable face, whether it is large and front-facing enough, and whether lighting/occlusion is acceptable. Return actionable guidance when it is not. Do not continue on ambiguous or multiple-face images; ask the user to choose/crop.
3. **Face alignment** — Detect landmarks and align the face to the selected base head's front-facing UV layout. Preserve the source crop only for the face region.
4. **Texture build** — Fit the crop to the head UV map, fill side regions with a controlled blend/symmetry fallback, and apply the selected low-resolution palette and texture treatment. Avoid stretching the source photo over the whole head.
5. **Avatar assembly** — Apply the face texture to a chosen base head, then attach user-selected hair, body, outfit, and accessories. Keep these choices editable and independent of gender labels.
6. **Automated render check** — Render front, three-quarter, and side previews. Check that the face is present, UV seams are tolerable, materials load, and the model has valid bounds. Flag for retry or use a deterministic fallback; do not silently call a poor result successful.
7. **Preview and edit** — Show the avatar and let the user adjust crop, skin tone, hair, outfit, and stylization before accepting.
8. **Export and cleanup** — Export the selected formats only after acceptance. Delete temporary source photos and intermediate crops according to the stated retention policy.

## Orchestration states

`uploaded -> checking -> needs_user_input | rejected | processing -> preview_ready -> accepted -> exporting -> complete`

Every stage should be idempotent, record a stage result and error code, and have bounded retries. A retry should resume from the last successful stage rather than restart the whole job. The browser should receive progress events and a stable job ID, not direct access to storage or model workers.

## Bounded AI responsibilities

- **Photo guidance (optional):** Turn structured photo-check results into concise user guidance. It may not override failed checks.
- **Visual QA (later):** Review rendered previews for obvious aesthetic defects and request one of a small set of allowed fixes, such as rerendering with a different crop or fallback texture. It cannot change the base mesh or invent a new pipeline action.

Landmarks, segmentation, UV mapping, palette reduction, mesh assembly, format conversion, and cleanup should remain ordinary code or specialized model services with validated inputs/outputs. For the MVP, omit the AI agents entirely if deterministic checks are enough.

## Stage contracts

- **Photo check input:** temporary image reference and user-selected crop, if any.
- **Photo check output:** `status`, face count, pose/quality scores, normalized landmarks, and user-facing reason codes. Never return a public storage URL.
- **Texture build input:** validated crop, landmarks, base-head UV profile, and style preset ID.
- **Texture build output:** texture asset reference, dimensions, UV profile ID, and warnings.
- **Avatar assembly output:** model asset reference, preview render references, chosen preset IDs, and validation report.
- **Export output:** downloadable model references and cleanup status.

## MVP scope

- One photo and one face.
- Two or three prepared head/body proportions and a small set of outfits and hairstyles.
- Front-facing portrait input first; provide crop and recapture guidance.
- Face texture personalization, not automatic clothing/body reconstruction.
- Browser preview and one model export format initially.
- Explicit photo deletion/retention behavior and a user-triggered delete action.

## Success measures

- Share of uploads that reach a usable preview.
- Time from upload to first preview.
- Retry and manual-crop rate.
- User edits before acceptance.
- Export and share rate.
- Face-texture quality ratings across front and three-quarter views.

## Next implementation decision

The first starter asset uses glTF 2.0 binary (`.glb`), which supports both browser preview and download. Keep the UV texture pipeline behind a small interface so avatar presets and the rendering stack can change without changing upload orchestration.
