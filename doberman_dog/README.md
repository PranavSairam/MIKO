# Blocky Doberman desktop pet asset

## Files
- `doberman.glb` - model + rig + animations; load this in the app.
- `doberman.blend` - editable source (saved with Blender 5.3; needs 5.3 or newer).
- `build_doberman.py` - regenerates everything: `pip install bpy` then `python3 build_doberman.py <output_dir>`.
- `doberman_preview.gif`, `poses.png` - previews.

## Orientation and size
- glTF: Y up, dog faces +Z (toward a default three.js camera). Blender: Z up, dog faces -Y.
- About 1.45 units tall to the ear tips; paws rest on y = 0 (glTF).

## Animation clips (24 fps)
| Clip | Frames | Loop | Use |
|---|---|---|---|
| `Idle` | 48 | yes | standing, tail wag |
| `Walk` | 24 | yes | in-place walk cycle; the app moves the dog |
| `Sit` | 20 | no | stand -> sit |
| `SitIdle` | 48 | yes | seated, panting, head tilt |
| `StandUp` | 20 | no | sit -> stand |

Walk speed without foot sliding: about 0.9 units per 1 s loop.

## Bones (21)
`root > body > chest > neck > head > jaw, ear.L, ear.R`; `body > tail`;
`chest > front_upper.L/R > front_lower.L/R > front_paw.L/R`;
`body > hind_upper.L/R > hind_lower.L/R > hind_paw.L/R`.

## Cursor behaviour (to implement in the app)
1. Cursor far away: turn the dog toward it, play `Walk`, move it along the screen bottom.
2. Arrived: play `Sit` once, then loop `SitIdle`.
3. Cursor moves away: play `StandUp`, then go back to step 1.
4. Any time: rotate `head` / `neck` bones toward the pointer for a look-at effect.
