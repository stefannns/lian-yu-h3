// Offline regressions: no credentials, network, model calls, or cache writes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const quiet = { log() {}, warn() {}, error() {} };
function loader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    const full = path.resolve(root, file);
    if (cache.has(full)) return cache.get(full);
    const exports = {};
    cache.set(full, exports);
    const source = fs.readFileSync(full, "utf8");
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(code, {
      exports, console: quiet, Buffer, URL, AbortSignal,
      setTimeout: (callback) => { queueMicrotask(callback); return 1; },
      require(id) {
        if (Object.hasOwn(mocks, id)) return mocks[id];
        if (id.startsWith(".")) return load(path.relative(root, path.resolve(path.dirname(full), id + ".ts")));
        if (id === "react" || id === "react/jsx-runtime") return require(id);
        if (id.startsWith("node:")) return require(id);
        throw new Error("Unexpected dependency: " + id);
      },
      ...globals,
    }, { filename: full });
    return exports;
  }
  return load;
}

const him = { id: "test", name: "他", descriptor: "adult man", temperament: "kind", hasArt: true };
const choices = [
  { label: "走近他", prompt: "approach", cut: false },
  { label: "看向窗外", prompt: "look away", cut: false },
];
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

function directorHarness({ failOn = [], freeOnly = true, loadPortrait, paintOverride, tellOverride } = {}) {
  const calls = { paints: [], videos: 0, intent: 0, typed: 0, reads: [], typedInputs: [] };
  const failures = new Set(failOn);
  const load = loader({
    "./fal": {
      loadPortrait: loadPortrait || (async () => "portrait"),
      paintFrame: async (args) => {
        calls.paints.push(args);
        const number = calls.paints.length;
        if (failures.has(number)) throw new Error("simulated image failure");
        return paintOverride ? paintOverride(args, number) : "frame-" + number;
      },
      filmShot: async () => { calls.videos++; throw new Error("Unexpected video request"); },
    },
    "./frames": { extractFrames: async () => { throw new Error("Unexpected video frames"); } },
    "./story": {
      dress: (action) => action,
      imageKey: ({ frame, portrait }) => frame ? "scene + portrait: " : portrait ? "portrait: " : "",
      writeIntentShot: async () => { calls.intent++; return { label: "去海边", prompt: "seaside action", cut: true }; },
      writeTypedShot: async (args) => {
        calls.typed++;
        calls.typedInputs.push(args);
        return { label: "回应他", prompt: "typed action", cut: false };
      },
      tellNext: async (args) => {
        calls.reads.push(args);
        if (tellOverride) return tellOverride(args, calls.reads.length);
        return {
          scene: "current scene", narration: "他看着你。", line: null,
          memory: "completed scene", moved: false,
          interaction: freeOnly ? "free" : "choices", freeOnly,
          choices: freeOnly ? [] : choices, continuation: null,
        };
      },
    },
  }, {
    window: { setTimeout: () => 1, clearTimeout() {} },
    fetch: async () => ({ ok: true, json: async () => ({ allowed: true }) }),
  });
  const { Director } = load("lib/engine.ts");
  const director = new Director();
  director.setCharacter(him);
  return { director, calls, failures };
}
async function reachChoices(h) {
  await h.director.submitWish("想去海边");
  await settle();
  h.director.onClipEnded();
  await settle();
  h.director.onClipEnded();
  await settle();
  assert.equal(h.director.getSnapshot().phase, "choosing");
}

test("default still mode completes opening and wish without any video request", async () => {
  const h = directorHarness();
  assert.equal(h.director.getSnapshot().videoOff, true);
  await reachChoices(h);
  assert.equal(h.calls.videos, 0);
  assert.equal(h.director.getSnapshot().shots.length, 2);
  assert.ok(h.director.getSnapshot().shots.every(shot => shot.still));
  assert.deepEqual(Array.from(h.calls.paints[1].references), ["portrait"]);
});

test("free-only failure preserves the current frame and retries the same action once", async () => {
  const h = directorHarness({ failOn: [3] });
  await reachChoices(h);
  const previous = h.director.getSnapshot();
  await h.director.submitTyped("回应他");
  await settle();
  const failed = h.director.getSnapshot();
  assert.equal(failed.phase, "choosing");
  assert.equal(failed.canRetryScene, true);
  assert.equal(failed.choices.length, 0);
  assert.equal(failed.freezeFrame, previous.freezeFrame);
  assert.equal(failed.shots.length, previous.shots.length);
  h.director.retryScene();
  h.director.retryScene();
  await settle();
  assert.equal(h.calls.paints.length, 4);
  assert.equal(h.calls.typed, 1);
  assert.equal(h.director.getSnapshot().phase, "choosing");
  assert.equal(h.director.getSnapshot().canRetryScene, false);
  assert.equal(h.calls.paints[2].prompt, h.calls.paints[3].prompt);
  assert.deepEqual(Array.from(h.calls.paints[3].references), ["portrait"]);
  assert.equal(h.calls.videos, 0);
});

