/**
 * A production build that is safe to run while `npm run dev` is up.
 *
 * `next build` and `next dev` both write to .next by default, so building
 * during a dev session overwrites the chunks that server is still serving.
 * The page then requests layout.css?v=<old> and gets a 404, and the app
 * renders as unstyled HTML — which looks exactly like broken CSS and is not.
 * This sends the build to .next-build instead (see distDir in next.config.ts).
 */
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "build"],
  { stdio: "inherit", env: { ...process.env, NEXT_BUILD_DIR: ".next-build" }, shell: process.platform === "win32" }
);
process.exit(result.status ?? 1);
