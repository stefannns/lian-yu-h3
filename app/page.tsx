"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Creator } from "@/components/creator";
import { Intake } from "@/components/intake";
import { Stage } from "@/components/stage";
import { Director } from "@/lib/engine";
import type { Character } from "@/lib/character";
import type { StyleKey } from "@/lib/styles";

export default function Page() {
  const ref = useRef<Director | null>(null);
  if (!ref.current) ref.current = new Director();
  const director = ref.current;

  const state = useSyncExternalStore(
    director.subscribe,
    director.getSnapshot,
    // The server render has no director state to read, so it renders the
    // intake screen — which is what the client mounts with anyway.
    director.getSnapshot
  );

  // Nothing generates on mount. The opening starts on the first wish
  // keystroke after the player has deliberately chosen both the look and
  // him; until then there is no correct opening to film. begin() is
  // idempotent; setStyle() restarts it if they change their mind.
  const [creating, setCreating] = useState(false);
  // The engine has a safe internal default, but the player must deliberately
  // choose a look before making him: his portrait is generated in that look.
  const [styleChosen, setStyleChosen] = useState(false);
  const onWake = useCallback(() => director.begin(), [director]);
  const onPickHim = useCallback(
    (him: Character) => director.setCharacter(him),
    [director]
  );
  const onStyle = useCallback((key: StyleKey) => {
    setStyleChosen(true);
    director.setStyle(key);
  }, [director]);
  const onVideoMode = useCallback(
    (off: boolean) => director.setVideoMode(off),
    [director]
  );
  const onSubmit = useCallback((wish: string) => void director.submitWish(wish), [director]);
  const onClipEnded = useCallback(() => director.onClipEnded(), [director]);
  const onChoose = useCallback((index: number) => director.choose(index), [director]);
  const onTyped = useCallback((text: string) => void director.submitTyped(text), [director]);
  const onRetry = useCallback(() => director.retryScene(), [director]);

  if (state.phase === "error") {
    return (
      <div className="stop">
        <div>
          <h2>今天到这里了</h2>
          <p>{state.error}</p>
          <button
            className="btn"
            onClick={() => {
              director.reset();
              director.begin();
            }}
          >
            重 新 醒 来
          </button>
        </div>
      </div>
    );
  }

  // Before the eyes open — and also for the stretch after the wish is sent
  // but before the opening shot has landed, which is the one moment the
  // player is genuinely waiting on a cold start.
  if (state.phase === "intake" || state.currentShot === null) {
    return (
      <>
        {creating && (
          <Creator
            style={state.style}
            onPick={onPickHim}
            onClose={() => setCreating(false)}
          />
        )}
        <Intake
          style={state.style}
          onStyle={onStyle}
          videoOff={state.videoOff}
          onVideoMode={onVideoMode}
          onWake={onWake}
          onSubmit={onSubmit}
          notice={state.notice}
          him={state.him}
          onOpenCreator={() => setCreating(true)}
          busy={state.phase !== "intake"}
          styleChosen={styleChosen}
        />
      </>
    );
  }

  return (
    <Stage
      state={state}
      onClipEnded={onClipEnded}
      onChoose={onChoose}
      onTyped={onTyped}
      onRetry={onRetry}
    />
  );
}