test("choice failure restores the offered choices", async () => {
  const h = directorHarness({ failOn: [3], freeOnly: false });
  await reachChoices(h);
  h.director.choose(0);
  await settle();
  assert.equal(h.director.getSnapshot().phase, "choosing");
  assert.equal(h.director.getSnapshot().choices.length, 2);
  assert.equal(h.director.getSnapshot().canRetryScene, true);
});

test("failed queued wish remains retryable with its original cut and no rewrite", async () => {
  const h = directorHarness({ failOn: [2] });
  await h.director.submitWish("想去海边");
  await settle();
  h.director.onClipEnded();
  await settle();
  assert.equal(h.director.getSnapshot().phase, "choosing");
  assert.equal(h.director.getSnapshot().canRetryScene, true);
  h.director.retryScene();
  await settle();
  assert.equal(h.calls.intent, 1);
  assert.equal(h.calls.paints[1].prompt, h.calls.paints[2].prompt);
  assert.deepEqual(Array.from(h.calls.paints[2].references), ["portrait"]);
  assert.equal(h.director.getSnapshot().phase, "choosing");
});

test("opening failure returns to intake and resubmitting can start again", async () => {
  const h = directorHarness({ failOn: [1] });
  await h.director.submitWish("想去海边");
  await settle();
  assert.equal(h.director.getSnapshot().phase, "intake");
  assert.ok(h.director.getSnapshot().notice);
  await reachChoices(h);
  assert.equal(h.calls.videos, 0);
});

test("switching a pending opening to still mode invalidates the old video work", async () => {
  let release;
  let count = 0;
  const h = directorHarness({
    loadPortrait: () => ++count === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve("portrait"),
  });
  h.director.setVideoMode(false);
  h.director.begin();
  h.director.setVideoMode(true);
  release("portrait");
  await settle();
  await reachChoices(h);
  assert.equal(h.calls.videos, 0);
  assert.equal(h.director.getSnapshot().videoOff, true);
});

test("reset discards a retry result that completes afterward", async () => {
  let release;
  const h = directorHarness({
    failOn: [3],
    paintOverride: (_, number) => number === 4 ? new Promise(resolve => { release = resolve; }) : "frame-" + number,
  });
  await reachChoices(h);
  await h.director.submitTyped("回应他");
  await settle();
  h.director.retryScene();
  h.director.reset();
  release("late-frame");
  await settle();
  assert.equal(h.director.getSnapshot().phase, "intake");
  assert.equal(h.director.getSnapshot().shots.length, 0);
  assert.equal(h.director.getSnapshot().canRetryScene, false);
  assert.equal(h.director.getSnapshot().videoOff, true);
});

function imageHarness(sequence, { adcFails = false } = {}) {
  const calls = { requests: [], delays: [] };
  const load = loader({
    "google-auth-library": {
      GoogleAuth: class {
        async getClient() {
          if (adcFails) throw new Error("mock credentials unavailable");
          return { getAccessToken: async () => ({ token: "mock-token" }) };
        }
      },
    },
  }, {
    process: { env: {
      GOOGLE_CLOUD_PROJECT: "test-project", GOOGLE_CLOUD_LOCATION: "global",
      IMAGE_PROVIDER: "vertex", GEMINI_API_KEY: "unused-fallback-key",
    } },
    setTimeout: (callback, ms) => { calls.delays.push(ms); queueMicrotask(callback); },
    fetch: async (url, options) => {
      calls.requests.push({ url, options });
      const item = sequence[Math.min(calls.requests.length - 1, sequence.length - 1)];
      if (item instanceof Error) throw item;
      const status = item.status;
      return {
        ok: status === 200, status,
        headers: { get: () => item.retryAfter || null },
        text: async () => "simulated provider failure",
        json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "aGVsbG8=" } }] } }] }),
      };
    },
  });
  return { ...load("lib/imagegen.ts"), calls };
}
const request = { prompt: "test scene", aspect: "16:9" };

