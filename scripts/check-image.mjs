/**
 * 图像链路自检 —— node scripts/check-image.mjs
 *
 * Says which credential it will use, why, and then actually makes one image.
 * Standalone on purpose: it reads .env.local itself and imports nothing from
 * the app, so it still works when the app will not start.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z_]+)=\s*(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || "us-central1";
const model = process.env.VERTEX_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image";
const key = process.env.GOOGLE_IMAGE_API_KEY || process.env.GOOGLE_API_KEY;
const sa = process.env.GOOGLE_APPLICATION_CREDENTIALS;

console.log("project :", project || "(unset — Gemini API mode)");
console.log("model   :", model);
console.log("SA file :", sa ? (existsSync(sa) ? `${sa}  ✓ exists` : `${sa}  ✗ NOT FOUND`) : "(unset)");
console.log("API key :", key ? `…${key.slice(-6)}` : "(unset)");

let url, headers = { "Content-Type": "application/json" }, via;
let token = null;
if (project) {
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    token = (await (await auth.getClient()).getAccessToken()).token ?? null;
  } catch (e) {
    console.log("\nOAuth failed:", e.message.split("\n")[0]);
  }
}
if (project && token) {
  via = "Vertex AI  (OAuth)";
  url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  headers.Authorization = `Bearer ${token}`;
} else if (key) {
  via = "Gemini API  (API key)";
  url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  headers["x-goog-api-key"] = key;
} else {
  console.log("\nNo usable credential. Set GOOGLE_APPLICATION_CREDENTIALS (+ GOOGLE_CLOUD_PROJECT), or GOOGLE_IMAGE_API_KEY.");
  process.exit(1);
}
console.log("route   :", via, "\n");

const r = await fetch(url, {
  method: "POST",
  headers,
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "A single ripe red apple on a plain white table, soft daylight." }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "3:4" } },
  }),
});
const text = await r.text();
if (r.status !== 200) {
  let e; try { e = JSON.parse(text).error; } catch {}
  console.log(`FAILED  ${r.status}  ${e?.status ?? ""}`);
  console.log(e?.message ?? text.slice(0, 400));
  for (const d of e?.details ?? []) if (d.reason) console.log("  reason:", d.reason, "| consumer:", d.metadata?.consumer);
  process.exitCode = 1;
} else {
const parts = JSON.parse(text).candidates?.[0]?.content?.parts ?? [];
const data = parts.map((p) => p.inlineData?.data ?? p.inline_data?.data).find(Boolean);
if (!data) {
  console.log("200 but no image in the reply.");
  process.exitCode = 1;
} else {
  const buf = Buffer.from(data, "base64");
  writeFileSync("probe-apple.jpg", buf);
  console.log(`OK — ${buf.length} bytes written to probe-apple.jpg`);
}
}
