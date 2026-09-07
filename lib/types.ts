export type Phase =
  /** The intent screen. Scene one is already filming underneath it. */
  | "intake"
  /** A clip is on screen. */
  | "playing"
  /** Freeze-frame held while the storyteller reads the shot that just landed. */
  | "writing"
  /** Freeze-frame held, the cards offered, no clock. */
  | "choosing"
  /** The chosen shot is generating. */
  | "filming"
  | "error";

/** One offered move. The English shot prompt is written with the label, so
 *  picking a card costs no extra LLM call — it films immediately. */
export interface Choice {
  /** 中文, shown on the card. Second person, short. */
  label: string;
  /** English prompt for the shot this move produces. */
  prompt: string;
  /**
   * This move CUTS to a new scene rather than continuing the current one.
   *
   * Not cosmetic — it changes how the shot is filmed. A continuing shot
   * chains off the previous last frame, which is what holds the room. A cut
   * must NOT: handed the bedroom as its opening composition, h3 drags the
   * bedroom into the bakery. So a cut is filmed from his portrait alone —
   * new place, same person — and the room is allowed to be gone.
   */
  cut?: boolean;
}

/** What the storyteller returns after reading a shot. */
export interface Beat {
  /** English ground truth of what is actually visible. Never shown. */
  scene: string;
  /** 中文 narration of what just happened, second person, 1–2 sentences. */
  narration: string;
  /** One 中文 line from him, or null if he says nothing. */
  line: string | null;
  /** English, ≤60 words, completed facts — the run's rolling memory. */
  memory: string;
  /** The location changed this shot. */
  moved: boolean;
  /** True when this moment asks for her own words, with no preset cards. */
  freeOnly: boolean;
  /** The two next moves, unless freeOnly is true — see CHOICE_COUNT in lib/story.ts. */
  choices: Choice[];
}

export interface Shot {
  beat: number;
  /** What the player did to cause this shot — 中文, or null for the opening. */
  action: string | null;
  kind: "opening" | "intent" | "choice" | "typed";
  /** The English prompt that filmed it. Kept for the log. */
  prompt: string;
  /**
   * True when this beat was PAINTED rather than filmed — 无视频模式. The clip
   * fields are empty and the still is carried in `thumb`, which the stage
   * shows through the freeze layer it already has.
   */
  still: boolean;
  videoUrl: string;
  rawUrl: string;
  /** Small first-frame thumb for the history strip. */
  thumb: string;
}