test("429 and 503 retry with backoff and honor Retry-After on the same Vertex endpoint", async () => {
  const h = imageHarness([{ status: 429, retryAfter: "5" }, { status: 503 }, { status: 200 }]);
  const bytes = await h.generateImage(request);
  assert.equal(bytes.toString(), "hello");
  assert.equal(h.calls.requests.length, 3);
  assert.ok(h.calls.delays[0] >= 5000);
  assert.ok(h.calls.delays[1] >= 4000);
  assert.equal(new Set(h.calls.requests.map(r => r.url)).size, 1);
  assert.ok(h.calls.requests[0].url.startsWith("https://aiplatform.googleapis.com/"));
});

test("persistent 429 stops after four attempts and retains upstream status", async () => {
  const h = imageHarness([{ status: 429 }]);
  await assert.rejects(h.generateImage(request), error => error.status === 429);
  assert.equal(h.calls.requests.length, 4);
  assert.equal(h.calls.delays.length, 3);
  assert.match(h.imageFailureMessage(new h.ImageGenError("private detail", 429)), /额度受限/);
});

test("403 never retries and an overlong Retry-After defers to manual retry", async () => {
  for (const item of [{ status: 403 }, { status: 429, retryAfter: "120" }]) {
    const h = imageHarness([item]);
    await assert.rejects(h.generateImage(request));
    assert.equal(h.calls.requests.length, 1);
    assert.equal(h.calls.delays.length, 0);
  }
});

test("a transport failure retries only once", async () => {
  const h = imageHarness([new TypeError("mock connection failure")]);
  await assert.rejects(h.generateImage(request));
  assert.equal(h.calls.requests.length, 2);
});

test("Vertex authentication failure never falls back to an API key", async () => {
  const h = imageHarness([{ status: 200 }], { adcFails: true });
  await assert.rejects(h.generateImage(request), error => error.status === 401);
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.calls.delays.length, 0);
});

test("Gemini 3.8 story calls use low thinking and preserve JSON output budget", async () => {
  const directCalls = [];
  const direct = loader({
    "./gemini": {
      generateGemini: async args => {
        directCalls.push(args);
        return {
          ok: true,
          json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
        };
      },
    },
  }, { process: { env: {} } })("lib/server-llm.ts");
  assert.equal(await direct.callGeminiText({
    prompt: "write JSON", model: "gemini-3.8-flash", maxTokens: 800,
    temperature: 0.9, json: true,
  }), '{"ok":true}');
  assert.equal(directCalls[0].generationConfig.thinkingConfig.thinkingLevel, "LOW");
  assert.equal(directCalls[0].generationConfig.temperature, undefined);
  assert.equal(directCalls[0].generationConfig.maxOutputTokens, 800);

  const routeCalls = [];
  const routeLoad = loader({
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
    "@/lib/gemini": {
      generateGemini: async args => {
        routeCalls.push(args);
        return {
          ok: true,
          json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
        };
      },
    },
  }, { process: { env: {} } });
  const response = await routeLoad("app/api/llm/route.ts").POST({
    json: async () => ({ prompt: "write JSON", model: "gemini-3.8-flash", maxTokens: 800, temperature: 0.9, json: true }),
  });
  assert.equal(response.status, 200);
  assert.equal(routeCalls[0].generationConfig.thinkingConfig.thinkingLevel, "LOW");
  assert.equal(routeCalls[0].generationConfig.temperature, undefined);
});

test("free-only recovery renders both retry and free input without a video element", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const h = directorHarness();
  const { Stage } = loader()("components/stage.tsx");
  const html = renderToStaticMarkup(React.createElement(Stage, {
    state: { ...h.director.getSnapshot(), phase: "choosing", canRetryScene: true },
    onClipEnded() {}, onChoose() {}, onTyped() {}, onRetry() {},
  }));
  assert.match(html, /重试这一幕/);
  assert.match(html, /<input/);
  assert.doesNotMatch(html, /<video/);
});

