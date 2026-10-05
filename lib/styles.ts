/**
 * The three looks.
 *
 * A style preset is not decoration — it is a clause appended to EVERY prompt
 * the run produces: his portrait, the painted first frame, every shot, every
 * card. h3 sees only the current call, so a look declared once at the start
 * is a look gone by the third beat; it has to be restated every time. See
 * dress() in lib/story.ts and the paint calls in lib/engine.ts.
 *
 * Each is written as NAMED TECHNIQUES rather than adjectives. "Anime" alone
 * drifts toward generic digital illustration and "realistic" toward muddy
 * stock footage; cel shading, subsurface scattering and anamorphic flare are
 * things a model can actually hold across ten shots.
 */

export type StyleKey = "anime" | "cg3d" | "real";

export interface StylePreset {
  /** Shown on the picker card. */
  label: string;
  /** The clause appended to every video prompt. */
  prompt: string;
  /**
   * The clause used when painting his portrait and the opening still.
   * Split from `prompt` because a still wants composition and finish
   * language, while a clip wants motion and lighting language — the same
   * sentence does one of those jobs badly.
   */
  still: string;
}

/** Animation defaults retain the original otome look; explicit identities take priority. */
export const STYLES: Record<StyleKey, StylePreset> = {
  anime: {
    label: "日系动画",
    prompt:
      "Japanese otome anime CG: refined adult proportions, crisp cel shading and ink lines, delicate background, warm romantic light, sophisticated mature romantic character design.",
    still:
      "Rendered as a refined Japanese otome anime game CG. Unless the character " +
      "description or identity reference explicitly specifies another adult identity, " +
      "the male lead is a youthful, strikingly handsome East Asian adult in his " +
      "early-to-mid twenties, with elegant modern hair, expressive eyes, a clean-shaven " +
      "face and slim athletic proportions. Sophisticated adult features, never childish " +
      "or toy-like. Hand-drawn cel shading, crisp delicate ink linework, controlled flat " +
      "shadow shapes, warm romantic light, soft bloom and a detailed painted background.",
  },
  cg3d: {
    label: "3D动画",
    prompt:
      "Love and Deepspace-inspired Chinese otome 3D game cinematic: refined adult face and proportions, luminous skin, groomed hair, detailed fabric, cool shadows, warm key light, shallow depth of field.",
    still:
      "Rendered as a polished Chinese otome 3D animated game CG in the visual style of Love and Deepspace (恋与深空). Unless the character " +
      "description or identity reference explicitly specifies another adult identity, the " +
      "male lead is a youthful, strikingly handsome East Asian adult in his early-to-mid " +
      "twenties, with " +
      "a refined oval face, straight neat brows, expressive almond-shaped eyes, a graceful " +
      "nose and lips, smooth clean-shaven skin, elegant silky modern hair and slim athletic " +
      "proportions. Premium stylized-realistic character rendering, luminous " +
      "subsurface-scattered skin, physically based fabric, cool ambient shadows, soft warm " +
      "key light, intimate shallow depth of field and delicate bloom. Clearly adult and " +
      "fresh-faced; no middle-aged appearance, rugged Western casting, square heavy jaw, " +
      "deep facial lines, beard, stubble or weathered skin by default. Explicit player appearance requests and uploaded reference identities override these casting defaults; preserve them while applying the 3D rendering style.",
  },
  real: {
    label: "写实电影",
    prompt: "Photoreal romantic cinema: natural skin texture, fine hair, directional soft light, shallow depth of field, subtle grain and restrained film colour. Preserve the established adult identity and physique.",
    still: "Photoreal romantic film still. Authentic skin texture and fine hair detail, anatomically believable proportions, gentle directional light revealing the existing facial structure, restrained retouching, shallow depth of field and subtle film grain. Preserve the reference identity, adult age, ethnicity, facial shape, facial hair and physique; no plastic skin or generic face replacement.",
  },
};

/** The look a run starts on if the player never touches the picker. */
export const DEFAULT_STYLE: StyleKey = "anime";

/** Order the cards are shown in. */
export const STYLE_ORDER: StyleKey[] = ["anime", "cg3d", "real"];

export function isStyleKey(value: unknown): value is StyleKey {
  return typeof value === "string" && value in STYLES;
}
