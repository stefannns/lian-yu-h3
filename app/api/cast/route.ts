import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { portraitPrompt, type Character } from "@/lib/character";
import { generateGemini, type GeminiPart } from "@/lib/gemini";
import { generateImage, toDataUri } from "@/lib/imagegen";
import { DEFAULT_STYLE, isStyleKey } from "@/lib/styles";

/**
 * The cast: making a 男主, by writing one or by uploading one.
 *
 * Both roads end at the same two artifacts, because those are the only two
 * things the rest of the game consumes —
 *
 *   source.jpg     one picture of him, from which every style's portrait is
 *                  later derived by /api/portrait.
 *   character.json name, English descriptor, English temperament.
 *
 * The DESCRIPTOR is the part that is easy to underestimate. It is not a
 * caption: it is written verbatim into every shot prompt for the whole run,
 * and it is what keeps the words and the picture agreeing when h3 drifts. So
 * an upload does not skip it — the picture is read by Gemini and a descriptor
 * is written FROM it, which is the only way an uploaded face can also exist
 * in the text half of the pipeline.
 *
 *   POST { mode: "write",  name?, idea }       -> Gemini writes him, then paints him
 *   POST { mode: "upload", name?, image }      -> the image is his, Gemini reads it
 *
 * Both video and still-image play require a portrait. A failed paint returns
 * an error instead of creating an incomplete character for approval.
 *
 * The files live under .cache/cast/<id>/ only as the current run's private
 * continuity cache: the server needs the descriptor and source picture for
 * later shots. This app deliberately has no saved-character library and no
 * API that lists past characters.
 */

const CAST_DIR = path.join(process.cwd(), ".cache", "cast");

const MAX_IDEA_CHARS = 400;
const MAX_NAME_CHARS = 12;
/** ~8MB of base64. Bigger than any sane portrait upload, small enough to hold. */
const MAX_IMAGE_CHARS = 11_000_000;

/**
 * Gemini writes the character. Same shape from both roads, so the caller does
 * not branch: only the input differs — an idea, or a picture.
 */
const WRITE_SYSTEM = `You write one 男主 (male love interest) for a first-person 乙女游戏.

Return ONLY JSON in exactly this shape:
{"name": string, "descriptor": string, "temperament": string}

- name: 中文，两到三个字，好听，像小说里的男主。没有姓氏也可以。
- descriptor: ENGLISH, one phrase, appearance ONLY, written verbatim into every shot prompt of the run. Write it as a NOUN PHRASE that can sit inside a sentence — start with the build or a feature, never with "A young man..." (the sentence already says that), and never end with an art note like "with beige as the dominant colour" or "dominated by a warm palette", which describes the whole picture rather than him. Good: "tall and lean, with messy dark hair, in an oversized beige cable-knit sweater". Concrete and visual: build, hair, and the one or two garments that make his silhouette. Name ONE dominant colour. Never describe his face in detail — faces do not survive a video model, and his face is carried by a reference image; colour and silhouette are what survive. No personality, no age, no backstory, no camera or lighting direction.
- temperament: ENGLISH, one or two sentences, how he behaves toward her. This steers the writing only, never the picture. Warm, specific, and playable — say what he DOES, not what he is like.

Keep him tender and age-appropriate for a warm romance. Nothing explicit.`;

const READ_SYSTEM = `You are looking at a picture of a 男主 (male love interest) for a first-person 乙女游戏. Describe HIM as he appears in this image.

Return ONLY JSON in exactly this shape:
{"name": string, "descriptor": string, "temperament": string}

- name: 中文，两到三个字，好听，配得上画面里这个人。
- descriptor: ENGLISH, one phrase, appearance ONLY, describing THE PERSON IN THIS IMAGE. Write it as a NOUN PHRASE that can sit inside a sentence — start with the build or a feature, never with "A young man..." (the sentence already says that), and never end with an art note like "with beige as the dominant colour" or "dominated by a warm palette", which describes the whole picture rather than him. Good: "tall and lean, with messy dark hair, in an oversized beige cable-knit sweater". Namely — build, hair, and the garments that make his silhouette, naming ONE dominant colour. This is written verbatim into every shot prompt, so be concrete and visual. Do not describe his face in fine detail; the image itself carries the face. No personality, no backstory, no lighting or camera direction, no mention of the photograph or the art.
- temperament: ENGLISH, one or two sentences, a warm personality that suits how he looks. Say what he DOES toward her.

Describe only what is in the image. Keep it tender and age-appropriate. Nothing explicit.`;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON in reply");
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  }
}