for (const route of ["image", "cast"]) {
  test(route + " route retains 429 status without exposing provider details", async () => {
    const image = imageHarness([{ status: 429 }]);
    const load = loader({
      "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
      "node:fs/promises": {
        mkdir: async () => { throw new Error("Unexpected cache write"); },
        writeFile: async () => { throw new Error("Unexpected cache write"); },
      },
      "@/lib/imagegen": image,
      "@/lib/character": { portraitPrompt: () => "portrait" },
      "@/lib/styles": { DEFAULT_STYLE: "anime", isStyleKey: () => true },
      "@/lib/gemini": { generateGemini: async () => ({
        ok: true, json: async () => ({ candidates: [{ content: { parts: [
          { text: JSON.stringify({ name: "他", descriptor: "adult man", temperament: "kind" }) },
        ] } }] }),
      }) },
    }, { process: { cwd: () => root, env: {} } });
    const { POST } = load("app/api/" + route + "/route.ts");
    const response = await POST({ json: async () => ({
      prompt: "test scene", mode: "write", idea: "test idea", style: "anime",
    }) });
    assert.equal(response.status, 429);
    assert.equal(response.body.upstreamStatus, 429);
    assert.match(response.body.error, /额度受限/);
    assert.equal(response.body.detail, undefined);
    assert.equal(response.body.him, undefined);
    assert.doesNotMatch(JSON.stringify(response.body), /simulated provider failure/);
  });
}


test("every still is generated independently with only the portrait reference", async () => {
  const h = directorHarness({ freeOnly: false });
  await reachChoices(h);
  h.director.choose(0);
  await settle();
  for (const paint of h.calls.paints) {
    assert.deepEqual(Array.from(paint.references), ["portrait"]);
    assert.ok(!paint.references.some(reference => /^frame-/.test(reference)));
    assert.match(paint.prompt, /identity reference only/);
  }
  assert.equal(h.calls.videos, 0);
});

test("story read failure keeps the generated still and retries only the story", async () => {
  const normal = {
    scene: "cake kitchen", narration: "料理台已经摆好。", line: "想做什么味道？",
    memory: "They are making a cake.", moved: false, freeOnly: false, choices,
  };
  const h = directorHarness({
    freeOnly: false,
    tellOverride: (_, number) => number === 2 ? null : normal,
  });
  await h.director.submitWish("一起做蛋糕");
  await settle();
  h.director.onClipEnded();
  await settle();
  const failed = h.director.getSnapshot();
  assert.equal(failed.phase, "choosing");
  assert.equal(failed.canRetryScene, true);
  assert.match(failed.notice, /剧情暂时没写好/);
  const paints = h.calls.paints.length;
  h.director.retryScene();
  await settle();
  assert.equal(h.calls.paints.length, paints);
  assert.equal(h.calls.reads.length, 3);
  assert.equal(h.director.getSnapshot().phase, "choosing");
  assert.equal(h.director.getSnapshot().canRetryScene, false);
  assert.equal(h.director.getSnapshot().choices.length, 2);
});

test("accepted activity decisions and original wish reach subsequent story calls", async () => {
  const h = directorHarness({ freeOnly: false });
  await reachChoices(h);
  h.director.choose(0);
  await settle();
  const latestRead = h.calls.reads.at(-1);
  assert.equal(latestRead.wish, "想去海边");
  assert.deepEqual(Array.from(latestRead.decisions), ["走近他"]);
  await h.director.submitTyped("巧克力慕斯");
  await settle();
  assert.equal(h.calls.typedInputs.at(-1).wish, "想去海边");
  assert.deepEqual(Array.from(h.calls.typedInputs.at(-1).decisions), ["走近他"]);
});

test("cake pacing prompt asks for concrete choices and still prompts are standalone", async () => {
  const calls = [];
  const story = loader({
    "./llm": {
      llmCall: async args => {
        calls.push(args);
        if (args.prompt.includes("CAUSE OF THE CURRENT SCENE")) {
          return JSON.stringify({
            scene: "A cake workspace", narration: "他把模具放到你面前。", line: "想做哪一种？",
            memory: "They decide which cake to make.", moved: false, freeOnly: false,
            choices: [
              { label: "草莓奶油戚风", prompt: "A complete kitchen scene with strawberry ingredients.", cut: false },
              { label: "巧克力慕斯", prompt: "A complete kitchen scene with chocolate and a mousse ring.", cut: false },
            ],
          });
        }
        return JSON.stringify({
          prompt: "A complete kitchen workspace where he presents two cake-making directions.",
          label: "在厨房决定蛋糕", cut: true,
        });
      },
    },
  })("lib/story.ts");

  const intent = await story.writeIntentShot("一起做蛋糕", "anime", him, true, true);
  assert.ok(intent);
  assert.equal(intent.cut, true);
  assert.match(calls[0].system, /first useful decision/);
  assert.match(calls[0].system, /Keep undecided flavour and cake type open/);
  assert.match(calls[0].system, /INDEPENDENT STILL IMAGE/);
  assert.match(intent.prompt, /standalone scene illustration/);
  assert.doesNotMatch(intent.prompt, /Sound:/);
  assert.doesNotMatch(intent.prompt, /\[Static shot\]/);

  const beat = await story.tellNext({
    frames: ["cake-still"], memory: "Flour is on his cheek.", attempted: "一起做蛋糕",
    previousLabels: [], beat: 2, style: "anime", him, wish: "一起做蛋糕",
    scene: "They are in the kitchen.", decisions: [], still: true,
  });
  assert.deepEqual(Array.from(beat.choices, choice => choice.label), ["草莓奶油戚风", "巧克力慕斯"]);
  assert.match(calls[1].prompt, /ORIGINAL PLAYER WISH: 一起做蛋糕/);
  assert.match(calls[1].system, /must either resolve one meaningful decision or visibly advance/);
  assert.match(calls[1].system, /do not replace a cake decision/);
  assert.doesNotMatch(calls[1].system, /CLOSES THE DISTANCE/);
  assert.ok(beat.choices.every(choice => choice.prompt.includes("standalone scene illustration")));
});

