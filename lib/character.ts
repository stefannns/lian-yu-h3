/**
 * 男主 — and the grammar every shot inherits.
 *
 * A 乙女游戏 lives or dies on whether he is recognisably the same person in
 * shot nine as in shot one. FastH3 has no memory between clips: it sees a
 * prompt and its starting frame, nothing else. So the whole identity
 * system is two things —
 *
 *   1. PORTRAIT   one still of him, cached per (character, style), used as
 *                 the starting frame whenever the story cuts somewhere new.
 *                 Continuing clips start from the previous clip's last frame.
 *   2. DESCRIPTOR the same English sentence, verbatim, in every prompt that
 *                 names him — so the words and the picture never disagree.
 *
 * He used to be a constant. He is now DATA: the player can write a new one or
 * upload a picture of one (see /api/cast), so every prompt builder in this
 * file and in lib/story.ts takes a Character rather than closing over one.
 * That is the whole reason those are functions and not template literals —
 * a module-level string is baked at import and cannot be re-cast.
 *
 * The LOOK is a separate player choice and lives in lib/styles.ts.
 *
 * Everything player-facing is 中文. Every prompt sent to a model is English:
 * h3 and the image models all compose visibly worse from Chinese prompts, and
 * the player never sees a prompt.
 */

import { STYLES, type StyleKey } from "./styles";

export interface Character {
  /** Stable id. "default" is the built-in; customs get a generated one. */
  id: string;
  /**
   * Shown in the UI — but only once he has spoken. The first page never
   * names him; there he is just 他.
   */
  name: string;
  /**
   * English appearance line, injected verbatim into every prompt that names
   * him and into the portrait paint. Silhouette-first — one dominant colour
   * and one identifying feature — because that is what survives a video
   * model; his face is carried by the portrait reference, not by words.
   *
   * Deliberately style-neutral: it describes what he IS, never how he is
   * drawn, so the same sentence works under all three looks.
   */
  descriptor: string;
  /** English personality note. Steers the storyteller's writing only. */
  temperament: string;
  /**
   * True when he came from an uploaded picture rather than a description.
   * Informational only — both roads store a source image, and every style
   * variant is edited from it, so the pipeline no longer branches.
   */
  fromUpload?: boolean;
  /**
   * False when he exists as words only — no source.jpg, no portrait.
   *
   * A written character is a complete character: the descriptor is what
   * rides every prompt and what the storyteller works from, and none of the
   * writing needs a picture. Art is what the VIDEO needs. So a run can be
   * cast, written and played through in 无视频模式 with nothing painted at
   * all — which is also the only way to work on the script while the image
   * provider is down.
   */
  hasArt?: boolean;
}

/*
 * There is no default 男主, on purpose.
 *
 * There used to be one, hard-coded here — a name, a sweater and a
 * temperament that I invented. That is the wrong shape for this game: a
 * pre-made boy is not a neutral starting point, he is somebody else's taste
 * sitting in the middle of the screen, and the whole first page is supposed
 * to be the player deciding who this day is with. So the game now begins
 * with nobody, and 选角 is the first thing that happens rather than an
 * option tucked beside a default.
 *
 * Everything downstream treats him as possibly-null and simply refuses to
 * generate until he exists — see Director.begin() in lib/engine.ts.
 */

/**
 * His descriptor as a NOUN PHRASE, fit to sit inside a sentence.
 *
 * The writers keep producing a standalone sentence — "A young man with messy
 * silvery-purple hair..., with white as the dominant color." — which is fine
 * on its own and wrong everywhere it is actually used. Interpolated into
 * "The young man — ${descriptor} — laughs softly" it yields "The young man —
 * A young man with... color. — laughs softly": the subject named twice, a
 * capital mid-sentence, and a full stop inside the em dashes. h3 reads that
 * as two subjects and can put two people in the shot.
 *
 * Normalising here rather than only in the writer's rules, because characters
 * already on disk were written under the old instructions and would otherwise
 * stay broken.
 */
