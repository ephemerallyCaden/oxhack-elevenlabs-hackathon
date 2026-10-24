# Royalty-Free Sound Effects — Starter Kit

> All CC0 unless noted. Download these first.

## Quick Starter Kit (14 files)

| Category | Freesound/Source ID | License | URL |
|---|---|---|---|
| **OBJECTION sting** | harrisonlace/816376 | CC0 | freesound.org/people/harrisonlace/sounds/816376/ |
| **Desk slam** | rachaelbuchanan/266323 | CC0 | freesound.org/people/rachaelbuchanan/sounds/266323/ |
| **Gavel** | Aerny/618138 | CC0 | freesound.org/people/Aerny/sounds/618138/ |
| **Crowd gasp** | Dvideoguy/207779 | CC0 | freesound.org/people/Dvideoguy/sounds/207779/ |
| **Crowd murmur** | craigsmith/480756 | CC0 | freesound.org/people/craigsmith/sounds/480756/ |
| **Crowd cheer** | Kinoton/511788 | CC0 | freesound.org/people/Kinoton/sounds/511788/ |
| **Text blip** | sprinkleCipher/752745 | CC0 | freesound.org/people/sprinkleCipher/sounds/752745/ |
| **Tension BGM** | Unsolved Investigation | CC0 | opengameart.org |
| **Calm BGM** | First Light Particles | CC0 | opengameart.org |
| **Pursuit BGM** | Final Confrontation | CC-BY 4.0 | opengameart.org |
| **Button press** | el_boss/788611 | CC0 | freesound.org/people/el_boss/sounds/788611/ |
| **Timer tick** | JJTaynos/733929 | CC0 | freesound.org/people/JJTaynos/sounds/733929/ |
| **Success chime** | colorsCrimsonTears/607407 | CC0 | freesound.org/people/colorsCrimsonTears/sounds/607407/ |
| **Penalty buzzer** | Breviceps/493163 | CC0 | freesound.org/people/Breviceps/sounds/493163/ |

## Attribution (for CC-BY tracks)

```
Music credits:
- "Final Confrontation" by tcarisland (CC-BY 4.0) — opengameart.org
```

## Text Blip Implementation

Use 3 variants with slight pitch randomization for authentic AA feel:
```js
// Play on each character render (~50ms clip)
const blipSources = [752745, 752746, 752747]; // sprinkleCipher variants
const source = blipSources[Math.floor(Math.random() * 3)];
audioNode.playbackRate.value = 0.95 + Math.random() * 0.1;
```

## Triple Gavel

Take the single gavel hit (Aerny/618138) and play 3x with ~300ms spacing via Web Audio API.
