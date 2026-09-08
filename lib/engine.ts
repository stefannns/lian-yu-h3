"use client";

/**
 * The Director: owns the run.
 *
 *   type your wish ──► scene one is ALREADY filming underneath you
 *          │                          │
 *          ▼                          ▼
 *   the wish becomes a shot     scene one plays
 *          └──► films during that playback ──► story decides: continue / ask ──► loop
 *
 * The whole design is one idea, inherited from LAST FRAME and narrowed to a
 * single branch: THE WAIT IS ALWAYS SOMEONE ELSE'S TIME. The player typing
 * pays for the opening shot. The opening shot playing pays for the wish
 * shot. A ten-second clip on screen is ten seconds of generation the player
 * never experiences as a spinner. The only unavoidable wait in the game is
 * after a choice card is tapped, because until it is tapped there is nothing
 * to film — and that is the one place a shutter card appears.
 *
 * State is one immutable snapshot published through subscribe(), so React is
 * a single useSyncExternalStore call. Every async continuation is guarded by
 * a run token, so a reset can never be clobbered by an in-flight shot.
 */

import { filmShot, loadPortrait, paintFrame } from "./fal";
import { extractFrames } from "./frames";
import { dress, imageKey, tellNext, writeIntentShot, writeTypedShot } from "./story";
import {
  OPENING_SHOT_SECONDS,
  RESOLUTION,
  SHOT_SECONDS,
  firstFramePrompt,
  openingShotPrompt,
  type Character,
} from "./character";
import { DEFAULT_STYLE, type StyleKey } from "./styles";
import type { Beat, Choice, Phase, Shot } from "./types";

/** Only an explicit wish to remain in bed earns a second bedroom beat. */
function isStayInBedWish(wish: string): boolean {
  return /赖床|不想起(?:床)?|再睡|继续睡|被窝|床上|先不起|别起床|多躺/.test(wish);
}

export interface DirectorState {
  phase: Phase;
  beat: number;
  /** The clip on screen, or the last one that was. */
  currentShot: Shot | null;
  /** Held over the video — it IS the video's last frame, so the handover
   *  between clip and freeze is invisible by construction. */
  freezeFrame: string | null;
  /** 中文 narration of the shot that just played. */
  narration: string | null;
  /** His 中文 line for that beat, or null. */
  line: string | null;
  /** The cards, when there are cards. */
  choices: Choice[];
  /** Every shot so far, for the history strip. */
  shots: Shot[];
  /** What is generating right now, shown on the shutter card. */
  workingLabel: string | null;
  /** Transient 中文 notice (a refused wish, a soft failure). */
  notice: string | null;
  /** A failed next scene can be retried without rewriting the player's action. */
  canRetryScene: boolean;
  error: string | null;
  /** True once his portrait is in hand — the identity anchor is live. */
  anchored: boolean;
  /** The look this run is being filmed in. */
  style: StyleKey;
  /** 无视频模式: beats are painted stills, not h3 clips. */
  videoOff: boolean;
  /** Who he is this run. Null until 选角 — the game will not start without him. */
  him: Character | null;
}

const INITIAL: DirectorState = {
  phase: "intake",
  beat: 0,
  currentShot: null,
  freezeFrame: null,
  narration: null,
  line: null,
  choices: [],
  shots: [],
  workingLabel: null,
  notice: null,
  canRetryScene: false,
  error: null,
  anchored: false,
  style: DEFAULT_STYLE,
  videoOff: true,
  him: null,
};

/** A finished shot, filmed and frame-extracted, waiting for its turn. */
interface Prepared {
  shot: Shot;
  lastFrame: string;
  strip: string[];
  /** 中文 or English, for the storyteller's "THE PLAYER JUST TRIED" line. */
  attempted: string;
}

interface SceneRequest {
  prompt: string;
  action: string | null;
  kind: Shot["kind"];
  attempted: string;
  fromFrame?: string;
}

/**
 * How long narration is held on the frozen frame before a queued shot is
 * allowed to take the screen. Without it the wish shot — which is usually
 * already in the can by then — cuts in before the player has read a word.
 */
const NARRATION_DWELL_MS = 2_600;

