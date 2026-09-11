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

export const STYLES: Record<StyleKey, StylePreset> = {
  anime: {
    label: "日系动画",
    prompt:
      "Japanese otome anime CG: refined adult proportions, crisp cel shading and ink lines, delicate background, warm romantic light; never childish or cartoonish.",
    still:
      "Rendered as a Japanese shoujo anime illustration: hand-drawn cel shading, " +
      "crisp ink linework, flat shadow shapes, warm pastel palette, soft bloom, " +
      "delicate painted background.",
  },
  cg3d: {
    label: "3D动画",
    prompt:
      "Premium romantic sci-fi 3D game cinematic: refined adult face and proportions, luminous skin, groomed hair, detailed fabric, cool shadows, warm key light, shallow depth of field.",
    still:
      "Rendered as a premium romantic science-fiction 3D game still: refined " +
      "stylized-realistic adult proportions, luminous subsurface-scattered skin, groomed " +
      "silky hair, physically based fabric detail, cool ambient shadows and soft warm key " +
      "light, intimate shallow depth of field, delicate bloom, polished cinematic rendering.",
  },
  real: {
    label: "写实电影",
    prompt:
      "Photoreal live-action cinema: attractive adult lead, natural light and skin texture, fine hair, shallow depth of field, subtle grain, muted film colour.",
    still:
      "A photoreal live-action film still: natural window light, true skin " +
      "texture and fine hair detail, shallow depth of field on a fast prime lens, " +
      "subtle film grain, naturalistic muted colour grade.",
  },
};

/** The look a run starts on if the player never touches the picker. */
export const DEFAULT_STYLE: StyleKey = "anime";

/** Order the cards are shown in. */
export const STYLE_ORDER: StyleKey[] = ["anime", "cg3d", "real"];

export function isStyleKey(value: unknown): value is StyleKey {
  return typeof value === "string" && value in STYLES;
}