test("mid-story answer uses the ongoing-story system and player_answer field", async () => {
  const calls = [];
  const story = loader({
    "./llm": {
      llmCall: async args => {
        calls.push(args);
        return JSON.stringify({ prompt: "He starts folding chocolate into the mousse.", label: "开始做巧克力慕斯", cut: false });
      },
    },
  })("lib/story.ts");
  await story.writeTypedShot({
    text: "巧克力慕斯", memory: "They are choosing a cake.", scene: "cake kitchen",
    style: "anime", him, wish: "一起做蛋糕", decisions: [], still: true,
  });
  assert.match(calls[0].system, /ongoing activity, not an opening/);
  assert.doesNotMatch(calls[0].system, /SECOND shot of the morning/);
  const body = JSON.parse(calls[0].prompt);
  assert.equal(body.player_answer, "巧克力慕斯");
  assert.equal(body.player_wish, undefined);
});

test("player-facing text never exposes prompt rules", async () => {
  let call = 0;
  const story = loader({
    "./llm": {
      llmCall: async () => {
        call++;
        if (call === 1) {
          return JSON.stringify({
            scene: "A cake kitchen", narration: "你们已经来到厨房。",
            line: "想做仅与我们今天相关的蛋糕？", memory: "They are choosing a cake.",
            moved: true, freeOnly: false, choices: [
              { label: "草莓奶油戚风", prompt: "A strawberry cake workspace.", cut: false },
              { label: "巧克力慕斯", prompt: "A chocolate mousse workspace.", cut: false },
            ],
          });
        }
        return JSON.stringify({
          scene: "A cake kitchen", narration: "你们已经来到厨房。", line: "想做什么口味？",
          memory: "They are choosing a cake.", moved: true, freeOnly: false, choices: [
            { label: "草莓奶油戚风", prompt: "A strawberry cake workspace.", cut: false },
            { label: "巧克力慕斯", prompt: "A chocolate mousse workspace.", cut: false },
          ],
        });
      },
    },
  })("lib/story.ts");
  const beat = await story.tellNext({
    frames: ["cake-still"], memory: "", attempted: "一起做蛋糕", previousLabels: [],
    beat: 1, style: "anime", him, wish: "一起做蛋糕", still: true,
  });
  assert.equal(call, 1);
  assert.equal(beat.line, null);
  assert.match(beat.narration, /来到厨房/);
});

test("the first generated-scene title preserves the player's own wish", async () => {
  let releaseIntent;
  const h = directorHarness({
    paintOverride: async args => {
      if (args.prompt.includes("seaside action")) {
        await new Promise(resolve => { releaseIntent = resolve; });
      }
      return { image: `frame-${h.calls.paints.length}`, model: "test" };
    },
  });
  const submitted = h.director.submitWish("一起做蛋糕");
  await submitted;
  await settle();
  h.director.onClipEnded();
  await settle();
  assert.equal(h.director.getSnapshot().workingLabel, "一起做蛋糕");
  assert.equal(typeof releaseIntent, "function");
  releaseIntent();
  await settle();
});

