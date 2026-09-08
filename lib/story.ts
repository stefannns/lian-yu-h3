/**
 * The storyteller — this game's whole brain, and the one place LAST FRAME's
 * Adjudicator is reduced rather than reused.
 *
 * NOT "use client", deliberately. This module is pure prompt assembly plus one
 * LLM call, and it has to stay importable from three places: the browser (the
 * game), a server route (/api/dryrun), and the CLI. The moment it carries a
 * "use client" directive, anything importing it server-side gets a client
 * reference proxy instead of these functions, and silently stops working.
 *
 * The Adjudicator was a judge: it watched the last frame and CHARGED you for
 * what it saw, in hit points, with an evidence still. There is nothing to
 * charge here. So what is left is the half that was always doing the
 * storytelling — read the frames, say in 中文 what just happened, give him a
 * line, and write the next moves as English shot prompts.
 *
 * Two rules make this work and both are load-bearing:
 *
 *   GROUND TRUTH IS THE FRAME. h3 does not do what the prompt asked; it does
 *   something adjacent. If the storyteller narrates the prompt instead of the
 *   film, the text and the picture drift apart within three beats and the
 *   player stops believing either. It is told, repeatedly, to describe only
 *   what it can see.
 *
 *   CHOICES CARRY THEIR OWN PROMPT. Each card ships the English shot prompt
 *   that films it, written while the clip was still playing. Picking one
 *   costs zero LLM calls, so a tap goes straight to h3.
 *
 * Two concrete activity choices keep each beat readable. Free input remains
 * available when the player wants a different flavour, design or action.
 */

import {
  DEFAULT_SHOT_TAG,
  descriptorPhrase,
  OPENING_SCENE,
  POV_GUARD,
  POV_LEAD,
  SHOT_TAGS,
  SOUND,
  type Character,
} from "./character";
import { PROMPT_WARN_CHARS } from "./limits";
import { llmCall } from "./llm";
import { STYLES, type StyleKey } from "./styles";
import type { Beat, Choice } from "./types";

/**
 * Every prompt that reaches h3 goes through here. Camera, sound and style
 * are restated on EVERY shot, not once at the start — h3 sees only this
 * call, so a style declared at beat one is a style gone by beat three.
 */
