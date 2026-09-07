/**
 * Numbers that both halves of the app need to agree on.
 *
 * Split out so the writing layer does not have to import the fal client to
 * learn the prompt budget. lib/story.ts is pure logic and has to stay
 * importable from a server route and a CLI; lib/fal.ts touches the browser
 * canvas and cannot. One constant was the only thing tying them together.
 */

/**
 * The length past which h3 starts refusing prompts. MiniMax's underlying API
 * caps the prompt at roughly two thousand characters; fal does not document
 * it, so this sits below the observed edge rather than at it.
 */
export const PROMPT_WARN_CHARS = 1_900;
