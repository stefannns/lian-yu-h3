import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Production builds go somewhere ELSE by default.
   *
   * `next build` and `next dev` both write to .next, so running a build while
   * a dev server is up overwrites the chunks that server is still serving:
   * the page keeps requesting layout.css?v=<old> and gets a 404, and the app
   * renders as unstyled HTML. It looks exactly like broken CSS and is not —
   * the stylesheet is fine, the asset directory was swapped underneath it.
   *
   * This has now happened twice. Pointing builds at .next-build makes the two
   * unable to collide at all, rather than relying on remembering not to.
   */
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  // Off on purpose. Strict mode double-invokes effects in development, and
  // in this app an effect fires a video generation — a double mount would
  // silently bill two h3 clips for every one the player sees.
  reactStrictMode: false,
};

export default nextConfig;