export function dress(action: string, style: StyleKey, still = false): string {
  if (still) {
    const moment = action.replace(/^\s*\[[^\]]+\]\s*/, "");
    return `Create one standalone scene illustration. ${POV_LEAD} ${moment} ${POV_GUARD.replace("film", "image")} ${STYLES[style].still}`;
  }
  // Order is load-bearing, and it follows MiniMax's own guidance for H3:
  //
  //   [camera tag]  the bracket command, first, where MiniMax expects it
  //   POV_LEAD      whose eyes, what height, what is in the near foreground
  //   action        the subject's action, which the model weights hardest
  //   POV_GUARD     only the negatives that failed on screen
  //   sound, style  the fixed grammar
  //
  // The camera used to be one long block bolted on after the action, which
  // announced the POV last and buried the shot under constraints.
  const tag = SHOT_TAGS && !/^\s*\[/.test(action) ? `${DEFAULT_SHOT_TAG} ` : "";
  const dressed =
    `${tag}${POV_LEAD} ${action} ${POV_GUARD} ${SOUND} ${STYLES[style].prompt}`;
  if (dressed.length <= PROMPT_WARN_CHARS) return dressed;

  // Over budget. The clauses are fixed and each one is load-bearing, so the
  // only part that can give is the action — and it is trimmed at a sentence
  // boundary rather than mid-word, so what reaches h3 is a shorter shot
  // rather than a broken one. This should essentially never fire; it exists
  // because the alternative is a 422 the player experiences as "the opening
  // shot failed", which is what happened once already.
  const budget = PROMPT_WARN_CHARS - (dressed.length - action.length) - 1;
  const cut = action.slice(0, Math.max(0, budget));
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  const trimmed = (lastStop > budget * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim();
  console.warn(
    `[dress] action trimmed ${action.length} -> ${trimmed.length} chars to fit ` +
      `the ${PROMPT_WARN_CHARS}-char prompt budget`
  );
  return `${tag}${POV_LEAD} ${trimmed} ${POV_GUARD} ${SOUND} ${STYLES[style].prompt}`;
}

/**
 * Names the reference images positionally, because ref2v addresses them that
 * way — "Image 1", "Image 2". A prompt that never says which is the room and
 * which is the boy leaves h3 to guess, and it guesses wrong often enough to
 * matter. The engine owns this rather than the storyteller: image order is a
 * property of the API call, not of the story.
 */
export function imageKey(args: { frame: boolean; portrait: boolean }): string {
  if (!args.portrait) return "";
  // A cut has no frame to continue, so the portrait becomes Image 1 and the
  // prompt has to say so — ref2v addresses its inputs positionally, and a
  // prompt still talking about "Image 2" when only one image was sent leaves
  // the model looking for something that is not there.
  if (!args.frame) {
    return `Image 1 is the young man; he must look exactly like Image 1. `;
  }
  return (
    `Image 1 is the scene: continue from it exactly, same room, same light, ` +
    `same camera. Image 2 is the young man; he must look exactly like Image 2. `
  );
}

const sharedRules = (him: Character, still = false) => `You write a first-person romantic story driven by the player's chosen activity.

THE CHARACTER
The adult young man — ${descriptorPhrase(him)}. ${him.temperament}
His name is ${him.name}. Do not put his name inside dialogue; the interface labels the speaker.

THE PLAYER AND CAMERA
She is the camera. Only he appears in the scene. Her hands may appear low in the foreground when needed; never show her face, hair, head, body, reflection or a third person. Describe what she sees and what he does toward the camera. Never use a third-person or over-the-shoulder view. In English prompts call her "her" or "the camera"; never put her in the frame.
Only these two people exist in the story. Do not add voices, strangers, friends, family or background extras.

WISH AND PLAYER AGENCY
The original wish is the continuing objective, not a disposable opening cue. Carry the player's chosen details forward in memory. Every main-story beat must either resolve one meaningful decision or visibly advance the chosen activity.
Ask for an undecided preference BEFORE committing to it. Do not choose her flavour, destination, design or intention for her. If she already gave the detail, use it immediately; do not ask it again. Her free input may combine several decisions; honour all of them.
A brief affectionate gesture can colour an activity, but cannot replace its progress. At most one teasing/tasting/flour-on-the-face introduction; immediately move to a useful decision afterward. Do not chain glances, smiles, feeding, finger-touching or evasive replies into separate filler scenes.
For "一起做蛋糕": go straight to the kitchen and cake-making. If flavour and cake type are undecided, ask what she wants to make and offer meaningfully different possibilities (for example strawberry cream chiffon versus chocolate mousse), while leaving free input available. After her choice, start that recipe; advance through mixing, baking/chilling, decoration and the finished cake. Skip repetitive preparation and waiting. Never return to flour teasing instead of progressing.
For another wish, derive equivalent concrete decisions from THAT activity; do not use cake choices everywhere.

PACING AND LOCATION
Waking is only a single brief opening prologue, at most five seconds. The next scene goes directly to the requested activity. Never restart waking or preparation in the middle of the story. Stay in bed only if explicitly requested.
cut: true means a new place or a meaningful time jump. Use it freely to skip uneventful work or waiting. cut: false means the current scene. Both must keep the character and the player's established decisions.
Warm romance, nothing explicit, no nudity or violence. Dialogue is Chinese UI text, never lettering or spoken dialogue inside a visual prompt.

${still
  ? `WRITING AN INDEPENDENT STILL IMAGE
Write 45-90 English words, at most 650 characters. Describe ONE readable moment, its complete location, relevant objects, his pose and the visible result of the player's action. Each image is generated independently; no previous scene image is supplied. Character portrait is for identity only.
Do not ask to edit, continue or reproduce an earlier frame or its camera. Do not write a sequence, duration, camera-motion tags, sound, or video instructions. Include the scene's important details every time, even when cut is false.`
  : `WRITING A VIDEO ACTION
Write 40-80 English words, at most 480 characters. Lead with one meaningful physical action and two or three chronological beats. Within a scene the previous frame supplies continuity; for a cut describe the new place fully. Optional camera commands: [Static shot], [Push in], [Tilt down]. No dialogue, sound instructions, UI, equipment or shot numbers in the action.`}