/**
 * How long a painted beat is held before it hands on, standing in for the ten
 * seconds a clip would have played. Long enough to look at, short enough that
 * a mode whose whole point is speed still feels fast — and it is also the
 * window the storyteller's read has to land in, exactly as playback is.
 */
const STILL_DWELL_MS = 5_000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Listener = () => void;

export class Director {
  private state: DirectorState = INITIAL;
  private listeners = new Set<Listener>();
  /** Bumped on reset; every async continuation checks it. */
  private token = 0;

  /** His portrait — ref2v "Image 2" on every shot. Null = i2v fallback. */
  private portrait: string | null = null;
  /** Full-res last frame of the newest landed shot; the next shot chains it. */
  private lastFrame: string | null = null;
  /** Running memory the storyteller rewrites each beat. */
  private memory = "";
  private wish = "";
  private decisions: string[] = [];
  /** Story-led beats since the player's last choice or free answer. */
  private automaticBeats = 0;
  /** Latest scene ground truth, for the free-text writer. */
  private scene = "";
  /** Labels already offered, so nothing is reoffered. */
  private offered: string[] = [];
  /** Fixed per run, varied per beat inside filmShot. */
  private seed = 0;
  /** The chosen look. Baked into every prompt and every painted still. */
  private style: StyleKey = DEFAULT_STYLE;
  /** 无视频模式. See paintBeat(). */
  private videoOff = true;
  /** The 男主 this run is about. Null until the player makes one. */
  private him: Character | null = null;
  /** Timer that ends a still's dwell, so it can be cancelled on reset. */
  private dwell: number | null = null;

  /** A shot already filmed and waiting for the current clip to finish. */
  private canned: Promise<Prepared | null> | null = null;
  private cannedRequest: SceneRequest | null = null;
  private retryRequest: SceneRequest | null = null;
  private retryRead: Prepared | null = null;
  /** The beat the storyteller wrote while the clip was playing. */
  private pendingBeat: Beat | null = null;
  private clipEnded = false;
  /** Set while the player is still typing and the opening is being prepared. */
  private wishSubmitted = false;
  /** begin() is idempotent: it starts a paid generation, so it fires once. */
  private started = false;

  // --- store plumbing ------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DirectorState => this.state;

