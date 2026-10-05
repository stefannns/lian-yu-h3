import { getLanguage } from "./i18n";
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
 * Everything player-facing is 中文. Visual directions sent to H3 and the image
 * models remain English because they compose more reliably that way. H3's exact
 * LLM-written Mandarin sentence is the one exception, embedded as spoken audio.
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

/** Defaults only for unspecified traits when creating a new character. */
export const DEFAULT_MALE_APPEARANCE =
  "Only fill traits the player has not specified. Default to a strikingly handsome " +
  "adult romantic lead with an immediately memorable, refined leading-man presence. " +
  "Tall, long-legged silhouette; a proportionately small head relative to the shoulders, " +
  "broad but natural shoulders, a lean defined torso, a gently tapered waist and an " +
  "elegant neck. Balanced athletic proportions, not bulky muscles or stretched anatomy. " +
  "A harmonious, sculpted face: balanced forehead, midface and lower-face proportions, " +
  "well-spaced expressive eyes framed by defined brows, a defined nose bridge with a " +
  "proportionate tip, subtly prominent cheekbones, a clean jawline and a well-proportioned " +
  "chin. Naturally shaped lips balanced with the nose and chin. Distinct facial planes " +
  "and depth, not a flat generic face, excessively narrow V-shaped chin or hollow cheeks. " +
  "Keep the result believable within the selected art style rather than exaggerating " +
  "every feature. Explicit player traits override each default individually, including " +
  "height, build, face shape, softness, age and facial hair. A personality request alone " +
  "does not override appearance defaults. Never apply this template to redesign an " +
  "uploaded identity or an already established reference image.";

/** His portrait prompt under one look. The cached anchor image. */
export function portraitPrompt(him: Character, style: StyleKey): string {
  return (
    `Character portrait of exactly one adult male romantic lead. ` +
    `The requested appearance is authoritative: ${descriptorPhrase(him)}. ` +
    `${style === "real" ? DEFAULT_MALE_APPEARANCE : ""} ` +
    `Three-quarter-length portrait framed from the head to below the knees so shoulder, waist ` +
    `and upper-leg proportions are readable, standing naturally against a plain neutral background, ` +
    `with no props or scenery. Anatomically coherent adult proportions, no wide-angle ` +
    `distortion or oversized head. His face is unobstructed in a subtle three-quarter ` +
    `view, eyes meeting the viewer. Soft directional light reveals facial depth. ` +
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
    `The reference image is the identity reference for one adult man. Redraw ` +
    `that same man in a three-quarter-length ` +
    `portrait, standing naturally against a plain neutral background. His face ` +
    `is unobstructed and clearly readable in a subtle three-quarter view, with ` +
    `his eyes meeting the viewer. Keep his exact face, hair, build, clothing, ` +
    `sex, and identity from ` +
    `the reference. Do not feminize him or turn him into a woman, girl, ` +
    `androgynous character, child, couple, or group. The finished portrait must ` +
    `show exactly one unmistakably adult man. ${STYLES[style].still} ` +
    `The reference image remains authoritative for his exact face, ethnicity, ` +
    `and age; apply the style as rendering only and never replace his identity. ` +
    `Do not apply default height, long-leg proportions or sharper facial contours to this reference. ` +
    `Preserve his actual proportions, facial softness or angularity, and facial hair.`
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
 * ending on the intended single-subject composition.
 */

/**
 * Front of every prompt. Declare the camera as the viewer's own eyesight
 * before the model sees any action. Story-generated visual actions use only
 * the camera or unseen viewer for the player, so this stays short and positive.
 */
export const POV_LEAD =
  "Direct first-person eye-level view from the unseen viewer.";

/**
 * Close every video prompt with the intended positive composition so H3
 * finishes on the single subject and stable viewpoint.
 */
export const POV_GUARD =
  "The same adult man is the sole visible person in a stable composition. Preserve the reference face, hair, age, build, clothing and accessories throughout. Natural anatomy: two arms and two hands belonging to him, with five fingers on each hand when visible; no duplicated or fused limbs. Keep the unseen viewer fully off-screen.";

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
 * FastH3 generates picture and sound together. Give it the exact LLM-written
 * Mandarin sentence; a shot without one receives a simple silent soundtrack.
 */
export function soundPrompt(spokenLine: string | null): string {
  const line = spokenLine?.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
  return line
    ? `Audio: very quiet ambience, no music during speech. After a brief natural pause, the young man speaks once in a clear, warm adult male ${getLanguage() === "en" ? "English" : "Mandarin"} voice, saying exactly: “${line}”. All speech must be ${getLanguage() === "en" ? "English only, never Mandarin or Chinese; do not translate the quoted line" : "Mandarin Chinese only"}. Use clear, unhurried conversational diction at normal volume, with precise lip sync. Speak only the quoted words once, then close his mouth and remain silent for the rest of the clip. No ad-libbing, repetitions, mumbling, singing or other voices. Keep the same male voice across scenes; visual style does not determine speech language.`
    : "Audio: quiet natural ambience and soft instrumental music. The young man is silent.";
}

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
/** A fixed, localized greeting keeps the prologue from inventing dialogue. */
export function openingSpokenLine(): string {
  return getLanguage() === "en" ? "Good morning. You're awake." : "早安，你醒了。";
}

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
/** Routine process is condensed into one longer clip instead of many pauses. */
export const AUTO_SHOT_SECONDS = 12;
/** The waking prologue is a doorway, never its own scene. */
export const OPENING_SHOT_SECONDS = 5;
/** 768P is noticeably sharper on faces, which is the whole point here. */
export const RESOLUTION: "480P" | "768P" = "768P";