Name him as "the young man — ${descriptorPhrase(him)} —" the first time, then "he". Never insert his Chinese name into an English visual prompt.`;

const tellSystem = (him: Character, still = false) => `You are the storyteller of a 乙女游戏 (otome game).
${still ? "You are given one generated still showing the current moment. It is not a video sequence." : "You are given sampled frames of the scene that just played, in chronological order."}

${sharedRules(him, still)}

YOUR JOB
Narrate only what the supplied image(s) actually show. Do not claim an intended action happened if it is absent. In a still, do not invent unseen before/after motion. Use the current image as visual truth; use the original wish, memory and accepted decisions to choose the next meaningful step.
A decorative introductory beat is over as soon as it is narrated: the next question must concern the actual activity. If the player already chose flavour and cake type, do not return to choosing them; advance the recipe instead.

Return ONLY JSON:
{"scene": string, "narration": string, "line": string|null, "memory": string, "moved": boolean, "freeOnly": boolean, "choices": [{"label": string, "prompt": string, "cut": boolean}]}

- scene: one English sentence describing the current image's location and visible state.
- narration: 中文，第二人称，一到两句，简洁具体，说明眼前画面和活动进展，不描写玩家外貌，不重复无意义的暧昧动作。
- line: 一句简短中文台词，不加名字、引号或冒号。优先询问当前活动中尚未决定的关键偏好；如无须说话返回 null。
- memory: English, at most 80 words. Preserve the original goal, accepted player preferences (flavour, cake type, etc.), completed milestones and the next unresolved decision. Do not treat proposed options as accepted facts.
- moved: whether the current scene changed location from the supplied prior scene description. A single still does not show a journey.
- freeOnly: true when only the player's own words make sense. Then choices MUST be []. For concrete activity choices, offer helpful possibilities AND leave the normal free input available.
- choices: otherwise exactly two materially different ways to advance the chosen activity. They need not be emotional opposites. Do not force "approach him versus avoid him", and do not replace a cake decision with "taste his finger versus look away". Both may be affectionate; their consequences must differ.
  - label: 中文，四到十八个字，明确表达玩家要决定或做的事，例如“草莓奶油戚风”与“巧克力慕斯”，不要含糊地只写“听他的”。
  - prompt: the English visual prompt for AFTER she chooses this option, including its concrete consequence, following the mode-specific rules above.
  - cut: true for a location/time jump; do not prolong a scene just to keep cut false.`;

const intentSystem = (him: Character, mustLeaveOpening: boolean, still = false) => `Turn the player's original wish into the FIRST MAIN SCENE of a 乙女游戏.

${sharedRules(him, still)}

The five-second waking prologue is already over. Start the requested activity now, at its first useful decision; do not write another waking reaction, a getting-ready scene or an obligatory teasing scene.
For cake-making, show the kitchen workspace and him ready to help choose a cake. Keep undecided flavour and cake type open. Do not portray a finished strawberry cake before she has chosen strawberry.
${mustLeaveOpening
  ? "PACING DECISION: return cut: true. Open directly on the activity; no bedroom, getting dressed or leaving home."
  : "PACING DECISION: the player explicitly requested staying in bed. Remain there only as the wish requires."}

