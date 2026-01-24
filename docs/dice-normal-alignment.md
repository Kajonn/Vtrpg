# Aligning dice face normals with rendered models

This project determines the upward-facing value by rotating predefined face normals by the die's final quaternion and choosing the normal that is most aligned with the world up vector `(0, 0, 1)`. When the face normals do not match how numbers are placed on the model, the calculated result will be wrong even though the physics is correct. The relevant mapping lives in `DICE_FACE_NORMALS` in `src/components/DiceRenderer.jsx`.

To make the alignment process repeatable, a debug mode is available.

## Debug mode helpers

Enable dice debug mode by adding query parameters to a room URL:

```text
/rooms/<room-slug>?diceDebug=1&diceStepsPerFrame=8&diceClearMin=20000
```

Useful parameters:

- `diceDebug=1`: Enables debug output and helpers described below.
- `diceStepsPerFrame=<n>`: Advances multiple physics steps per animation frame in debug mode (default `6`). This dramatically speeds up iteration without affecting normal gameplay.
- `diceClearMin=<ms>`: Ensures dice stay on screen for at least this duration in debug mode.
- `diceVelocity=<multiplier>`: Scales linear velocity in debug mode if you need calmer or more chaotic rolls.
- `diceSeed=<uint32>`: Optional fixed seed applied on page load.

When debug mode is enabled:

- The last roll's analysis is exposed at `window.__diceDebugLastResults`.
- You can force a specific seed without reloading the page by setting `window.__diceDebugSeedOverride` in the browser console before rolling.

Each entry in `window.__diceDebugLastResults` includes:

- `topValue`: the calculated result.
- `bestNormal`: the local-space normal that was treated as "up".
- `screen`: the die center in canvas pixel coordinates (useful for targeted screenshots).

## Step-by-step alignment workflow

1. **Open a room as GM** and append debug params, for example:
   `/rooms/<room-slug>?diceDebug=1&diceStepsPerFrame=8&diceClearMin=20000`.
2. **Reduce to one die** and select the die type you want to align (e.g., `d6`).
3. **Set a seed** in the browser console:
   `window.__diceDebugSeedOverride = 12`.
4. Click **Roll dice**.
5. Compare:
   - The number rendered on the top face.
   - The calculated result in `window.__diceDebugLastResults[0].topValue` (or the Dice Log).
6. Record the mapping between:
   - `bestNormal` (the direction in local space).
   - The number you actually see on top.
7. Update `DICE_FACE_NORMALS` so each normal points to the number that is actually printed on that face.
8. Repeat with additional seeds until all faces have been confirmed.

### Tip: cover all directions quickly

In debug mode, you can scan seeds quickly by repeatedly setting `window.__diceDebugSeedOverride` and rolling. Once you observe a new `bestNormal` direction (`±X`, `±Y`, `±Z`), capture the mapping and move on.

## D6 alignment result

Using the workflow above, the d6 model maps to normals as follows:

- `+Z` → `3`
- `-Z` → `4`
- `+Y` → `1`
- `-Y` → `6`
- `+X` → `5`
- `-X` → `2`

This mapping preserves standard opposite sides summing to 7.

## Applying this to other dice

For other dice types (d8, d10, d12, d20):

1. Enable debug mode with the same query parameters.
2. Select the die type you want to align.
3. Use `window.__diceDebugSeedOverride = <seed>` to iterate through different outcomes.
4. For each roll, read:
   - The rendered top value.
   - The `bestNormal` direction from `window.__diceDebugLastResults`.
5. Update the corresponding entry in `DICE_FACE_NORMALS`.
6. Verify with several seeds after the update.

Because debug mode is gated behind `diceDebug=1`, these helpers do not change normal gameplay.
