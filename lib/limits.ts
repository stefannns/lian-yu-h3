/**
 * Numbers that both halves of the app need to agree on.
 *
 * Split out so the server-importable writing layer does not have to import
 * the browser-only Reactor client just to learn the prompt budget.
 */

/**
 * Keep generated action prompts concise. Reactor itself accepts 4000
 * characters; continuity and final safety clauses are added after this step.
 */
export const PROMPT_WARN_CHARS = 780;
export const REACTOR_PROMPT_MAX_CHARS = 4000;
