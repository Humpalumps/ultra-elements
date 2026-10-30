# Shelved spells

Spells taken out of the launch set. They aren't loaded: the registry only scans `src/spells`.

- `sandstorm.js`: Sandstorm (wind + earth). Taken out because its look wasn't at the launch bar. To bring it back, move it to `src/spells/wind/` (it imports `createStreakField` from `../ice/blizzard.js`).
