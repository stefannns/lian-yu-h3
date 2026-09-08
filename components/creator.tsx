"use client";

import { useEffect, useRef, useState } from "react";
import type { Character } from "@/lib/character";
import type { StyleKey } from "@/lib/styles";

/**
 * 选角 — where a 男主 comes from.
 *
 * Two roads to the same place, because they are the two things a person
 * actually has when they sit down: a picture of him, or an idea of him.
 *
 *   写 — describe him in 中文. Gemini turns it into the English descriptor
 *        every shot prompt carries, and nano-banana paints his portrait.
 *   传 — upload a picture. The picture IS him; Gemini only reads it into
 *        words, because the text half of the pipeline cannot see images.
 *
 * The upload road is the one worth understanding: his face is not re-invented
 * from a caption, it is kept and redrawn into whichever look the run is in
 * (see restylePrompt in lib/character.ts). Upload a photo, play in 日系动画,
 * and you get that person as a drawing rather than a stranger who matches the
 * description.
 *
 * Making him costs one or two model calls, which is why the button says so.
 */
export function Creator({
  style,
  onPick,
  onClose,
}: {
  style: StyleKey;
  onPick: (him: Character) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"write" | "upload">("write");
  const [idea, setIdea] = useState("");
  const [name, setName] = useState("");
  const [upload, setUpload] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portraitLoaded, setPortraitLoaded] = useState(false);
  const [made, setMade] = useState<{
    him: Character;
    portrait: string;
  } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  // Escape closes, the way every overlay should.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const readFile = (input: File) => {
    // 8MB is the route's ceiling; caught here so the player is told before
    // the upload rather than after it.
    if (input.size > 8 * 1024 * 1024) {
      setError("图片太大了，换一张小于 8MB 的。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUpload(typeof reader.result === "string" ? reader.result : null);
      setError(null);
    };
    reader.onerror = () => setError("这张图读不出来。");
    reader.readAsDataURL(input);
  };

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/cast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "upload"
            ? { mode: "upload", name, image: upload, style }
            : { mode: "write", name, idea, style }
        ),
      });
      const body = (await response.json()) as {
        him?: Character;
        portrait?: string | null;
        error?: string;
      };
      if (!response.ok || !body.him || !body.portrait || !body.him.hasArt) {
        setError(body.error ?? "立绘没能准备好，请再试一次。");
        return;
      }
      setPortraitLoaded(false);
      setMade({ him: body.him, portrait: body.portrait });
    } catch {
      setError("没能把他做出来。");
    } finally {
      setBusy(false);
    }
  };

  const canMake = !busy && (mode === "upload" ? Boolean(upload) : idea.trim().length > 0);

  return (
    <div className="creator">
      <div className="creator-sheet">
        <div className="creator-head">
          <p className="intake-eyebrow" style={{ margin: 0 }}>选 角</p>
          <button className="creator-x" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </div>

        {made ? (
          <div className="made">
            <img
              className="made-art"
              src={made.portrait}
              alt="他的立绘"
              onLoad={() => setPortraitLoaded(true)}
              onError={() => {
                setPortraitLoaded(false);
                setError("立绘加载失败，请重新创建。");
              }}
            />
            <div className="made-body">
              <p className="made-name">{made.him.name}</p>
              <p className="made-desc">{made.him.descriptor}</p>
              {error && <p className="notice">{error}</p>}
              <div className="made-actions">
                <button
                  className="btn"
                  disabled={!portraitLoaded}
                  onClick={() => {
                    if (!portraitLoaded) return;
                    onPick(made.him);
                    onClose();
                  }}
                >
                  就 是 他
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    setMade(null);
                    setPortraitLoaded(false);
                    setError(null);
                    setUpload(null);
                  }}
                >
                  再做一个
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="creator-tabs">
              <button
                className={mode === "write" ? "on" : ""}
                onClick={() => setMode("write")}
                disabled={busy}
              >
                写一个
              </button>
              <button
                className={mode === "upload" ? "on" : ""}
                onClick={() => setMode("upload")}
                disabled={busy}
              >
                传一张
              </button>
            </div>

            {mode === "write" ? (
              <textarea
                className="creator-input"
                value={idea}
                maxLength={400}
                placeholder="话很少的钢琴老师，戴细框眼镜，总穿深灰色的毛衣……"
                onChange={(event) => setIdea(event.target.value)}
                disabled={busy}
              />
            ) : (
              <div className="drop">
                <input
                  ref={file}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (chosen) readFile(chosen);
                  }}
                />
                {upload ? (
                  <img className="drop-art" src={upload} alt="" />
                ) : (
                  <button
                    className="drop-zone"
                    onClick={() => file.current?.click()}
                    disabled={busy}
                  >
                    选一张他的图
                    <span>会按你选的画风重画一遍，脸不变</span>
                  </button>
                )}
                {upload && (
                  <button
                    className="ghost"
                    onClick={() => setUpload(null)}
                    disabled={busy}
                  >
                    换一张
                  </button>
                )}
                {/* Short, once, and not a lecture — but an uploaded face ends
                    up in generated romantic footage, which is worth one line
                    of honesty before it happens. */}
                <p className="drop-note">
                  请用你自己的画、你自己的照片，或者虚构角色。别传别人的照片。
                </p>
              </div>
            )}

            <input
              className="creator-name"
              value={name}
              maxLength={12}
              placeholder="他叫什么？（留空就让它取）"
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />

            {error && <p className="notice">{error}</p>}

            <button className="btn wide" onClick={make} disabled={!canMake}>
              {busy
                ? "正 在 做 他"
                : mode === "upload"
                  ? "就 用 这 张"
                  : "做 出 来"}
            </button>
            <p className="hint" style={{ textAlign: "center", marginTop: 10 }}>
              {mode === "upload"
                ? "以这张图作为他的立绘，保留原本的样子"
                : "会为他生成一张立绘，确认后开始故事"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
