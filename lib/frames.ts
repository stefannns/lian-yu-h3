"use client";

function once<K extends keyof HTMLVideoElementEventMap>(
  video: HTMLVideoElement,
  event: K
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`video failed while waiting for "${event}"`));
    };
    const cleanup = () => {
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(event, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

export interface ExtractedFrames {
  /** Full-resolution last frame — the next shot's image_url and the game's ground truth. */
  lastFrame: string;
  /**
   * Start / middle / end frames sampled across the shot, sized for vision
   * calls: the adjudicator narrates what actually happened, not a guess
   * from a single still.
   */
  strip: string[];
  /** Small first-frame thumb for the timeline. */
  thumb: string;
  /** Small last-frame thumb — the evidence stamp on HP and item changes. */
  evidence: string;
}

/**
 * Loads a same-origin clip off-screen and captures its first, middle, and
 * last frames.
 */
export async function extractFrames(videoUrl: string): Promise<ExtractedFrames> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = videoUrl;

  try {
    await once(video, "loadedmetadata");

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas unavailable");

    const grabSmall = (width: number, quality: number) => {
      const scale = width / video.videoWidth;
      canvas.width = width;
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", quality);
    };

    const seek = async (time: number) => {
      video.currentTime = time;
      await once(video, "seeked");
    };

    await seek(0.01);
    const thumb = grabSmall(168, 0.7);
    const stripStart = grabSmall(512, 0.75);

    await seek(Math.max(0, video.duration / 2));
    const stripMid = grabSmall(512, 0.75);

    await seek(Math.max(0, video.duration - 0.05));
    const stripEnd = grabSmall(768, 0.8);
    const evidence = grabSmall(224, 0.72);
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const lastFrame = canvas.toDataURL("image/jpeg", 0.92);

    return { lastFrame, strip: [stripStart, stripMid, stripEnd], thumb, evidence };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
