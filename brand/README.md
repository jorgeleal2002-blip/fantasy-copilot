# Bigote Siete — the mark

Three cuts of one drawing. They differ by how much detail survives, not by
style, so pick by the size you are placing it at.

| File | Use it | Holds down to |
| --- | --- | --- |
| `badge-primary.svg` | Anywhere it lands at 64px or larger | 64px |
| `crest.svg` | Kit, print, anywhere it should read as a club | 80px — the cross needs room |
| `mark-simple.svg` | Avatars, favicons, anything under 64px | 24px |

`png/` holds raster exports of each on transparent, dark and light grounds,
plus a `-sizes` strip showing where each cut gives out.

The app renders the mark from `src/ui/Mark.tsx` rather than these files — it
swaps between the detailed and simplified cuts on its own at the 64px
threshold. Keep the two in step if you edit the geometry.

## Colours

| Role | Hex |
| --- | --- |
| Field red | `#C8102E` |
| Ring navy | `#00205B` |
| Durag white | `#FFFFFF` |
| Skin | `#C98A55` |
| Skin shadow | `#B67846` |

Red and navy are Norway's. The two skin tones exist only inside the face —
never as interface colours.

## Rules

- **The moustache needs the nose above it and the mouth below.** Remove either
  and it reads as a grin.
- **Keep clear space** of at least the ring's thickness on every side.
- **Don't recolour the face.** Red, navy and white can flip for one-colour
  print; the skin tones stay, or the mark stops being a person.
- **Swap cuts, don't scale one.** Shrinking the badge past 64px turns the face
  to mud.
