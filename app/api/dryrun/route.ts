import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { openingShotPrompt, type Character } from "@/lib/character";
import { dress, tellNext, writeIntentShot } from "@/lib/story";
import { DEFAULT_STYLE, isStyleKey } from "@/lib/styles";
import type { Beat, Choice } from "@/lib/types";
import { callGeminiText } from "@/lib/server-llm";

/**
 * 剧本试跑 — the whole writing layer, with no picture at all.
 *
 * Plays a run the way the engine does, minus every visual: no portrait, no
 * painted frame, no clip. Only the text key is touched, so a full run costs a
 * handful of Gemini calls and lands in seconds.
 *
 * WHAT IT TESTS
 *   the wish -> shot prompt writer
 *   the storyteller's 中文 narration and his lines
 *   whether each beat should auto-advance, offer two meaningful cards, or wait for free input
 *   the English shot prompts — the part the player never sees and the part
 *     that decides whether the film is any good
 *
 * WHAT IT CANNOT TEST, and this is the whole point of saying so out loud:
 * every rule in this system about the FRAME BEING THE TRUTH. The storyteller
 * normally reads three stills and narrates what actually happened; here there
 * are no stills, so it narrates what it intended. A dry run that reads
 * beautifully proves the prose is good. It proves nothing about whether the
 * words and the picture agree, which is the failure mode this game actually
 * has.
 *
 * Choice beats are taken by index, so a run is reproducible. An auto beat
 * advances on its continuation; a free-input beat ends the dry run and says
 * that it is waiting for the player.
 */

const CAST_DIR = path.join(process.cwd(), ".cache", "cast");
const MAX_BEATS = 8;

async function loadCharacter(id?: string): Promise<Character | null> {
  try {
    const ids = await readdir(CAST_DIR);
    const wanted = id && ids.includes(id) ? id : ids[0];
    if (!wanted) return null;
    const raw = await readFile(path.join(CAST_DIR, wanted, "character.json"), "utf8");
    const him = JSON.parse(raw) as Character;
    return him?.descriptor ? him : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: {
    wish?: unknown;
    beats?: unknown;
    style?: unknown;
    id?: unknown;
    picks?: unknown;
    him?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const wish = typeof body.wish === "string" ? body.wish.trim().slice(0, 280) : "";
  if (!wish) return NextResponse.json({ error: "wish is required" }, { status: 400 });

  const style = isStyleKey(body.style) ? body.style : DEFAULT_STYLE;
  const beats = Math.min(
    MAX_BEATS,
    Math.max(1, typeof body.beats === "number" ? Math.floor(body.beats) : 3)
  );
  const picks = Array.isArray(body.picks) ? body.picks.map(Number) : [];

  // An inline character lets the CLI try a cast that was never painted; a
  // stored one lets it use the boy actually in the game.
  const him =
    body.him && typeof body.him === "object"
      ? (body.him as Character)
      : await loadCharacter(typeof body.id === "string" ? body.id : undefined);
  if (!him) {
    return NextResponse.json(
      { error: "No character. Make one in 选角 first, or pass `him` inline." },
      { status: 400 }
    );
  }

  const script: unknown[] = [];

  // Beat 0 — the opening, which is fixed and needs no writer.
  script.push({
    beat: 0,
    kind: "opening",
    label: "醒来",
    prompt: dress(openingShotPrompt(him), style),
  });

  // Beat 1 — the wish becomes a shot.
  const intent: Choice | null = await writeIntentShot(wish, style, him, false, false, callGeminiText);
  if (!intent) {
    return NextResponse.json({ error: "the wish writer failed" }, { status: 502 });
  }
  script.push({
    beat: 1,
    kind: "intent",
    label: intent.label,
    prompt: intent.prompt,
    cut: intent.cut === true,
  });

  // Then the loop: read (frameless) -> offer -> take a pick -> film.
  let memory = "";
  let attempted = wish;
  let offered: string[] = [];
  let scene = "";
  let decisions: string[] = [];
  let resolvedDecisionKeys: string[] = [];
  let automaticBeats = 0;
  let playerLed = false;
  for (let n = 2; n <= beats + 1; n++) {
    const read: Beat | null = await tellNext({
      frames: [],
      memory,
      attempted,
      previousLabels: offered,
      beat: n,
      style,
      him,
      wish,
      scene,
      decisions,
      resolvedDecisionKeys,
      automaticBeats,
      playerLed,
      call: callGeminiText,
    });
    if (!read) {
      script.push({ beat: n, kind: "error", error: "the storyteller failed" });
      break;
    }
    memory = read.memory || memory;
    scene = read.scene || scene;
    offered = [...offered.slice(-6), ...read.choices.map((c) => c.label)];

    if (read.interaction === "free") {
      script.push({
        beat: n,
        kind: "beat",
        scene: read.scene,
        narration: read.narration,
        line: read.line,
        memory: read.memory,
        interaction: "free",
        decisionKey: read.decisionKey,
        decisionReason: read.decisionReason,
        choices: [],
        awaiting: "player_free_input",
      });
      break;
    }

    const index = picks[n - 2] === 1 ? 1 : 0;
    const taken = read.interaction === "auto"
      ? read.continuation
      : read.choices[index] ?? read.choices[0];
    if (!taken) {
      script.push({ beat: n, kind: "error", error: "story beat has no next action" });
      break;
    }
    script.push({
      beat: n,
      kind: "beat",
      scene: read.scene,
      narration: read.narration,
      line: read.line,
      memory: read.memory,
      interaction: read.interaction,
      decisionKey: read.decisionKey,
      decisionReason: read.decisionReason,
      choices: read.choices,
      took: read.interaction === "choices" ? index : null,
      label: taken.label,
      prompt: taken.prompt,
      cut: taken.cut === true,
    });
    attempted = taken.label;
    if (read.interaction === "auto") {
      automaticBeats += 1;
      playerLed = false;
    } else {
      automaticBeats = 0;
      playerLed = true;
      decisions = [...decisions, taken.label].slice(-20);
      if (read.decisionKey && !resolvedDecisionKeys.includes(read.decisionKey)) {
        resolvedDecisionKeys = [...resolvedDecisionKeys, read.decisionKey].slice(-20);
      }
    }
  }

  return NextResponse.json({ him: { name: him.name, descriptor: him.descriptor }, style, wish, script });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
