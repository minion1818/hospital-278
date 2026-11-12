// Launches Vitest with normalized Windows paths.
//
// Windows: when the shell's cwd uses a lowercase drive letter ("c:" instead of
// "C:"), as VS Code terminals often do, Vitest loads its own modules twice
// (once per spelling) and every suite fails with
// "Cannot read properties of undefined (reading 'config')".
// Vitest reads these paths at startup, so they are fixed before it starts.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

/** Uppercases a Windows drive letter ("c:" becomes "C:"); no-op elsewhere. */
const normalize = (p) =>
  process.platform === "win32" && /^[a-z]:/.test(p) ? p[0].toUpperCase() + p.slice(1) : p;

const require = createRequire(import.meta.url);
// The bin file isn't in vitest's "exports" map, so locate it via package.json
const vitestPkg = require.resolve("vitest/package.json");
const vitestBin = normalize(path.join(path.dirname(vitestPkg), require(vitestPkg).bin.vitest));

const result = spawnSync(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  cwd: normalize(process.cwd()),
  stdio: "inherit",
});
process.exit(result.status ?? 1);
