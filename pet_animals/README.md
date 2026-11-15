# Blocky desktop pets: cat, bird (+ tree), koala

Same style and setup as the Doberman. Each folder has:
- `<name>.glb` - model + rig + animations; load this in the app.
- `<name>.blend` - editable source (saved with Blender 5.3; needs 5.3 or newer).
- `<name>_preview.gif`, `<name>_poses.png` - previews.

`scripts/` rebuilds everything: `pip install bpy`, then `python3 cat.py <output_dir>` (also `bird.py`, `koala.py`;
all three need `blockrig.py` beside them). Add `MODE=all` to also render the previews.

## Common conventions
- glTF: Y up, animal faces +Z (toward a default three.js camera), feet on y = 0. Blender: Z up, faces -Y.
- 24 fps. Every mesh part follows exactly one bone (rigid, doll-like).
- Locomotion clips (`Walk`, `Hop`, `Fly`) play in place; the app moves the root.
- `.L` = the animal's left, `.R` = its right.

## Cat (ginger tabby) - about 1.0 unit tall, 24 bones
| Clip | Frames | Loop | Use |
|---|---|---|---|
| `Idle` | 48 | yes | standing, tail swish, ear twitch |
| `Walk` | 24 | yes | walk cycle, about 0.55 units per second |
| `Sit` | 20 | no | stand -> sit |
| `SitIdle` | 48 | yes | seated, head tilt, tail-tip flick |
| `LickPaw` | 84 | yes | seated: lifts right front paw and licks it, then lowers it (starts and ends in the sit pose) |
| `Stretch` | 60 | no | standing: front down, rear up, back to standing |
| `StandUp` | 20 | no | sit -> stand |

Bones: `root > body > chest > neck > head > jaw > tongue`, `head > ear.L/R`, `body > tail1 > tail2 > tail3`,
`chest > front_upper.L/R > front_lower.L/R > front_paw.L/R`, `body > hind_upper.L/R > hind_lower.L/R > hind_paw.L/R`.

## Bird (blue) + Tree - bird about 0.7 tall, tree about 1.6 tall, 14 bones
| Clip | Frames | Loop | Use |
|---|---|---|---|
| `Idle` | 48 | yes | standing or perched, quick head turns, tail flick |
| `Walk` | 16 | yes | walk cycle, about 0.45 units per second |
| `Hop` | 16 | yes | one hop per loop |
| `Fly` | 10 | yes | wing flap with legs tucked |
| `TakeOff` | 14 | no | stand -> flying pose |
| `Land` | 14 | no | flying pose -> stand |
| `Peck` | 36 | no | pecks the ground twice |
| `Chirp` | 36 | no | head up, beak opens and closes |

Bones: `root > hips > body > head > beak`, `body > tail`, `body > wing.L/R > wing_tip.L/R`, `hips > leg.L/R > foot.L/R`.

`bird.glb` also contains two extra nodes that are not part of the rig:
- `Tree` - a static tree with a side branch, placed to the bird's right-hand side of the screen.
- `PerchPoint` - an empty node (child of `Tree`) on top of the branch. Move the bird's root to this node's world
  position to make it perch.

Typical flight: play `TakeOff`, loop `Fly` while moving the root through the air, play `Land` at the target, then `Idle` or `Chirp`.

## Koala (grey) - about 0.9 tall, 18 bones
| Clip | Frames | Loop | Use |
|---|---|---|---|
| `Idle` | 48 | yes | on all fours, looks around, ear wiggle |
| `Walk` | 30 | yes | slow waddle, about 0.23 units per second |
| `Sit` | 22 | no | all fours -> sitting upright, legs out in front |
| `SitIdle` | 48 | yes | seated, head tilt, ear and toe wiggle |
| `Wave` | 60 | yes | seated: raises right arm and waves (starts and ends in the sit pose) |
| `Sleep` | 72 | yes | seated, head drooped, slow breathing |
| `StandUp` | 22 | no | sitting -> all fours |

Bones: `root > body > chest > head > ear.L/R`,
`chest > front_upper.L/R > front_lower.L/R > front_paw.L/R`, `body > hind_upper.L/R > hind_lower.L/R > hind_paw.L/R`.

## Clip order rules
- Seated clips (`SitIdle`, `LickPaw`, `Wave`, `Sleep`) must come after `Sit` and before `StandUp`.
- Rotate `head` (and `neck` on the cat) at runtime to look at the cursor.