  private set(patch: Partial<DirectorState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // --- the run -------------------------------------------------------------

  /**
   * Cast a different 男主, before the eyes open.
   *
   * Like the style and unlike the mode, this is baked into work already
   * started — his portrait and the opening still both contain him — so
   * changing it restarts the opening under a new token. Also like the style,
   * it survives a reset: he is a choice about the game, not about the run.
   */
  setCharacter(him: Character) {
    if (this.state.phase !== "intake" || this.wishSubmitted) return;
    if (him.id === this.him?.id) return;
    this.him = him;
    this.set({ him });
    if (!this.started) return;
    const token = ++this.token;
    this.canned = this.prepareOpening(token);
  }

  /**
   * Called the moment the intake screen mounts, not when the player submits.
   *
   * This is the whole trick of the opening: his portrait, the painted first
   * frame and the ten-second waking shot all generate while the player is
   * still deciding what they want from today. By the time they press enter
   * the film is usually already in the can.
   */
  begin(style: StyleKey = this.style) {
    // No 男主, no opening. There is no default to fall back on and inventing
    // one silently would be the exact behaviour this game just removed.
    if (this.started || !this.him) return;
    this.started = true;
    this.style = style;
    const token = ++this.token;
    this.seed = Math.floor(Math.random() * 1_000_000);
    this.set({ style });
    this.canned = this.prepareOpening(token);
  }

  /**
   * 无视频模式 on or off.
   *
   * Select before submitting the wish. If an opening is already being
   * prepared, replace it under a new token so the old mode cannot land.
   */
  setVideoMode(off: boolean) {
    if (this.state.phase !== "intake" || this.wishSubmitted) return;
    if (off === this.videoOff) return;
    this.videoOff = off;
    this.set({ videoOff: off });
    if (this.started) this.canned = this.prepareOpening(++this.token);
  }

  /**
   * Change the look before the eyes open.
   *
   * The style is baked into his portrait, the opening still and the opening
   * shot, so it cannot be swapped in after the fact — switching restarts the
   * opening from scratch under a new token, abandoning whatever was in
   * flight. That is why nothing generates until the player first touches the
   * page: a bare page load that bills a clip nobody chose the look for is
   * money spent on something certain to be thrown away.
   */
  setStyle(style: StyleKey) {
    if (this.state.phase !== "intake" || this.wishSubmitted) return;
    if (style === this.style && this.started) return;
    this.style = style;
    this.set({ style });
    if (!this.started) return;
    // Restart: the in-flight opening is in the wrong look now.
    const token = ++this.token;
    this.canned = this.prepareOpening(token);
  }

  private async prepareOpening(token: number): Promise<Prepared | null> {
    const him = this.him;
    if (!him) return null;
    try {
      // 无视频模式 is a Gemini still story: it never calls fal/H3, but each
      // beat has one painted frame, anchored to the character's portrait.
      if (this.videoOff) {
        this.portrait = him.hasArt ? await loadPortrait(him.id, this.style) : null;
        if (token !== this.token) return null;
        this.set({ anchored: this.portrait !== null });
        return await this.paintStill(token, {
          prompt: firstFramePrompt(him, this.style),
          action: null,
          kind: "opening",
          attempted: "waking up",
        });
      }

      // The portrait is cached on disk after the first ever run, so this is
      // normally a local file read, not a generation.
      this.portrait = await loadPortrait(him.id, this.style);
      if (token !== this.token) return null;
      this.set({ anchored: this.portrait !== null });

      // The opening is the one shot with no previous frame to inherit from,
      // so it is painted rather than cold-started: a dedicated image model
      // composes a far stronger establishing frame than t2v does, and holds
      // the declared style far better. With his portrait in hand this is an
      // EDIT from it, so the boy in the first frame is already the right boy.
      let first: string | undefined;
      try {
        first = await paintFrame({
          prompt: firstFramePrompt(him, this.style),
          seed: this.seed,
          width: 1280,
          height: 720,
          references: this.portrait ? [this.portrait] : [],
        });
      } catch (cause) {
        // A failed paint falls back to a cold t2v opening rather than
        // ending the run before it starts.
        console.error("[prepareOpening] first frame paint failed:", cause);
      }
      if (token !== this.token) return null;

      // Without a first frame the opening is a cold start — fine for video,
      // and in 无视频模式 it simply means the first beat has no picture.
      return await this.generate(token, {
        prompt: dress(openingShotPrompt(him), this.style),
        action: null,
        kind: "opening",
        attempted: "waking up",
        fromFrame: first,
      });
    } catch (cause) {
      console.error("[prepareOpening] failed:", cause);
      return null;
    }
  }

  /**
   * The player's wish. Moderation and the shot writer run in parallel; both
   * are hidden behind the opening clip, which starts playing immediately.
   */
  async submitWish(text: string) {
    if (this.state.phase !== "intake" || this.wishSubmitted) return;
    const him = this.him;
    const wish = text.trim().slice(0, 280);
    if (!wish || !him) return;
    // Also starts a fresh opening after a recoverable opening failure.
    this.begin();
    const token = this.token;
    this.wishSubmitted = true;
    this.set({ phase: "filming", workingLabel: "……", notice: null });

    const [moderation, written] = await Promise.all([
      fetch("/api/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: wish }),
      })
        .then((res) => (res.ok ? res.json() : { allowed: false }))
        .catch(() => ({ allowed: false })),
      writeIntentShot(wish, this.style, him, !isStayInBedWish(wish), this.videoOff),
    ]);
    if (token !== this.token) return;

    const wishCheck = moderation as { allowed?: boolean; degraded?: boolean };
    if (!wishCheck.allowed) {
      // Straight back to the intake screen. The opening shot keeps
      // generating in the background — nothing is thrown away.
      //
      // `degraded` means the check could not RUN, not that it said no. Those
      // are completely different things to the player, and telling someone
      // their perfectly ordinary sentence is unspeakable because a server
      // returned 503 is the worst version of this screen.
      this.wishSubmitted = false;
      this.set({
        phase: "intake",
        workingLabel: null,
        notice: wishCheck.degraded
          ? "审核没连上，不是你写的问题 —— 再按一次试试。"
          : "这个愿望说不出口。换一个吧。",
      });
      return;
    }

    this.wish = wish;
    // The opening plays first, and this films underneath it.
    const opening = this.canned;
    this.canned = null;
    const prepared = await (opening ?? Promise.resolve(null));
    if (token !== this.token) return;
    if (!prepared) {
      this.started = false;
      this.wishSubmitted = false;
      this.set({
        phase: "intake",
        workingLabel: null,
        notice: this.videoOff
          ? "开场画面暂时没生成成功。愿望还在，稍后再按一次睁眼。"
          : "开场没有拍成。愿望还在，稍后再按一次睁眼。",
      });
      return;
    }

    this.land(token, prepared);

    // The generation window: the wish shot films while the opening plays.
    const mustLeaveOpening = !isStayInBedWish(wish);
    const wishShot = written ?? {
      // The writer failing is not a reason to drop the player's wish — a
      // literal reading still films, it is just less well composed.
      label: wish,
      prompt: dress(
        mustLeaveOpening
          ? `Cut directly to the central scene the viewer asked for: ${wish}. ` +
            `The young man — ${him.descriptor} — is already there with her. ` +
            `Show the activity ready for the player's first meaningful decision; no bedroom or getting ready.`
          : `The young man — ${him.descriptor} — responds to what the viewer wants of ` +
            `this morning: ${wish}. One clear, tender physical action, unhurried.`,
        this.style,
        this.videoOff
      ),
      cut: mustLeaveOpening,
    };
    this.cannedRequest = {
      prompt: wishShot.prompt,
      // The first visible progress title is the player's own wish. The model's
      // visual-prompt label is useful internally but must not rewrite her words.
      action: wish.slice(0, 40),
      kind: "intent",
      attempted: wish,
      // The wish may cut straight to wherever it goes — the bakery, the sea —
      // rather than answering from the bed. See intentSystem in lib/story.ts.
      fromFrame: wishShot.cut ? undefined : prepared.lastFrame,
    };
    this.canned = this.generate(token, this.cannedRequest);
  }