Return ONLY JSON:
{"prompt": string, "label": string, "cut": boolean}
- prompt: the English visual prompt under the selected mode's rules.
- label: 中文，八到十六个字，概括真正开始的活动。
- cut: true for a location/time jump, false only when continuing the current place and time.`;

const typedSystem = (him: Character, still = false) => `Turn the player's latest answer or action into the NEXT MAIN-STORY SCENE. This is an ongoing activity, not an opening.

${sharedRules(him, still)}

Use the original wish, current scene, recorded choices and the latest answer together. A short answer such as "巧克力慕斯" is a concrete cake decision: show that recipe starting, not another request to choose a cake or another romantic prelude. Do not invent remaining personal preferences; leave them for the next question.
Skip routine waiting and repeated gestures. Keep the same place unless the answer or progress needs a change. If the player explicitly changes direction, honour that change.

Return ONLY JSON:
{"prompt": string, "label": string, "cut": boolean}
- prompt: English visual prompt showing the consequence of her answer.
- label: brief 中文 description of this step.
- cut: true for a change of place or a time jump; otherwise false.`;

const openingMemory = () => `The player has just woken in their own bed on a slow morning. The young man is sitting on the edge of the bed beside them. Nothing has happened yet.`;

/** Cards per beat. Change this and the wording in tellSystem() together. */
const CHOICE_COUNT = 2;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Pull the first {...} out of a reply, for when JSON mode still wraps it. */
function parse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON in reply");
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  }
}

function readChoices(raw: unknown, style: StyleKey, still = false): Choice[] {
  if (!Array.isArray(raw)) return [];
  const out: Choice[] = [];
  for (const entry of raw.slice(0, CHOICE_COUNT)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const label = str(record.label, 40);
    const prompt = str(record.prompt, 900);
    if (label && prompt) {
      out.push({ label, prompt: dress(prompt, style, still), cut: record.cut === true });
    }
  }
  return out;
}

/**
 * Read the shot that just landed and write the next beat.
 *
 * Retried, because a malformed reply here stalls the run — and unlike the
 * Adjudicator this call has no verdict to fall back on, only a frozen frame
 * and a player waiting.
 */
export async function tellNext(args: {
  /**
   * Start / middle / end stills of the shot, as data URIs.
   *
   * MAY BE EMPTY — that is the script-only dry run (/api/dryrun), where no
   * picture is generated at all and the writing is exercised on its own. It
   * is a real degradation, not a shortcut: with no frames there is no ground
   * truth, so the storyteller is writing what the shot WOULD have shown
   * rather than what it did. Never take a dry run as evidence that the text
   * and the picture agree — that is the one thing it cannot test.
   */
  frames: string[];
  /** Running memory from the previous beat. Empty on the first. */
  memory: string;
  /** What the player was trying to do — 中文 or English. */
  attempted: string;
  /** Labels already offered, so nothing is reoffered. */
  previousLabels: string[];
  beat: number;
  /** The look this run is in. Every written prompt is dressed in it. */
  style: StyleKey;
  /** Who he is this run. */
  him: Character;
  wish?: string;
  scene?: string;
  decisions?: string[];
  still?: boolean;
  opening?: boolean;
}): Promise<Beat | null> {
  const prompt =
    `ORIGINAL PLAYER WISH: ${args.wish || "Follow the player's current activity."}\n` +
    `ACCEPTED PLAYER ACTIONS: ${JSON.stringify(args.decisions ?? [])}\n` +
    `PREVIOUS SCENE: ${args.scene || (args.opening ? OPENING_SCENE : "Read the current image." )}\n` +
    `STORY SO FAR AND ACCEPTED DECISIONS: ${args.memory || (args.opening ? openingMemory() : "The main activity is beginning.")}\n` +
    `THE PLAYER JUST TRIED: ${args.attempted}\n` +
    (args.previousLabels.length > 0
      ? `ALREADY OFFERED (never reoffer these): ${args.previousLabels.join(" / ")}\n`
      : "") +
    `BEAT: ${args.beat}\n\n` +
    (args.still
      ? "One independent still is supplied. Read this moment and immediately offer the next meaningful activity decision."
      : "Read the supplied chronological frames and write the next meaningful activity decision.");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const output = await llmCall({
        system: tellSystem(args.him, args.still),
        prompt,
        images: args.frames.slice(0, 3),
        // Generous on purpose. A truncated reply is not a short reply — it is
        // a JSON string cut mid-escape, which fails to parse with a message
        // ("Bad Unicode escape") that looks like a model fault rather than a
        // budget one. Observed live at 1100. The beat writes 中文 narration, a
        // line, an English memory and two full English shot prompts; that is
        // more tokens than it looks like.
        maxTokens: 1_800,
        temperature: 0.85,
        json: true,
      });
      const data = parse(output);
      const choices = readChoices(data.choices, args.style, args.still);
      const narration = str(data.narration, 300);
      const freeOnly = data.freeOnly === true;
      if ((!freeOnly && choices.length !== CHOICE_COUNT) || !narration) continue;
      return {
        scene: str(data.scene, 400),
        narration,
        line: str(data.line, 120) || null,
        memory: str(data.memory, 600),
        moved: data.moved === true,
        freeOnly,
        choices: freeOnly ? [] : choices,
      };
    } catch (cause) {
      console.error(`[tellNext] attempt ${attempt + 1} failed:`, cause);
    }
  }
  return null;
}

/**
 * Turn the player's typed wish into the shot that opens the day.
 *
 * This runs the moment they submit, WHILE scene one is still filming or
 * playing — the typing screen and the opening clip together are the
 * generation window that hides this call and the h3 call after it.
 */
export async function writeIntentShot(
  wish: string,
  style: StyleKey,
  him: Character,
  mustLeaveOpening = false,
  still = false
): Promise<Choice | null> {
  const text = wish.trim().slice(0, 280);
  if (!text) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const output = await llmCall({
        system: intentSystem(him, mustLeaveOpening, still),
        // The wish is untrusted player text, so it is handed over as data
        // rather than pasted into the instructions.
        prompt: JSON.stringify({ player_wish: text }),
        maxTokens: 400,
        temperature: 0.9,
        json: true,
      });
      const data = parse(output);
      const prompt = str(data.prompt, 900);
      const label = str(data.label, 40);
      if (prompt) {
        return { label: label || text, prompt: dress(prompt, style, still), cut: mustLeaveOpening || data.cut === true };
      }
    } catch (cause) {
      console.error(`[writeIntentShot] attempt ${attempt + 1} failed:`, cause);
    }
  }
  return null;
}

/**
 * Write the shot for a freely typed action mid-run. Same contract as an
 * offered choice, so the engine films both down one path.
 */
export async function writeTypedShot(args: {
  text: string;
  memory: string;
  scene: string;
  style: StyleKey;
  him: Character;
  wish?: string;
  decisions?: string[];
  still?: boolean;
}): Promise<Choice | null> {
  const text = args.text.trim().slice(0, 280);
  if (!text) return null;
  try {
    const output = await llmCall({
      system: typedSystem(args.him, args.still),
      prompt: JSON.stringify({
        original_player_wish: args.wish,
        accepted_player_actions: args.decisions ?? [],
        the_morning_so_far: args.memory,
        what_is_on_screen_right_now: args.scene,
        player_answer: text,
      }),
      maxTokens: 400,
      temperature: 0.9,
      json: true,
    });
    const data = parse(output);
    const prompt = str(data.prompt, 900);
    if (!prompt) return null;
    return {
      label: str(data.label, 40) || text,
      prompt: dress(prompt, args.style, args.still),
      cut: data.cut === true,
    };
  } catch (cause) {
    console.error("[writeTypedShot] failed:", cause);
    return null;
  }
}
