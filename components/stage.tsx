"use client";

import { useEffect, useRef, useState } from "react";
import type { DirectorState } from "@/lib/engine";
import { playReactorClip, reactorMediaStream } from "@/lib/reactor";

/**
 * The theater: the shot on screen, or a slow push-in on its frozen last
 * frame while the player reads.
 *
 * 横屏. Every clip h3 returns is 16:9, so the film is given a real 16:9 box
 * and letterboxed inside whatever shape the window happens to be, rather
 * than being cover-cropped to fill it. Cropping a widescreen shot to a tall
 * window throws away the half of the frame he is not currently in — and in a
 * first-person game the composition IS the state, so losing the edges loses
 * the scene. Every overlay lives INSIDE that box, so the text sits on the
 * picture rather than on the bars.
 *
 * Nothing here cuts. Every layer crossfades, and the freeze sits permanently
 * above the video — because the freeze IS the video's last frame, fading it
 * up as the clip ends is invisible by construction. Mounting and unmounting
 * the two instead puts a hard edge at exactly the moment the eye is most
 * likely to catch one.
 */
const FADE_MS = 420;

/**
 * Keeps children mounted through their own fade-out, so a layer leaves as
 * gracefully as it arrives. Timer-driven rather than rAF on purpose: rAF does
 * not fire at all in some embedded preview browsers, and a transition that
 * never starts would leave the layer stuck invisible.
 */
function Fade({ show, children }: { show: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(show);
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    if (show) {
      setMounted(true);
      // One tick after mounting, so there is a zero-opacity frame to
      // transition FROM; setting both at once jumps straight to solid.
      const id = window.setTimeout(() => setVisible(true), 20);
      return () => window.clearTimeout(id);
    }
    setVisible(false);
    const id = window.setTimeout(() => setMounted(false), FADE_MS);
    return () => window.clearTimeout(id);
  }, [show]);

  if (!mounted) return null;
  return <div className={`fade-layer${visible ? " in" : ""}`}>{children}</div>;
}

function Script({
  name,
  narration,
  line,
}: {
  name: string;
  narration: string | null;
  line: string | null;
}) {
  if (!narration && !line) return null;
  return (
    <div className="script">
      <div className="script-inner">
        {line && <p className="speaker">{name}</p>}
        {line && <p className="line">「{line}」</p>}
        {narration && <p className="narration">{narration}</p>}
      </div>
    </div>
  );
}

function Choices({
  state,
  onChoose,
  onTyped,
  onRetry,
}: {
  state: DirectorState;
  onChoose: (index: number) => void;
  onTyped: (text: string) => void;
  onRetry: () => void;
}) {
  const [text, setText] = useState("");
  const freeOnly = state.choices.length === 0;

  return (
    <div className="choices">
      <Script name={state.him?.name ?? ""} narration={state.narration} line={state.line} />
      {(state.canRetryScene || !freeOnly) && (
        <div className="choice-list">
          {state.canRetryScene && (
            <button className="card" onClick={onRetry}>重试这一幕</button>
          )}
          {state.choices.map((choice, index) => (
            <button key={choice.label} className="card" onClick={() => onChoose(index)}>
              {choice.label}
            </button>
          ))}
        </div>
      )}
      {freeOnly && <p className="free-prompt">这一刻，由你来回答。</p>}
      <div className={`typed${freeOnly ? " free-only" : ""}`}>
        <input
          value={text}
          maxLength={280}
          placeholder={freeOnly ? "想对他说什么，或者想怎么做？" : "或者，自己说点什么、做点什么……"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && text.trim()) {
              onTyped(text);
              setText("");
            }
          }}
        />
        <button
          disabled={!text.trim()}
          onClick={() => {
            onTyped(text);
            setText("");
          }}
        >
          就 这 样
        </button>
      </div>
      {state.notice && (
        <p className="notice" style={{ textAlign: "center", color: "#e6b7c2" }}>
          {state.notice}
        </p>
      )}
    </div>
  );
}

