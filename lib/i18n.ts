export type Language = "zh" | "en";
// Browser-only preference; server rendering always starts in Chinese.
let language: Language = "zh";
export function getLanguage(): Language { return language; }
export function setLanguage(value: Language) { language = value; }
const english: Record<string, string> = {
  "今天到这里了": "Our day ends here",
  "重 新 醒 来": "Start again",
  "每一幕生成一张静帧，不调用视频服务": "Generate still images without using the video service",
  "主要场景约 10–12 秒视频，开场较短": "Main scenes use approximately 10–12 seconds of video; the opening is shorter",
  "无视频模式": "Still images",
  "视频模式 · 按幕生成": "Video · scene by scene",
  "还没睁开眼": "BEFORE YOU OPEN YOUR EYES",
  "今天，你想和他": "What would you like",
  "做点什么？": "to do with him today?",
  "随便写。一句话，一个念头，或者只是一种心情。": "A sentence, a thought, or simply a feeling.",
  "你写下的，就是这一天真正会发生的事。": "Let your words shape the day you share.",
  "先选这一天的画风": "CHOOSE YOUR VISUAL STYLE",
  "他的样子会从这里开始长出来。": "This is where his world begins to take shape.",
  "他是": "YOUR COMPANION",
  "还没有他": "SOMEONE TO MEET",
  "第一步还没完成": "FIRST THINGS FIRST",
  "做一个男主": "Create your companion",
  "先选画风": "Choose a style first",
  "换一个": "Change",
  "去选角": "Create",
  "选择画风": "Choose a style",
  "想赖床，让他多陪一会儿……": "Watch the cherry blossoms beneath Mount Fuji with my boyfriend…",
  "先做一个他，再写今天": "Create your companion, then imagine your day",
  "Enter 睁眼 · Shift+Enter 换行": "Enter to begin · Shift+Enter for a new line",
  "先选画风，再遇见他": "Choose a style, then meet him",
  "睁 眼 中": "Starting…",
  "睁 眼": "Begin",
  "图片太大了，换一张小于 8MB 的。": "Choose an image smaller than 8 MB.",
  "这张图读不出来。": "This image could not be read.",
  "立绘没能准备好，请再试一次。": "The portrait could not be prepared. Please try again.",
  "没能把他做出来。": "Your companion could not be created.",
  "选 角": "YOUR COMPANION",
  "关闭": "Close",
  "他的立绘": "Character portrait",
  "立绘加载失败，请重新创建。": "The portrait failed to load. Please create it again.",
  "就 是 他": "Choose him",
  "再做一个": "Create another",
  "写一个": "Describe him",
  "传一张": "Upload an image",
  "话很少的钢琴老师，戴细框眼镜，总穿深灰色的毛衣……": "A quiet piano teacher with fine-rimmed glasses and a dark grey sweater…",
  "选一张他的图": "Choose his image",
  "会按你选的画风重画一遍，脸不变": "Restyled with his identity as the reference",
  "换一张": "Change image",
  "请用你自己的画、你自己的照片，或者虚构角色。别传别人的照片。": "Use your own artwork, your own photo, or a fictional character. Do not upload someone else’s photo.",
  "他叫什么？（留空就让它取）": "His name (optional)",
  "正 在 做 他": "Creating…",
  "生 成 立 绘": "Generate portrait",
  "做 出 来": "Create him",
  "会参考这张图生成当前画风的立绘，保留他的样子": "Create a portrait in this style using his image as the identity reference.",
  "会为他生成一张立绘，确认后开始故事": "Generate his portrait, then confirm it to begin your story.",
  "重试这一幕": "Retry this scene",
  "这一刻，由你来回答。": "This moment is yours.",
  "想对他说什么，或者想怎么做？": "What would you like to say or do?",
  "或者，自己说点什么、做点什么……": "Or write your own response or action…",
  "就 这 样": "Continue",
  "Reactor 视频播放失败。": "Video playback failed.",
  "请横屏观看": "Rotate your device to landscape",
  "正在生成下一张画面": "Creating the next image",
  "正在生成下一段视频": "Creating the next video",
  "请稍候，完成后会自动继续": "Your story will continue when it is ready.",
  "正在整理接下来的剧情": "Writing the next part of your story",
  "完成后会自动继续；超时后可重试，不会重新生成这一幕": "Your story will continue automatically. If it times out, retry without regenerating this scene.",
  "日系动画": "Anime",
  "3D动画": "3D romance",
  "写实电影": "Live action",
  "下一幕": "Next scene",
  "他": "Him",
  "写点什么吧。": "Describe your companion first.",
  "需要一张图片，最大约 8MB。": "Choose an image up to 8 MB.",
  "没能把他写出来。再试一次。": "The character description could not be created. Please try again.",
  "审核没连上，不是你写的问题 —— 再按一次试试。": "The content check could not connect. Please try again.",
  "审核没连上，不是你写的问题 —— 再试一次。": "The content check could not connect. Please try again.",
  "这个愿望说不出口。换一个吧。": "This request cannot be used. Please try a different idea.",
  "这个说不出口。换一个吧。": "Please try a different response.",
  "开场画面暂时没生成成功。愿望还在，稍后再按一次睁眼。": "The opening image could not be generated. Your wish is saved; try Begin again shortly.",
  "开场没有拍成。愿望还在，稍后再按一次睁眼。": "The opening video could not be generated. Your wish is saved; try Begin again shortly.",
  "这一幕画面暂时没生成成功。可以重试这一幕，或换个回答。": "The image could not be generated. Retry this scene or change your response.",
  "这一幕没有拍成。可以重试这一幕，或换个回答。": "The video could not be generated. Retry this scene or change your response.",
  "画面已保留，剧情回复格式不符合要求。可重试文字，不会重生成这张画面。": "Your image is saved, but the story response had an invalid format. Retry the story without regenerating the image.",
  "Gemini 剧情服务限流或额度不足。画面已保留，请稍后重试文字；持续出现请检查 Gemini 配额。": "The story service is rate-limited or has insufficient quota. Your image is saved. Try again later; check Gemini quota if this persists.",
  "剧情请求超时，画面已保留。稍后可重试文字，不会重生成这张画面。": "The story request timed out. Your image is saved; retry the story shortly.",
  "剧情服务请求失败，画面已保留。请检查文字服务配置后重试。": "The story service failed. Your image is saved. Check the text service configuration and retry.",
  "愿望中的画面暂时没生成成功。可以重试这一幕，或从这里继续。": "The requested image could not be generated. Retry this scene or continue from here.",
  "愿望中的那一幕没有拍成。可以重试这一幕，或从这里继续。": "The requested video could not be generated. Retry this scene or continue from here.",
  "图片服务暂时繁忙或额度受限，自动重试后仍未成功。请稍等后重试。": "The image service is busy or rate-limited. Please try again later.",
  "图片服务认证或权限异常，请检查 Google Cloud 配置。": "Image service authentication failed. Check the Google Cloud configuration.",
  "图片生成超时了。请重试这一幕，不会丢失之前的选择。": "Image generation timed out. Retry this scene; your choices are saved.",
  "画面暂时没生成成功，请稍后重试。": "The image could not be generated. Please try again later."
};
export function t(text: string): string {
  return language === "en" ? english[text] ?? text : text;
}
export function storyLanguageRules(system: string): string {
  if (language !== "en") return system;
  const localized = system
    .replace(/one natural Mandarin sentence of 4-14 Chinese characters/g, "one natural English sentence of 3-10 words")
    .replace(/中文，两到三个字[^\n]*/g, "a short natural English given name, not Chinese pinyin.")
    .replace(/中文，四到十八个字/g, "English, 2-8 words")
    .replace(/中文，四到十二个字/g, "English, 2-8 words")
    .replace(/中文台词/g, "English dialogue")
    .replace(/中文/g, "English");
  return localized + `
OUTPUT LANGUAGE OVERRIDE: The selected game language is English. This overrides every Chinese/Mandarin language or character-count requirement above, even if the player writes in another language. All player-visible narration, dialogue, labels and questions must be natural English. Preserve names and explicit facts; never translate the player's intent into a different action. Keep narration to 1-2 short sentences, labels to 2-8 words, spokenLine to one sentence of 3-10 English words (null for still mode). Visual prompts, memory, JSON keys and enum values remain as specified. A free interaction MUST include a clear open question in line.`;
}
