/**
 * 剧本试跑 —— npm run script -- "想赖床，让他多陪一会儿" [拍数] [画风] [选择序列]
 *
 *   npm run script -- "想赖床"                 3 拍，日系动画，一路选第一个
 *   npm run script -- "想去海边" 5 real 1,0,1  5 拍，写实电影，按序列选
 *
 * 只花文本 key。不生成任何图片或视频。
 */
const [, , wish, beatsArg, styleArg, picksArg] = process.argv;
if (!wish) {
  console.log('用法: npm run script -- "你的愿望" [拍数] [anime|cg3d|real] [0,1,0]');
  process.exit(1);
}
const base = process.env.APP_BASE_URL || "http://localhost:3210";
const body = {
  wish,
  beats: Number(beatsArg) || 3,
  style: styleArg || "anime",
  picks: (picksArg || "").split(",").filter(Boolean).map(Number),
};

const D = "\x1b[2m", B = "\x1b[1m", R = "\x1b[0m";
const G = "\x1b[38;5;180m", P = "\x1b[38;5;175m", C = "\x1b[38;5;109m";
const rule = (t) => console.log(`\n${D}${"─".repeat(76)}${R}\n${B}${t}${R}`);
const wrap = (s, indent = "  ") =>
  (s || "").replace(/(.{1,72})(\s|$)/g, `${indent}$1\n`).trimEnd();

const res = await fetch(`${base}/api/dryrun`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const out = await res.json();
if (!res.ok) {
  console.log("失败:", out.error ?? res.status, out.detail ?? "");
  process.exit(1);
}

console.log(`${B}男主${R} ${out.him.name}   ${D}${out.him.descriptor}${R}`);
console.log(`${B}画风${R} ${out.style}   ${B}愿望${R} ${out.wish}`);

for (const s of out.script) {
  if (s.kind === "error") { rule(`第 ${s.beat} 拍  —  ${s.error}`); continue; }
  const how = s.cut ? `  [38;5;173m✂ 切场景[0m` : s.beat > 1 ? `  ${D}接上一帧${R}` : "";
  rule(`第 ${s.beat} 拍  ${s.kind === "beat" ? `· 选了 [${s.took + 1}]` : `· ${s.kind}`}${how}`);

  if (s.line) console.log(`\n${P}「${s.line}」${R}`);
  if (s.narration) console.log(`\n${wrap(s.narration, "")}`);
  if (s.scene) console.log(`\n${D}scene: ${s.scene}${R}`);

  if (s.choices) {
    console.log("");
    s.choices.forEach((c, i) =>
      console.log(
        `  ${i === s.took ? `${G}▸${R}` : " "} [${i + 1}] ${c.label}` +
          (c.cut ? `  [38;5;173m✂[0m` : "")
      )
    );
  }

  console.log(`\n${C}镜头提示词 (${s.prompt.length} 字符)${R}`);
  console.log(`${D}${wrap(s.prompt)}${R}`);
}
console.log("");