export function descriptorPhrase(him: Character): string {
  let text = him.descriptor.trim().replace(/[.\s]+$/, "");

  // "A tall and lean young man with messy dark hair" -> "tall and lean, with
  // messy dark hair". The head noun goes (the sentence already supplies it)
  // while the adjectives in front of it stay, because build is exactly the
  // kind of detail the shot wants.
  text = text.replace(
    /^(?:an?|the)\s+([\w\s-]*?)\s*(?:young\s+)?(?:man|boy|guy|male|figure)\s+(with|in|wearing)\s+/i,
    (_match, adjectives: string, preposition: string) =>
      adjectives.trim() ? `${adjectives.trim()}, ${preposition} ` : `${preposition} `
  );

  // A trailing colour note — "with white as the dominant color", "dominated
  // by a warm beige palette" — is an art direction about the whole image, not
  // part of the figure. Left in, it competes with the style clause and gets
  // read as something to paint.
  text = text.replace(
    /,?\s*(?:with\s+[\w\s-]+as\s+the\s+dominant|dominated\s+by\s+[\w\s-]*?)\s*(?:colou?r)?\s*(?:palette)?\s*$/i,
    ""
  );

  text = text.trim().replace(/[,.\s]+$/, "");
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** His portrait prompt under one look. The cached anchor image. */
export function portraitPrompt(him: Character, style: StyleKey): string {
  return (
    `Character portrait of one person alone, full figure, standing naturally ` +
    `against a plain neutral background, no props, no scenery, nobody else in ` +
    `the image: ${descriptorPhrase(him)}. Warm soft morning light. ` +
    `${STYLES[style].still}`
  );
}

/**
 * Redraw his source picture into one look, keeping the person.
 *
 * Every character has a source image — painted from his description, or
 * uploaded — and every style variant is EDITED from it rather than painted
 * fresh from the descriptor. That is what makes the three looks three
 * renderings of one person instead of three people who share a wardrobe: a
 * description is far too lossy to reproduce a face, and the face is the
 * thing this whole system exists to hold.
 */
export function restylePrompt(_him: Character, style: StyleKey): string {
  return (
    `Redraw the person in the reference image as a character portrait: full ` +
    `figure, standing naturally against a plain neutral background, no props, ` +
    `no scenery, nobody else. Keep their face, hair, build and clothing exactly ` +
    `as in the reference — same person. ${STYLES[style].still}`
  );
}

/**
 * WHO IS IN THE FRAME — split in two, because position in the prompt matters.
 *
 * MiniMax's own guidance is that H3 leads with the SUBJECT'S ACTION, and that
 * long lists of constraints dilute it. The camera rules used to be one 400-
 * character block appended after the action, which is the worst of both: the
 * declaration that this is POV arrived last, and the negatives were long
 * enough to compete with the shot itself.
 *
 * So LEAD is short and goes in front — it establishes whose eyes this is
 * before the model has read anything else — and GUARD goes after the action,
 * carrying only the negatives that are actually load-bearing.
 */

/**
 * Front of every prompt. Declare the camera as the viewer's own eyesight
 * before the model sees any action, and make the viewer explicitly off-screen.
 * This prevents the model from turning a grammatical "she" into a second
 * visible character or reverting to a neutral observer angle.
 */
export const POV_LEAD =
  "STRICT First-person POV from the viewer's eyes; the camera is the viewer's eyesight and the viewer stays completely off-screen.";

/**
 * After the action. Only the failures actually observed on screen, stated as
 * bans rather than as prose: h3 parks the back of the viewer's own head in a
 * foreground corner, and it pads a quiet domestic frame with extras.
 */
export const POV_GUARD =
  "Exactly one visible person: the handsome adult man facing the camera. No viewer body, hands, hair, shadow or reflection; no other person, duplicate, third-person, over-the-shoulder, selfie, mirror shot or background people. ABSOLUTELY NO on-screen text: no subtitles in any language, captions, letters, speech bubbles, signs, logos, watermarks or interface.";

/**
 * MiniMax camera commands, in square brackets, up to three per bracket for a
 * simultaneous move; separate brackets read as a sequence. Documented for
 * Hailuo and NOT confirmed for H3 — kept because a model that does not parse
 * them reads them as a plain hint about the shot, which is the same thing they
 * say. Flip SHOT_TAGS to "" to A/B them out in one edit.
 *
 * Vocabulary: Truck left/right, Pan left/right, Push in, Pull out,
 * Pedestal up/down, Tilt up/down, Zoom in/out, Shake, Tracking shot,
 * Static shot.
 */
export const SHOT_TAGS = true;

/** The default move for a held, intimate two-hander: none. */
export const DEFAULT_SHOT_TAG = "[Static shot]";

/**
 * FastH3 generates video and sound together. This clause keeps any incidental
 * speech on the visible male lead's Mandarin voice and explicitly separates
 * heard audio from text rendered into the image.
 */
export const SOUND =
  "AUDIO TRACK ONLY: synchronized natural ambience and soft music. If speech occurs, it is heard only from the man on screen in one clear, warm adult male Mandarin voice; never transcribe or visualize it, no female voice, no gibberish.";

/** Where the game opens, in English, for the painter and the storyteller. */
export const OPENING_SCENE =
  "A sunlit bedroom on a slow weekend morning: rumpled white sheets, a window " +
  "with sheer curtains moving in the breeze, dust motes in the light, a mug " +
  "cooling on the nightstand.";

/**
 * The painted first frame — the very first thing the player sees, and the
 * still every later shot chains forward from. Written by hand rather than by
 * an LLM because there is exactly one opening in this game.
 *
 * It is a STILL of the beat BEFORE the action: he is already there, already
 * looking at you, and nothing has happened yet.
 */
export function firstFramePrompt(him: Character, style: StyleKey): string {
  return (
    `${POV_LEAD} ${OPENING_SCENE} Camera at pillow height and level with ` +
    `the bed, the rumpled duvet edge filling the near foreground. A young man, ` +
    `${descriptorPhrase(him)}, sits on the edge of the bed close to the camera, ` +
    `turned toward the lens, one hand resting on the sheets, caught mid-glance ` +
    `with the morning light behind him. ${STYLES[style].still} ${POV_GUARD}`
  );
}

/**
 * The opening shot: her eyes open, and he is there.
 *
 * Written as three chronological beats, which is what MiniMax asks for —
 * "first / then / as" — rather than one sentence describing a state. And the
 * waking is done with the technique the POV guides name for exactly this:
 * RACK FOCUS FROM FULLY SOFT TO SHARP, plus the eyelid wipe. A prompt that
 * merely says "she wakes up" gives the model nothing to animate, so it
 * animates him instead and the waking never happens.
 *
 * The eyelid opening is deliberately described as darkness that RETREATS from
 * the top and bottom of frame, not as a cut from black: the shot is generated
 * from the painted first frame, so it has to resolve INTO that composition
 * rather than arrive at it from nothing.
 */
export function openingShotPrompt(him: Character): string {
  return (
    `Blurred darkness narrows the top and bottom of the frame like heavy ` +
    `eyelids and then lifts away: first a soft slit of morning light, then the ` +
    `frame opens wide as the focus racks to sharp. ` +
    `Revealed close to the camera, the young man — ${descriptorPhrase(him)} — sits on the ` +
    `edge of the bed as the only visible person. He notices the viewer is awake and ` +
    `leans a little closer, his face softening. The rumpled duvet edge stays low ` +
    `in the foreground at pillow height. One brief, quiet reveal.`
  );
}

/** Seconds per main-story shot. */
export const SHOT_SECONDS = 10;
/** The waking prologue is a doorway, never its own scene. */
export const OPENING_SHOT_SECONDS = 5;
/** 768P is noticeably sharper on faces, which is the whole point here. */
export const RESOLUTION: "480P" | "768P" = "768P";