  /** Take one of the cards. Nothing is pre-filmed, so this films now. */
  /**
   * Can the next shot be made? Video chains off the previous last frame and
   * is meaningless without one. In still mode this only confirms there is a
   * current story scene; that image is not sent to the next generation.
   */
  private canFilm(): boolean {
    return Boolean(this.lastFrame);
  }

  choose(index: number) {
    if (this.state.phase !== "choosing") return;
    const choice = this.state.choices[index];
    if (!choice || !this.canFilm()) return;
    const token = this.token;
    this.retryRequest = null;
    this.retryRead = null;
    this.set({ phase: "filming", workingLabel: choice.label, choices: [], notice: null, canRetryScene: false });
    void this.filmAndLand(token, {
      prompt: choice.prompt,
      action: choice.label,
      kind: "choice",
      attempted: choice.label,
      // A CUT deliberately drops the frame. Handing the old scene to a shot
      // that is supposed to be somewhere else makes h3 grow the new place out
      // of the old one — the bakery with the bedroom still in it. Without a
      // frame it films from his portrait alone: new place, same person.
      // Also null in a text-only run, where there is no frame at all.
      fromFrame: choice.cut ? undefined : (this.lastFrame ?? undefined),
    });
  }

  /** Type something of your own instead of taking a card. */
  async submitTyped(raw: string) {
    if (this.state.phase !== "choosing") return;
    const him = this.him;
    const text = raw.trim().slice(0, 280);
    if (!text || !him || !this.canFilm()) return;
    const token = this.token;
    const frame = this.lastFrame ?? "";
    this.retryRequest = null;
    this.retryRead = null;
    this.set({ phase: "filming", workingLabel: text, choices: [], notice: null, canRetryScene: false });

    const [moderation, written] = await Promise.all([
      fetch("/api/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then((res) => (res.ok ? res.json() : { allowed: false }))
        .catch(() => ({ allowed: false })),
      writeTypedShot({
        text,
        wish: this.wish,
        decisions: this.decisions,
        still: this.videoOff,
        memory: this.memory,
        scene: this.scene,
        style: this.style,
        him,
      }),
    ]);
    if (token !== this.token) return;

    const typedCheck = moderation as { allowed?: boolean; degraded?: boolean };
    if (!typedCheck.allowed) {
      // Back to the cards the beat already wrote — nothing is regenerated.
      this.set({
        phase: "choosing",
        workingLabel: null,
        choices: this.pendingChoices,
        notice: typedCheck.degraded
          ? "审核没连上，不是你写的问题 —— 再试一次。"
          : "这个说不出口。换一个吧。",
      });
      return;
    }

    const shot = written ?? {
      label: text,
      prompt: dress(
        `The young man — ${him.descriptor} — responds as the viewer does this: ${text}. ` +
          `Advance the chosen activity with a complete view of the current setting: ${this.scene}.`,
        this.style,
        this.videoOff
      ),
    };
    void this.filmAndLand(token, {
      prompt: shot.prompt,
      action: shot.label,
      kind: "typed",
      attempted: text,
      fromFrame: shot.cut ? undefined : frame || undefined,
    });
  }

  /** Retry the same prompt and references, with no new story-writing call. */
  retryScene() {
    if (this.state.phase !== "choosing") return;
    if (this.retryRead) {
      const prepared = this.retryRead;
      this.retryRead = null;
      this.set({ phase: "writing", notice: null, canRetryScene: false });
      void this.read(this.token, prepared);
      return;
    }
    if (!this.retryRequest) return;
    const request = this.retryRequest;
    this.retryRequest = null;
    this.set({
      phase: "filming",
      workingLabel: request.action,
      choices: [],
      notice: null,
      canRetryScene: false,
    });
    void this.filmAndLand(this.token, request);
  }

  reset() {
    this.token++;
    this.portrait = null;
    this.lastFrame = null;
    this.memory = "";
    this.wish = "";
    this.decisions = [];
    this.automaticBeats = 0;
    this.scene = "";
    this.offered = [];
    this.canned = null;
    this.pendingBeat = null;
    this.cannedRequest = null;
    this.retryRequest = null;
    this.pendingChoices = [];
    this.retryRead = null;
    this.clipEnded = false;
    this.wishSubmitted = false;
    this.started = false;
    if (this.dwell !== null) window.clearTimeout(this.dwell);
    this.dwell = null;
    // The style survives a reset. It is a preference about how the player
    // wants to be shown this game, not a fact about the run that just ended.
    // The mode survives a reset for the same reason the style does: both are
    // preferences about how the player wants to be shown the game.
    this.state = {
      ...INITIAL,
      style: this.style,
      videoOff: this.videoOff,
      him: this.him,
    };
    for (const listener of this.listeners) listener();
  }

  // --- filming -------------------------------------------------------------

  /** The cards from the current beat, kept so a refusal can restore them. */
  private pendingChoices: Choice[] = [];

  /**
   * Film one shot and pull its frames. Returns null rather than throwing:
   * every caller has a different idea of what a failed shot means, and the
   * one thing none of them wants is an unhandled rejection mid-run.
   */
  private async generate(
    token: number,
    args: {
      prompt: string;
      action: string | null;
      kind: Shot["kind"];
      attempted: string;
      fromFrame?: string;
    }
  ): Promise<Prepared | null> {
    try {
      const beat = this.state.beat + 1;
      if (this.videoOff) return this.paintStill(token, { ...args, beat });
      const clip = await filmShot({
        prompt: `${imageKey({
          frame: Boolean(args.fromFrame),
          portrait: Boolean(this.portrait),
        })}${args.prompt}`,
        seed: this.seed,
        beat,
        duration: args.kind === "opening" ? OPENING_SHOT_SECONDS : SHOT_SECONDS,
        resolution: RESOLUTION,
        fromFrame: args.fromFrame,
        portrait: this.portrait ?? undefined,
      });
      if (token !== this.token) return null;

      const frames = await extractFrames(clip.videoUrl);
      if (token !== this.token) return null;

      return {
        shot: {
          beat,
          action: args.action,
          kind: args.kind,
          prompt: args.prompt,
          still: false,
          videoUrl: clip.videoUrl,
          rawUrl: clip.rawUrl,
          thumb: frames.thumb,
        },
        lastFrame: frames.lastFrame,
        strip: frames.strip,
        attempted: args.attempted,
      };
    } catch (cause) {
      console.error("[generate] shot failed:", cause);
      return null;
    }
  }

  /**
   * 无视频模式: one Gemini/Nano Banana still per beat, never a fal/H3 call.
   * Each scene is generated independently. Only his portrait is supplied
   * for identity; previous scene images are never used as an edit target.
   */
  private async paintStill(
    token: number,
    args: {
      beat?: number;
      action: string | null;
      kind: Shot["kind"];
      attempted: string;
      prompt: string;
      fromFrame?: string;
    }
  ): Promise<Prepared | null> {
    const beat = args.beat ?? this.state.beat + 1;
    const references = this.portrait ? [this.portrait] : [];
    const referenceLead = this.portrait
      ? "Image 1 is a character identity reference only. Keep his face and appearance. Compose a fresh scene from the text; do not copy the portrait's background or pose. "
      : "";

    try {
      const image = await paintFrame({
        prompt: `${referenceLead}${args.prompt}`,
        seed: this.seed + beat,
        width: 1280,
        height: 720,
        references,
      });
      if (token !== this.token) return null;
      return {
        shot: {
          beat,
          action: args.action,
          kind: args.kind,
          prompt: args.prompt,
          still: true,
          videoUrl: "",
          rawUrl: "",
          thumb: image,
        },
        lastFrame: image,
        strip: [image],
        attempted: args.attempted,
      };
    } catch (cause) {
      console.error("[paintStill] image failed:", cause);
      return null;
    }
  }

  /** Generate and put straight on screen — the path a tapped card takes. */
  private async filmAndLand(
    token: number,
    args: SceneRequest
  ) {
    const prepared = await this.generate(token, args);
    if (token !== this.token) return;
    if (!prepared) {
      // Empty choices are valid for free-input and story-led scenes. On a
      // failed generation, retry remains available and free input is a way out.
      this.retryRequest = args;
      this.set({
        phase: "choosing",
        workingLabel: null,
        choices: this.pendingChoices,
        canRetryScene: true,
        notice: this.videoOff
          ? "这一幕画面暂时没生成成功。可以重试这一幕，或换个回答。"
          : "这一幕没有拍成。可以重试这一幕，或换个回答。",
      });
      return;
    }
    this.land(token, prepared);
  }

  /**
   * Put a finished shot on screen and set the storyteller reading it. The
   * read costs zero wall-clock: it runs while the clip plays.
   */
  private land(token: number, prepared: Prepared) {
    this.retryRequest = null;
    this.retryRead = null;
    if (prepared.shot.kind === "choice" || prepared.shot.kind === "typed") {
      this.decisions = [...this.decisions, prepared.attempted].slice(-20);
      this.automaticBeats = 0;
    } else if (prepared.shot.kind === "auto") {
      this.automaticBeats += 1;
    }
    this.lastFrame = prepared.lastFrame;
    this.pendingBeat = null;
    this.clipEnded = false;

    this.set({
      phase: "playing",
      canRetryScene: false,
      beat: prepared.shot.beat,
      currentShot: prepared.shot,
      shots: [...this.state.shots, prepared.shot],
      freezeFrame: prepared.lastFrame,
      narration: null,
      line: null,
      choices: [],
      workingLabel: null,
      notice: null,
    });

    // A clip announces its own end; a still does not. In 无视频模式 the beat
    // is held for a fixed dwell and then handed on, which is also what makes
    // the mode watchable rather than a slideshow that waits for a click.
    // Cleared on reset and superseded by the next land().
    if (this.dwell !== null) window.clearTimeout(this.dwell);
    this.dwell = null;
    if (prepared.shot.still) {
      this.dwell = window.setTimeout(() => {
        if (token !== this.token || this.state.beat !== prepared.shot.beat) return;
        this.onClipEnded();
      }, STILL_DWELL_MS);
    }

    void this.read(token, prepared);
  }

  private async read(token: number, prepared: Prepared) {
    const him = this.him;
    if (!him) return;
    const beat = await tellNext({
      frames: prepared.strip,
      wish: this.wish,
      decisions: this.decisions,
      scene: this.scene,
      still: prepared.shot.still,
      opening: prepared.shot.kind === "opening",
      automaticBeats: this.automaticBeats,
      playerLed:
        prepared.shot.kind === "intent" ||
        prepared.shot.kind === "choice" ||
        prepared.shot.kind === "typed",
      memory: this.memory,
      attempted: prepared.attempted,
      previousLabels: this.offered,
      beat: prepared.shot.beat,
      style: this.style,
      him,
    });
    if (token !== this.token || this.state.beat !== prepared.shot.beat) return;
    if (!beat) {
      // Keep the generated image; retry narration without paying for it again.
      this.retryRead = prepared;
      this.clipEnded = true;
      this.pendingChoices = [];
      this.set({
        phase: "choosing", choices: [], workingLabel: null, canRetryScene: true,
        notice: "画面已生成，剧情暂时没写好。点重试这一幕即可继续。",
      });
      return;
    }

    this.memory = beat.memory || this.memory;
    this.scene = beat.scene || this.scene;
    this.pendingBeat = beat;
    // A still has no motion to finish: offer its choices as soon as ready.
    // Only the brief waking prologue keeps its five-second dwell.
    if (prepared.shot.still && prepared.shot.kind !== "opening") {
      if (this.dwell !== null) window.clearTimeout(this.dwell);
      this.dwell = null;
      this.clipEnded = true;
    }
    if (this.clipEnded) void this.applyBeat(token, beat);
  }

  /** Called by the stage when the clip on screen finishes. */
  onClipEnded() {
    if (this.state.phase !== "playing") return;
    this.clipEnded = true;
    if (this.pendingBeat) void this.applyBeat(this.token, this.pendingBeat);
    else this.set({ phase: "writing" }); // freeze holds until the read lands
  }

  private async applyBeat(token: number, beat: Beat) {
    this.pendingBeat = null;

    // A shot already in the can — on the opening beat, the player's wish.
    // Narration is shown first and held long enough to read, because the
    // canned clip is usually ready before the player has looked at it.
    if (this.canned) {
      const queued = this.canned;
      const request = this.cannedRequest;
      this.canned = null;
      this.cannedRequest = null;
      this.set({
        phase: "filming",
        narration: beat.narration,
        line: beat.line,
        choices: [],
        workingLabel: request?.action ?? "下一幕",
      });
      const [prepared] = await Promise.all([queued, this.videoOff ? Promise.resolve() : sleep(NARRATION_DWELL_MS)]);
      if (token !== this.token) return;
      if (!prepared) {
        // The queued shot died, so the cards this beat wrote become the
        // beat after all — they were only ever the unused alternative.
        this.offer(beat, { narration: false });
        this.retryRequest = request;
        this.set({
          canRetryScene: request !== null,
          notice: this.videoOff
            ? "愿望中的画面暂时没生成成功。可以重试这一幕，或从这里继续。"
            : "愿望中的那一幕没有拍成。可以重试这一幕，或从这里继续。",
        });
        return;
      }
      this.land(token, prepared);
      return;
    }

    // No meaningful decision here: the storyteller supplies the next shot
    // and the activity keeps moving without presenting filler cards.
    if (beat.interaction === "auto" && beat.continuation) {
      const next = beat.continuation;
      this.pendingChoices = [];
      this.set({
        phase: "filming",
        narration: beat.narration,
        line: beat.line,
        choices: [],
        workingLabel: next.label,
        canRetryScene: false,
        notice: null,
      });
      void this.filmAndLand(token, {
        prompt: next.prompt,
        action: next.label,
        kind: "auto",
        attempted: next.label,
        fromFrame: next.cut ? undefined : this.lastFrame ?? undefined,
      });
      return;
    }

    this.offer(beat, { narration: true });
  }

  /**
   * Put a beat's cards on screen. Only cards that are actually OFFERED go
   * into `offered` and `pendingChoices` — a beat whose choices were skipped
   * (the opening, where the player's wish films instead) must not narrow the
   * storyteller's space later, and must not be the fallback for a failure in
   * a scene it was never written for.
   */
  private offer(beat: Beat, opts: { narration: boolean }) {
    this.pendingChoices = beat.choices;
    this.offered = [...this.offered.slice(-6), ...beat.choices.map((c) => c.label)];
    this.set({
      phase: "choosing",
      choices: beat.choices,
      workingLabel: null,
      ...(opts.narration ? { narration: beat.narration, line: beat.line } : {}),
    });
  }
}
