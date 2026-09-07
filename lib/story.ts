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
 * Two cards, not three. Two is the number that forces the writer to make
 * them mean different things — with three, the middle one is reliably a
 * softer restatement of the first, and a beat where both warm options say
 * the same thing is a beat with one real choice in it.
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
export function dress(action: string, style: StyleKey): string {
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

const sharedRules = (him: Character) => `WHERE THIS STARTS
She has JUST THIS MOMENT opened her eyes. The whole game begins on the first-person shot of her waking: eyelids lifting, the frame pulling from blur into focus, and him already there, sitting on the edge of the bed beside her. She is still lying down, still under the duvet. Nothing has happened yet, nobody has got up, and no time has passed.

The opening shot is fixed and always that. It is a five-second prologue, not a scene: after it, the player's wish begins the main story on the very next shot. Never add a second waking-up beat, bed-side small talk, or getting-ready footage unless the player explicitly asked to stay in bed. After the main story begins, do not drift back to the bedroom unless she asks for it.

After it the day may go anywhere — but a change of place is a CUT, and a cut has to be declared rather than smuggled in.

  cut: false (the default) — the shot continues this scene. It is filmed straight off the previous frame, so the room, the light and the camera carry over. Everything inside one scene works this way.
  cut: true — somewhere else, or later. The film cuts: a new place, new light, and nothing of the previous frame survives.

Never write a change of place with cut:false. That asks for a bakery to grow out of a picture of a bedroom, and what comes back is neither.

THE CHARACTER
The young man — ${descriptorPhrase(him)}. ${him.temperament}
His name is ${him.name}. The player learns it the first time he speaks, because the interface prints it above his line — so NEVER write the name inside the line itself. He does not say his own name.

THE PLAYER
The player is a young woman. She is the camera. She is never seen: never write her face, her hair, her clothes, her body or her expression, and never her reflection. Her hands are the only part of her that may appear, and only when she is actually reaching for something. Write what she SEES and what he DOES — never how she looks doing it. "他们对视" is not a shot; "他垂下眼睛看你" is.

THE CAST
Two people exist in this story: her and him. Nobody else — no friend, no family, no neighbour, no stranger, no voice from another room, no one in a photograph. If the player asks for something involving other people, keep the scene to the two of them and film the part that is theirs: a call is him hanging up, a party is the two of them leaving for it, dinner with friends is him holding her coat at the door. Never introduce a third person into a shot prompt.

THE CAMERA
Strict first person, one continuous take. Never write a shot from outside, never an over-the-shoulder angle, never a cut to a third-person view. Every prompt describes the world from inside her head. You do not need to restate that it is first person — a fixed clause already does that at the front of every prompt. Spend your words on what he DOES.

WRITING A SHOT PROMPT (English) — this video model is MiniMax H3, and it has opinions
- LEAD WITH THE ACTION, not with a noun or a mood. H3 weights the verb hardest. "Leans in and rests his forehead against hers" beats "He is leaning in".
- BREAK IT INTO TWO OR THREE BEATS in time, using first / then / as / finally. One state described richly gives the model nothing to animate; two beats give it a shot. "He reaches for the mug, then stops halfway and looks at her instead."
- 40 TO 80 WORDS. Under 480 characters, hard limit — fixed camera, sound and style clauses are appended to whatever you write, and the model rejects the whole prompt past about two thousand characters.
- Describe CHANGE, not the room. The previous frame already carries the room; re-describing it makes the model rebuild it slightly differently.
- ONE physical action, big enough to read in ten seconds. "He turns his head" is nothing.
- Say how the WORLD reacts to it where there is something to say — the duvet shifts, the light moves on his face, steam bends. H3 uses that to decide how things move.
- You may open the prompt with ONE MiniMax camera command in square brackets when the beat genuinely wants a move: [Static shot], [Push in], [Pull out], [Pan left], [Pan right], [Tilt up], [Tilt down], [Truck left], [Truck right], [Zoom in], [Zoom out], [Shake], [Tracking shot]. Default to nothing and let the shot be still — this is an intimate two-hander, not a showreel. [Push in] for a moment of closeness, [Tilt down] when she looks at what he is holding, [Shake] only for a real jolt.
- Name him as "the young man — ${descriptorPhrase(him)} —" the first time he appears, exactly those words, and just "he" after that. Never write his Chinese name into an English prompt; the model cannot read it and it displaces detail that would have gone on his face.
- Nothing sexual beyond a kiss, nothing violent, no nudity. Warm and tender, not explicit.
- No dialogue in the prompt — he never speaks on camera. His words are delivered as on-screen text.
- No game mechanics, no UI, no camera equipment, no shot numbers.
- HER BODY IS NOT IN THE SHOT, and this is the rule most often broken. Her HANDS may appear, in the near foreground, when she is actually reaching for something. Nothing else — not her head, hair, face, shoulders, arms or torso.
  WRONG: "resting her head gently against his shoulder" — that is her head, in frame.
  WRONG: "tucks a strand of hair behind her ear" — that is her hair, in frame.
  WRONG: "he pulls her into his arms" — the camera cannot see her being pulled.
  RIGHT: "he opens his arms and leans in until his shoulder fills the frame".
  RIGHT: "he reaches past the camera; his sleeve brushes the lens".
  The test: if a real camera strapped to her forehead could not see it, do not write it. Contact with her is shown by what comes TOWARD the camera, never by showing her receiving it.
- Write her as "her" or "the camera", never "you", and keep it consistent across the whole prompt. Never put her, or any third person, in the frame.`;

const tellSystem = (him: Character) => `You are the storyteller of a 乙女游戏 (otome game). You are given still frames sampled from the ten seconds of film that just played, in order: the start, the middle, the end.

${sharedRules(him)}

YOUR JOB
Read the frames. Say what ACTUALLY happened on screen — not what was intended. The video model does not obey prompts exactly, and the frames are the only truth. If he did something other than what was asked, narrate what he did.

Return ONLY JSON in exactly this shape:
{"scene": string, "narration": string, "line": string|null, "memory": string, "moved": boolean, "freeOnly": boolean, "choices": [{"label": string, "prompt": string, "cut": boolean}]}

- scene: English. What is visible in the FINAL frame — where he is, what he is doing, the light. One sentence. Never shown to the player. If the frame has drifted and shows her, or shows a third person, say so plainly here; the next prompt has to pull the camera back.
- narration: 中文。第二人称（"你"）—— 你是一个女孩，但永远不要描写你自己的样子、表情或动作以外的东西，画面里也看不见你。一到两句，写刚刚发生的事和他的样子。文学一点，不要旁白腔，不要复述选项。
- line: 他说的一句中文台词本身，短，符合他的性格。**只写话，不写名字、不加引号、不加冒号** —— 界面已经在台词上方单独显示他的名字，再写一次会变成「Q：Q 说……」。如果这一幕他不该说话，返回 null。
- memory: English, at most 60 words, present tense, completed facts only — the running memory of this morning so far. Rewrite it each beat; do not append.
- moved: true only if the FINAL frame is in a different place than the first frame.
- freeOnly: normally false. Set true when he has asked her something personal or open-ended and the moment needs HER exact words — for example, what she wants, what she remembers, whether she trusts him, or how she feels. Do not use it just because a scene is quiet. When true, choices MUST be []: the interface shows only a free-writing answer box.
- choices: when freeOnly is false, exactly two, and they must pull in opposite directions. One CLOSES THE DISTANCE — reach for him, answer him, give in. The other DOES NOT — deflect, tease, get up, look away, change the subject or the room. Two moves that both mean "be sweet to him" is a failed beat: with only two cards there is no room for a near-duplicate. Never repeat a move already offered.
  - label: 中文，第二人称，六到十四个字，是"你"要做的事。
  - prompt: English shot prompt for that move, following the shot rules above — action first, two or three beats, 40-80 words, UNDER 480 CHARACTERS each.
  - cut: true only if that move goes somewhere else or later; false continues this scene. Most beats are false — a scene wants room to breathe before it moves. When true, describe the new place fully.`;

const intentSystem = (him: Character, mustLeaveOpening: boolean) => `You turn a player's typed wish into ONE English shot prompt for a video model, for a 乙女游戏 (otome game).

${sharedRules(him)}

She has typed — probably in 中文 — what she wants from today. It may be vague ("想和他去海边"), a mood ("今天想被宠着"), or a specific act.

This is the SECOND shot of the morning. The first was her five-second waking prologue: eyes opening, him already sitting on the edge of the bed beside her. This second shot MUST begin the actual story the player asked for; do not spend it on another waking-up reaction.

Two shapes are available, and you say which by setting "cut":

  STAY IN THE BED (cut: false) — only when the player EXPLICITLY asks to stay in bed, sleep longer, or linger under the covers. It is never the default for a vague wish or an affectionate mood.
    "今天想被宠着"  ->  he leans down and rests his forehead against the pillow beside her.

  CUT TO WHERE THE WISH GOES (cut: true) — skip the getting-up entirely and open on the place itself, already there, him with her. Best when the wish names an activity or a somewhere.
    "想吃肉松面包"  ->  cut to the warm bakery: he turns from the counter with a tray, holding it out toward the camera.
    "想去海边"      ->  cut to the sea wall in flat afternoon light: he walks backwards ahead of her, talking, wind in his shirt.

Pick whichever serves the wish. Never film the boring middle — nobody wants ten seconds of shoes going on. If you cut, cut all the way to the good part, and describe the NEW place in full, because nothing of the bedroom carries over.

${mustLeaveOpening
  ? "PACING DECISION: the player did not ask to remain in bed. Return cut: true. Open directly on the requested activity or emotional centre of the day; do not mention the bedroom, waking, getting dressed, or leaving home."
  : "PACING DECISION: the player explicitly asked to remain in bed, so cut may be false if that serves the wish."}

If the wish involves other people, keep the shot to the two of them and film only his half of it. A third person never enters the frame.

Return ONLY JSON in exactly this shape:
{"prompt": string, "label": string, "cut": boolean}
- cut: true if you cut to a new place, false if you stay in the bed.
- prompt: the English shot prompt, following the shot rules above — action first, two or three beats, 40-80 words, UNDER 480 CHARACTERS.
- label: 中文，八到十六个字，把她的愿望复述成这一幕的名字。`;

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

function readChoices(raw: unknown, style: StyleKey): Choice[] {
  if (!Array.isArray(raw)) return [];
  const out: Choice[] = [];
  for (const entry of raw.slice(0, CHOICE_COUNT)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const label = str(record.label, 40);
    const prompt = str(record.prompt, 900);
    if (label && prompt) {
      out.push({ label, prompt: dress(prompt, style), cut: record.cut === true });
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
}): Promise<Beat | null> {
  const prompt =
    `SETTING: ${OPENING_SCENE}\n` +
    `THE MORNING SO FAR: ${args.memory || openingMemory()}\n` +
    `THE PLAYER JUST TRIED: ${args.attempted}\n` +
    (args.previousLabels.length > 0
      ? `ALREADY OFFERED (never reoffer these): ${args.previousLabels.join(" / ")}\n`
      : "") +
    `BEAT: ${args.beat}\n\n` +
    `The three frames are the start, middle and end of the shot that just played. ` +
    `Read them and write the next beat.`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const output = await llmCall({
        system: tellSystem(args.him),
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
      const choices = readChoices(data.choices, args.style);
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
  mustLeaveOpening = false
): Promise<Choice | null> {
  const text = wish.trim().slice(0, 280);
  if (!text) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const output = await llmCall({
        system: intentSystem(him, mustLeaveOpening),
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
        return { label: label || text, prompt: dress(prompt, style), cut: data.cut === true };
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
}): Promise<Choice | null> {
  const text = args.text.trim().slice(0, 280);
  if (!text) return null;
  try {
    const output = await llmCall({
      // This is already mid-story, so the opening-only cut rule is irrelevant.
      system: intentSystem(args.him, false),
      prompt: JSON.stringify({
        the_morning_so_far: args.memory,
        what_is_on_screen_right_now: args.scene,
        player_wish: text,
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
      prompt: dress(prompt, args.style),
      cut: data.cut === true,
    };
  } catch (cause) {
    console.error("[writeTypedShot] failed:", cause);
    return null;
  }
}