/** One Gemini turn, straight to Google — this route is already server-side. */
async function gemini(args: {
  system: string;
  prompt: string;
  image?: string;
}): Promise<Record<string, unknown>> {
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

  const parts: GeminiPart[] = [];
  if (args.image) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(args.image);
    if (match) {
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
  }
  parts.push({ text: args.prompt });

  const response = await generateGemini({
    model,
    system: args.system,
    parts,
    timeoutMs: 30_000,
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 600,
      responseMimeType: "application/json",
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini ${response.status}: ${detail.slice(0, 300)}`);
  }
  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini returned nothing");
  return parseJson(text);
}

/** Paint his source picture. Returns a data URI. */
async function paint(prompt: string): Promise<string> {
  return toDataUri(await generateImage({ prompt, aspect: "3:4" }));
}

function dataUriToBuffer(uri: string): Buffer | null {
  const match = /^data:image\/[a-z+]+;base64,(.+)$/s.exec(uri);
  return match ? Buffer.from(match[1], "base64") : null;
}

export async function POST(request: NextRequest) {
  let body: {
    mode?: unknown;
    name?: unknown;
    idea?: unknown;
    image?: unknown;
    style?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mode = body.mode === "upload" ? "upload" : "write";
  const givenName = str(body.name, MAX_NAME_CHARS);
  // The look he is first painted in. Every other look is later edited from
  // this same picture, so this one call decides what he actually looks like.
  const asked = body.style;
  const style = isStyleKey(asked) ? asked : DEFAULT_STYLE;

  try {
    let written: Record<string, unknown>;
    let source: string;

    if (mode === "upload") {
      const image = typeof body.image === "string" ? body.image : "";
      if (!/^data:image\//.test(image) || image.length > MAX_IMAGE_CHARS) {
        return NextResponse.json(
          { error: "需要一张图片，最大约 8MB。" },
          { status: 400 }
        );
      }
      // The picture IS him; Gemini only has to put it into words, because the
      // text half of the pipeline cannot see the image.
      source = image;
      written = await gemini({
        system: READ_SYSTEM,
        prompt: "Describe the man in this image as the 男主 of the game.",
        image,
      });
    } else {
      const idea = str(body.idea, MAX_IDEA_CHARS);
      if (!idea) {
        return NextResponse.json({ error: "写点什么吧。" }, { status: 400 });
      }
      written = await gemini({
        // The idea is untrusted player text, so it is handed over as data
        // rather than pasted into the instructions.
        system: WRITE_SYSTEM,
        prompt: JSON.stringify({ player_idea: idea }),
      });
      const descriptor = str(written.descriptor, 300);
      if (!descriptor) throw new Error("no descriptor written");
      try {
        source = await paint(
          portraitPrompt({ id: "", name: "", descriptor, temperament: "" }, style)
        );
      } catch {
        return NextResponse.json(
          { error: "立绘没能画出来，请再试一次。" },
          { status: 502 }
        );
      }
    }

    const him: Character = {
      id: randomUUID().slice(0, 8),
      // A name the player typed always wins over one the model invented.
      name: givenName || str(written.name, MAX_NAME_CHARS) || "他",
      descriptor: str(written.descriptor, 300),
      temperament: str(written.temperament, 400),
      fromUpload: mode === "upload",
      hasArt: true,
    };
    if (!him.descriptor) {
      return NextResponse.json(
        { error: "没能把他写出来。再试一次。" },
        { status: 502 }
      );
    }

    const bytes = dataUriToBuffer(source);
    if (!bytes?.length) {
      return NextResponse.json({ error: "立绘读不出来，请再试一次。" }, { status: 502 });
    }
    const dir = path.join(CAST_DIR, him.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "source.jpg"), bytes);
    // Written characters already have a portrait in the selected look.
    if (mode === "write") {
      await writeFile(path.join(dir, `portrait-${style}.jpg`), bytes);
    }
    await writeFile(path.join(dir, "character.json"), JSON.stringify(him, null, 2));

    return NextResponse.json({ him, portrait: source });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown";
    console.error("[/api/cast] failed:", message);
    return NextResponse.json(
      { error: "没能把他做出来。", detail: message },
      { status: 502 }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
