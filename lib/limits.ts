/**
 * Numbers that both halves of the app need to agree on.
 *
 * Split out so the server-importable writing layer does not have to import
 * the browser-only Reactor client just to learn the prompt budget.
 */

/**
 * Budget for the fully dressed scene body. imageKey() adds a short source
 * continuity clause later, so this remains below Reactor's 4000-character
 * hard limit while preserving the complete scene action.
 */
export const PROMPT_WARN_CHARS = 2800;
export const REACTOR_PROMPT_MAX_CHARS = 4000;
