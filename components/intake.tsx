"use client";

import { useEffect, useRef, useState } from "react";
import type { Character } from "@/lib/character";
import { primeReactorAudio } from "@/lib/reactor";
import { STYLES, STYLE_ORDER, type StyleKey } from "@/lib/styles";

/**
 * The question asked before the eyes open.
 *
 * It asks the player which look they want and what they want from today.
 * Paid visual generation starts only after a completed wish passes
 * moderation. Typing or changing setup choices cannot spend a video clip.
 */
export function Intake({
  style,
  onStyle,
  videoOff,
  onVideoMode,
  him,
  onOpenCreator,
  onSubmit,
  notice,
  busy,
  styleChosen,
}: {
  style: StyleKey;
  onStyle: (style: StyleKey) => void;
  videoOff: boolean;
  onVideoMode: (off: boolean) => void;
  him: Character | null;
  onOpenCreator: () => void;
  onSubmit: (wish: string) => void;
  notice: string | null;
  busy: boolean;
  /** A style is a required first choice: he is made inside that visual world. */
  styleChosen: boolean;
}) {
  const [wish, setWish] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  // Nothing can start until the visual world and the person in it are chosen.
  const ready = wish.trim().length > 0 && !busy && him !== null && styleChosen;
  const send = () => {
    if (!ready) return;
    if (!videoOff) primeReactorAudio();
    onSubmit(wish);
  };

  return (
    <div className="intake">
      {/* 无视频模式. Deliberately the only thing in the corner, and deliberately
          not styled as a setting — it changes what a beat costs by roughly a
          factor of ten, which makes it the most consequential control on the
          page after the wish box itself. It does NOT wake the run: flipping
          it is a decision about how to play, not the start of playing. */}
      <button
        type="button"
        className={`mode${videoOff ? " off" : ""}`}
        disabled={busy}
        onClick={() => {
          if (videoOff) primeReactorAudio();
          onVideoMode(!videoOff);
        }}
        title={
          videoOff
            ? "每一幕生成一张静帧，不调用视频服务"
            : "每一幕约五秒视频，由 H3 按需生成"
        }
      >
        <span className="mode-dot" aria-hidden />
        {videoOff ? "无视频模式" : "视频模式 · 按幕生成"}
      </button>

      <div className="intake-inner">
        <p className="intake-eyebrow">还没睁开眼</p>
        {/* He is never named here. On this screen he is only "他" — the player
            has not opened their eyes yet, and a name is something you are
            told by someone, not something you start the day already holding.
            His name appears the first time he speaks. */}
        <h1>
          今天，你想和他
          <br />
          做点什么？
        </h1>
        <p className="sub">
          随便写。一句话，一个念头，或者只是一种心情。
          <br />
          你写下的，就是这一天真正会发生的事。
        </p>

        <section className="styles styles-first" aria-labelledby="style-choice-title">
          <p className="styles-label" id="style-choice-title">先选这一天的画风</p>
          <p className="styles-note">他的样子会从这里开始长出来。</p>
          <div className="style-row">
            {STYLE_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                className={`style-card${styleChosen && key === style ? " on" : ""}`}
                disabled={busy}
                onClick={() => onStyle(key)}
              >
                <span className="style-name">{STYLES[key].label}</span>
                <span className="style-hint">{STYLES[key].hint}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Who he is. Shown as his own face rather than his name, because the
            portrait is the thing that is actually load-bearing — and because
            a face is the fastest way to tell whether the boy you made is the
            boy you wanted. Opening the creator does NOT wake the run.

            With nobody made yet this is the empty slot, and it is the loudest
            thing on the page on purpose: there is no default 男主, so this is
            not an option beside a ready-made boy, it is the first thing that
            has to happen. */}
        <button
          className={`him-card${him ? "" : " empty"}${styleChosen ? "" : " locked"}`}
          onClick={onOpenCreator}
          disabled={busy || !styleChosen}
        >
          {him && him.hasArt !== false ? (
            <img
              src={`/api/portrait?id=${encodeURIComponent(him.id)}&style=${style}&raw=1`}
              alt=""
            />
          ) : (
            <span className="him-blank" aria-hidden>
              {him ? him.name.slice(0, 1) : ""}
            </span>
          )}
          <span className="him-body">
            <span className="him-label">{him ? "他是" : styleChosen ? "还没有他" : "第一步还没完成"}</span>
            <span className="him-name">
              {him ? him.name : styleChosen ? "做一个男主" : "先选画风"}
            </span>
          </span>
          <span className="him-swap">
            {him ? "换一个" : styleChosen ? "去选角" : "选择画风"}
          </span>
        </button>

        <div className="wish-field">
          <textarea
            ref={field}
            value={wish}
            maxLength={280}
            placeholder={
              !styleChosen
                ? "先选这一天的画风"
                : him
                  ? "想赖床，让他多陪一会儿……"
                  : "先做一个他，再写今天"
            }
            onChange={(event) => {
              setWish(event.target.value);
            }}
            onKeyDown={(event) => {
              // Enter sends, shift+enter breaks the line — the convention for
              // a box you write one sentence into.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            disabled={busy || him === null || !styleChosen}
          />
        </div>

        <div className="intake-actions">
          <span className="hint">
            {styleChosen ? "Enter 睁眼 · Shift+Enter 换行" : "先选画风，再遇见他"}
          </span>
          <button className="btn" onClick={send} disabled={!ready}>
            {busy ? "睁 眼 中" : "睁 眼"}
          </button>
        </div>

        {notice && <p className="notice">{notice}</p>}

        <div className="readiness" aria-hidden>
          <i />
        </div>
      </div>
    </div>
  );
}