export function Stage({
  state,
  onClipEnded,
  onReactorClipEnded,
  onReactorClipFailed,
  onChoose,
  onTyped,
  onRetry,
}: {
  state: DirectorState;
  onClipEnded: () => void;
  onReactorClipEnded: (frames: { lastFrame: string; strip: string[]; thumb: string }) => void;
  onReactorClipFailed: (message?: string) => void;
  onChoose: (index: number) => void;
  onTyped: (text: string) => void;
  onRetry: () => void;
}) {
  const liveVideo = useRef<HTMLVideoElement>(null);
  const [reactorMuted, setReactorMuted] = useState(false);
  const [visibleReactorClip, setVisibleReactorClip] = useState<string | null>(null);
  const reactorClipId = state.currentShot?.reactorClipId;

  useEffect(() => {
    if (!reactorClipId || state.currentShot?.still) return;
    const video = liveVideo.current;
    if (!video) return;
    let cancelled = false;
    let timer: number | null = null;
    let stream: MediaStream | null = null;
    let sawVisibleFrame = false;
    const samples: string[] = [];

    // An idle Reactor stream is black and may not have produced enough media
    // for HTMLMediaElement.play() to settle yet. Never await that promise
    // before sending Reactor's own `play` command or the two sides can
    // deadlock: the element waits for media while Reactor waits for `play`.
    // ReactorView uses the same best-effort, non-blocking attachment pattern.
    const startElementPlayback = () => {
      void video.play().catch(() => {
        if (cancelled) return;
        video.muted = true;
        setReactorMuted(true);
        void video.play().catch(() => undefined);
      });
    };

    // Reactor tracks begin on the session's idle black frame. Chromium can
    // keep rendering that frame when media starts unless the stream is
    // reattached on the track's unmute event. This mirrors ReactorView.
    const onTrackUnmute = () => {
      if (cancelled || !stream) return;
      video.srcObject = null;
      video.srcObject = stream;
      startElementPlayback();
    };

    const grab = (width: number, quality: number) => {
      if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return "";
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round(video.videoHeight * width / video.videoWidth);
      const context = canvas.getContext("2d");
      if (!context) return "";
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", quality);
    };

    const revealIfVisible = () => {
      if (sawVisibleFrame || !video.videoWidth || !video.videoHeight || video.readyState < 2) return;
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 9;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 30) lit++;
      }
      if (lit < 4) return;
      sawVisibleFrame = true;
      setVisibleReactorClip(reactorClipId);
    };

    void (async () => {
      try {
        const receivedStream = await reactorMediaStream();
        if (cancelled) return;
        stream = receivedStream;
        for (const track of stream.getTracks()) {
          track.addEventListener("unmute", onTrackUnmute);
        }
        video.srcObject = stream;
        startElementPlayback();
        timer = window.setInterval(() => {
          revealIfVisible();
          const frame = grab(512, 0.75);
          if (frame) {
            samples.push(frame);
            if (samples.length > 10) samples.shift();
          }
        }, 900);
        await playReactorClip(reactorClipId, () => {
          if (cancelled) return;
          if ("requestVideoFrameCallback" in video) {
            video.requestVideoFrameCallback(() => {
              if (!cancelled) revealIfVisible();
            });
          }
        });
        if (cancelled) return;
        if (timer !== null) window.clearInterval(timer);
        revealIfVisible();
        if (!sawVisibleFrame) {
          throw new Error("Reactor played the clip but delivered only black frames.");
        }
        const finalSmall = grab(768, 0.8);
        if (finalSmall) samples.push(finalSmall);
        const lastFrame = grab(1344, 0.92);
        const thumb = grab(168, 0.7);
        if (!lastFrame || !thumb) throw new Error("Reactor clip ended without a readable frame.");
        const middle = samples[Math.floor(samples.length / 2)];
        const strip = [samples[0], middle, samples.at(-1)].filter(Boolean) as string[];
        onReactorClipEnded({ lastFrame, strip, thumb });
      } catch (cause) {
        if (!cancelled) {
          onReactorClipFailed(cause instanceof Error ? cause.message : "Reactor 视频播放失败。");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      if (stream) {
        for (const track of stream.getTracks()) {
          track.removeEventListener("unmute", onTrackUnmute);
        }
      }
      video.srcObject = null;
    };
  }, [reactorClipId, state.currentShot?.still, onReactorClipEnded, onReactorClipFailed]);

  // A painted beat has no <video> at all, so the freeze layer — which is
  // already mounted above the video and already does a slow push-in — simply
  // stays up and becomes the presentation. 无视频模式 needs no second code
  // path on screen; it needs one fewer.
  const showVideo =
    state.phase === "playing" &&
    state.currentShot !== null &&
    !state.currentShot.still;
  const videoVisible =
    showVideo &&
    (!reactorClipId || visibleReactorClip === reactorClipId);
  const held = state.phase === "choosing" || state.phase === "writing";

  return (
    <div className="theater">
      {/* Portrait phones get one instruction and nothing else. The film is
          16:9 and the text sits on top of it; at portrait widths that box is
          a stripe with unreadable type in it, and no amount of reflow fixes
          a shot composed for a shape the screen does not have. */}
      <div className="rotate">
        <div className="rotate-inner">
          <div className="rotate-icon" aria-hidden>
            ▭
          </div>
          <p>请横屏观看</p>
        </div>
      </div>

      <div className="film">
      {state.currentShot && !state.currentShot.still && (
        state.currentShot.reactorClipId
          ? <video
              ref={liveVideo}
              key={state.currentShot.reactorClipId}
              autoPlay
              playsInline
              muted={reactorMuted}
            />
          : <video
              key={state.currentShot.videoUrl}
              src={state.currentShot.videoUrl}
              autoPlay
              playsInline
              onEnded={onClipEnded}
            />
      )}
      {showVideo && state.currentShot?.reactorClipId && reactorMuted && (
        <button
          className="audio-unmute"
          onClick={() => {
            if (liveVideo.current) {
              liveVideo.current.muted = false;
              void liveVideo.current.play();
            }
            setReactorMuted(false);
          }}
        >
          开启声音
        </button>
      )}
      {state.freezeFrame && (
        <img
          className={`freeze${videoVisible ? "" : " shown"}${held ? " dimmed" : ""}`}
          src={state.freezeFrame}
          alt=""
        />
      )}
      <div className="vignette" />

      {state.phase === "filming" && (
        <div className="scene-progress" role="status">
          {state.videoOff ? "正在生成下一张画面" : "正在生成下一段视频"}
          {state.workingLabel && `：${state.workingLabel}`}
          <span>请稍候，完成后会自动继续</span>
        </div>
      )}

      {/* Narration during the queued-shot hold, where there are no cards yet
          but there is something to read. */}
      <Fade show={state.phase === "filming" && state.narration !== null}>
        <Script name={state.him?.name ?? ""} narration={state.narration} line={state.line} />
      </Fade>

      <Fade show={state.phase === "choosing"}>
        <Choices state={state} onChoose={onChoose} onTyped={onTyped} onRetry={onRetry} />
      </Fade>

      {/* The shutter card only appears when there is genuinely nothing else
          to look at: a tapped card, with no narration left holding the frame. */}
      <Fade show={state.phase === "filming" && state.narration === null}>
        <div className="shutter">
          <div className="shutter-card">
            <p className="shutter-label">{state.workingLabel ?? "……"}</p>
            <div className="breath">
              <i />
            </div>
          </div>
        </div>
      </Fade>

      <Fade show={state.phase === "writing"}>
        <div className="shutter">
          <div className="shutter-card">
            <div className="breath">
              <i />
            </div>
          </div>
        </div>
      </Fade>
      </div>
    </div>
  );
}