test("storyteller can auto-advance an unimportant beat without offering cards", async () => {
  const calls = [];
  const story = loader({
    "./llm": {
      llmCall: async args => {
        calls.push(args);
        return JSON.stringify({
          scene: "The cake batter is ready beside the oven.",
          narration: "面糊已经拌匀，他把模具稳稳托在手中。",
          line: "现在要不要把它送进烤箱？",
          memory: "They chose chocolate chiffon and finished mixing the batter.",
          moved: false,
          interaction: "auto",
          choices: [],
          continuation: {
            label: "送蛋糕进烤箱",
            prompt: "A complete kitchen scene as he slides the filled cake tin into the warm oven.",
            cut: false,
          },
        });
      },
    },
  })("lib/story.ts");
  const beat = await story.tellNext({
    frames: ["cake-still"], memory: "", attempted: "拌好面糊", previousLabels: [],
    beat: 3, style: "anime", him, wish: "一起做蛋糕", still: true, automaticBeats: 1,
  });
  assert.equal(beat.interaction, "auto");
  assert.equal(beat.freeOnly, false);
  assert.equal(beat.choices.length, 0);
  assert.equal(beat.continuation.label, "送蛋糕进烤箱");
  assert.equal(beat.line, null);
  assert.match(calls[0].system, /Never manufacture a choice/);
  assert.match(calls[0].system, /which bowl to pick up/);
  assert.match(calls[0].prompt, /STORY-LED BEATS SINCE HER LAST INPUT: 1/);
  assert.equal(calls[0].model, "gemini-3.8-flash");
});

test("storyteller can reserve a personal question for free input", async () => {
  const story = loader({
    "./llm": {
      llmCall: async () => JSON.stringify({
        scene: "The finished cake waits for its inscription.",
        narration: "奶油已经抹平，他把裱花笔递到你面前。",
        line: "最后想在上面写什么？",
        memory: "The cake is finished except for the personal inscription.",
        moved: false,
        interaction: "free",
        choices: [],
        continuation: null,
      }),
    },
  })("lib/story.ts");
  const beat = await story.tellNext({
    frames: ["cake-still"], memory: "", attempted: "装饰蛋糕", previousLabels: [],
    beat: 5, style: "anime", him, wish: "一起做蛋糕", still: true,
  });
  assert.equal(beat.interaction, "free");
  assert.equal(beat.freeOnly, true);
  assert.equal(beat.choices.length, 0);
  assert.equal(beat.continuation, null);
  assert.equal(beat.line, "最后想在上面写什么？");
});

test("director executes story-led continuation and stops at the next free question", async () => {
  const freeBeat = {
    scene: "finished cake", narration: "蛋糕已经做好。", line: "想在上面写什么？",
    memory: "The cake is ready for an inscription.", moved: false,
    interaction: "free", freeOnly: true, choices: [], continuation: null,
  };
  const autoBeat = {
    scene: "cake batter", narration: "他把拌好的面糊倒进模具。", line: null,
    memory: "The batter is ready to bake.", moved: false,
    interaction: "auto", freeOnly: false, choices: [],
    continuation: { label: "烤好蛋糕", prompt: "finished cake after baking", cut: true },
  };
  const h = directorHarness({
    freeOnly: true,
    tellOverride: (_, number) => number === 2 ? autoBeat : freeBeat,
  });
  await h.director.submitWish("一起做蛋糕");
  await settle();
  h.director.onClipEnded();
  await settle();
  const state = h.director.getSnapshot();
  assert.deepEqual(Array.from(state.shots, shot => shot.kind), ["opening", "intent", "auto"]);
  assert.equal(state.phase, "choosing");
  assert.equal(state.choices.length, 0);
  assert.equal(state.line, "想在上面写什么？");
  assert.equal(h.calls.paints.length, 3);
  assert.match(h.calls.paints[2].prompt, /finished cake after baking/);
  assert.equal(h.calls.reads.at(-1).automaticBeats, 1);
});

test("filming state visibly explains that the next still is generating", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const h = directorHarness();
  const { Stage } = loader()("components/stage.tsx");
  const html = renderToStaticMarkup(React.createElement(Stage, {
    state: { ...h.director.getSnapshot(), phase: "filming", currentShot: {
      beat: 1, action: null, kind: "opening", prompt: "opening", still: true,
      videoUrl: "", rawUrl: "", thumb: "frame",
    }, freezeFrame: "frame", workingLabel: "选择蛋糕口味" },
    onClipEnded() {}, onChoose() {}, onTyped() {}, onRetry() {},
  }));
  assert.match(html, /正在生成下一张画面/);
  assert.match(html, /选择蛋糕口味/);
  assert.match(html, /完成后会自动继续/);
});
