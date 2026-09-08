import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { portraitPrompt, restylePrompt, type Character } from "@/lib/character";
import { generateImage } from "@/lib/imagegen";
import { DEFAULT_STYLE, isStyleKey, type StyleKey } from "@/lib/styles";

/**
 * His portrait: made once per (character, look), cached to disk, reused after.
 *
 * This one image is the game's identity anchor — it rides every single shot
 * as ref2v "Image 2". Repainting it per run would mean a subtly different boy
 * each time you press start, which is exactly the failure this genre cannot
 * survive. So it is made on the first request for a given character and look,
 * then read off disk: free, instant, byte-identical run to run.
 *
 * ONE FILE PER LOOK, because the anchor has to match the film. An anime run
 * anchored on a photoreal portrait fights itself every shot: ref2v is being
 * told to match a face rendered in a technique the rest of the prompt is
 * asking it not to use.
 *
 * EVERY look is EDITED from his one source picture, whether that picture was
 * painted from a description or uploaded. Repainting each style from the
 * descriptor instead would give three people who share a wardrobe: a sentence
 * is far too lossy to reproduce a face, and the face is the thing this whole
 * system exists to hold. Painting from the descriptor survives only as the
 * fallback for a source that has gone missing.
 *
 * GET ?id=<id>&style=<style>            -> JSON { portrait: dataURI }
 * GET ?id=<id>&style=<style>&raw=1      -> the jpeg itself, for <img src>
 * GET ?id=<id>&style=<style>&refresh=1  -> remake and overwrite
 *
 * The raw variant exists because the game needs the portrait two different
 * ways. The engine needs a data URI: it uploads the bytes to Reactor as a
 * starting frame, so a URL would mean a second round trip and a CORS
 * problem. The UI needs a URL: an <img> cannot render a JSON body, and
 * inlining a 300KB base64 string into markup to show a 46px thumbnail is
 * wasteful in a way the browser cache would otherwise have solved for free.
 */

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CAST_DIR = path.join(CACHE_DIR, "cast");
/** Where a character's cached art lives. */
function portraitFile(id: string, style: StyleKey): string {
  return path.join(CAST_DIR, id, `portrait-${style}.jpg`);
}

async function readBytes(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

async function readImage(file: string): Promise<string | null> {
  const bytes = await readBytes(file);
  return bytes ? `data:image/jpeg;base64,${bytes.toString("base64")}` : null;
}

/** The jpeg itself. Immutable per (character, style), so cached hard. */
function asImage(bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/jpeg",
      // Not "immutable": ?refresh=1 can legitimately replace it, and a
      // player who repaints his portrait should see the new one.
      "cache-control": "public, max-age=60",
    },
  });
}

/** Load a character by id. */
async function loadCharacter(id: string): Promise<Character | null> {
  try {
    const raw = await readFile(path.join(CAST_DIR, id, "character.json"), "utf8");
    const him = JSON.parse(raw) as Character;
    return him?.id && him.descriptor ? him : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const refresh = params.get("refresh") === "1";
  const asked = params.get("style");
  const style = isStyleKey(asked) ? asked : DEFAULT_STYLE;
  const id = params.get("id") || "";
  if (!id) {
    return NextResponse.json({ error: "Missing character id." }, { status: 400 });
  }

  const raw = params.get("raw") === "1";
  const file = portraitFile(id, style);
  if (!refresh) {
    const cached = await readBytes(file);
    if (cached) {
      return raw
        ? asImage(cached)
        : NextResponse.json({
            portrait: `data:image/jpeg;base64,${cached.toString("base64")}`,
            id,
            style,
            cached: true,
          });
    }
  }

  const him = await loadCharacter(id);
  if (!him) {
    return NextResponse.json({ error: `Unknown character: ${id}` }, { status: 404 });
  }

  try {
    // Edited from his source picture, always. Painting from the descriptor is
    // only the fallback for a source that has gone missing — a worse likeness,
    // but a playable run rather than a 500.
    let references: string[] = [];
    let prompt = portraitPrompt(him, style);
    const source = await readImage(path.join(CAST_DIR, id, "source.jpg"));
    if (source) {
      references = [source];
      prompt = restylePrompt(him, style);
    }

    const bytes = await generateImage({ prompt, aspect: "3:4", references });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);

    if (raw) return asImage(bytes);
    return NextResponse.json({
      portrait: `data:image/jpeg;base64,${bytes.toString("base64")}`,
      id,
      style,
      cached: false,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown";
    console.error("[/api/portrait] failed:", message);
    // Never fatal. A continuing clip can still use its previous last frame,
    // though a cold start has weaker identity continuity.
    return NextResponse.json(
      { error: "Portrait request failed.", detail: message },
      { status: 502 }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
