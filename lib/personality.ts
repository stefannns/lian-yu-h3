/** Shared by both interface languages; profiles describe choices, not appearance. */
export type PersonalityKey = "reserved" | "playful";
const triggers: Record<PersonalityKey, RegExp> = {
  reserved: /寡言克制|寡言|话少|少言|内敛|克制|沉默寡言|\b(?:quiet and reserved|reserved|taciturn|soft-spoken|a man of few words)\b/gi,
  playful: /爱逗你|爱逗人|喜欢逗我|爱开玩笑|俏皮|幽默爱逗|\b(?:playful|teasing|witty|likes? to tease|loves? to tease|playful banter)\b/gi,
};

/** Use only on character descriptions, never on ordinary in-scene dialogue. */
export function detectPersonality(text: string): PersonalityKey[] {
  const result: PersonalityKey[] = [];
  for (const key of ["reserved", "playful"] as const) {
    const matches = [...text.matchAll(new RegExp(triggers[key].source, "gi"))];
    if (matches.some(match => {
      const prefix = text.slice(0, match.index).split(/[，。！？,.;!?\n]|但是|但|but\b/i).at(-1) ?? "";
      // Conservative: ambiguous negative descriptions do not force a preset.
      return !/(?:不要|不想|不喜欢|不是|别|不太|不爱|不能|并非|不希望|不|\bnot\b|\bnever\b|\bno\b|\bwithout\b|\bdon['’]t\b|\bavoid\b|\bstop\b)/i.test(prefix);
    })) result.push(key);
  }
  return result;
}

const profiles: Record<PersonalityKey, string> = {
  reserved: "Voice: brief, composed, candid, no rhetorical flirt. Actions: answer honestly then return attention to the shared activity; express care through one purposeful practical adjustment, without deciding for the player. Reaction: allow quiet space; accept refusal immediately, never punish with silence.",
  playful: "Voice: light situational humour or self-directed teasing, not disguised compliments. Actions: pick up the player's actual observation with a small situational or self-directed joke; a game or demonstration is optional, never required. Stillness is valid. Reaction: invite rather than impose; drop the joke immediately if unwelcome.",
};
export function personalityHint(keys: PersonalityKey[]): string {
  return keys.map(key => `[personality:${key}] ${profiles[key]}`).join("\n");
}
export function retainPersonality(generated: string, keys: PersonalityKey[]): string {
  return keys.length ? `${keys.map(k => `[personality:${k}]`).join(" ")} ${generated}` : generated;
}
export function personalityRules(temperament: string): string {
  const keys = (["reserved", "playful"] as const).filter(key => temperament.includes(`[personality:${key}]`));
  return personalityHint([...keys]) + (keys.length > 1
    ? "\nBlend deliberately: reserved baseline with occasional brief situational wit. Do not alternate between incompatible personas. Explicit player details take priority."
    : "");
}

/** Only the selected language's examples are sent, to avoid mixed-language imitation. */
export function personalityExamples(language: "zh" | "en", temperament: string): string {
  const reserved = temperament.includes("[personality:reserved]");
  const playful = temperament.includes("[personality:playful]");
  if (!reserved && !playful) return language === "en"
    ? "Use the supplied temperament to choose how he responds, not just adjectives describing his expression. Answer the actual input; an action is optional."
    : "根据既定性格选择回应方式，不只改变表情形容词。先回答玩家真正说的话；动作可以没有。";
  const example = language === "en"
    ? `EXAMPLES (a different setting, not scripts to reuse):
Player during a walk: "You walk so fast."
Reserved — purpose: acknowledge and match pace; action: stop advancing and wait without pulling the viewer; words: "You're right. I'll slow down."
Playful — purpose: make a self-directed joke and offer a shared pace; action: take one deliberately slow step and pause for a response; words: "My legs got ahead of me. Better like this?"
BAD for either: "The view is lovely, but you're lovelier" plus a smile or collar adjustment. It neither answers the concern nor gives the action a purpose.
Boundary: "No jokes right now." — "Understood. I'll keep you company quietly." Drop the joke and give space; do not turn refusal into another flirt.`
    : `正反例（用不同场景示范策略，不是固定台词）：
散步时玩家说：“你走得好快。”
寡言克制——回应目的：承认并配合；动作目的：调整步调。停下等候，不拉玩家；对白：“嗯，是我走快了。我慢一点。”
爱逗你——回应目的：拿自己开个小玩笑，邀请协调步调；动作目的：示范更慢的步子。刻意慢走一步，停下等回应；对白：“我的腿抢跑了。这个速度可以吗？”
反例：两人都说“风景很美，但你更好看”，再微笑或整理衣领。没有回应问题，动作也没有目的。
边界例：“现在不想开玩笑。”——“好，我安静陪你。”停止玩笑、留出空间，不把拒绝变成新的调情。`;
  // Never teach the unselected archetype in the same request.
  return example.split("\n").filter(line =>
    (!line.startsWith("Reserved —") && !line.startsWith("寡言克制——") || reserved) &&
    (!line.startsWith("Playful —") && !line.startsWith("爱逗你——") || playful)
  ).join("\n");
}
