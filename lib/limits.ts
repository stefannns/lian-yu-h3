/**
 * Numbers that both halves of the app need to agree on.
 *
 * Split out so the server-importable writing layer does not have to import
 * the browser-only Reactor client just to learn the prompt budget.
 */

/**
 * Reactor FastH3 accepts at most 800 prompt characters. Keep a little room
 * below the wire limit so transport-level normalization cannot tip it over.
 */
export const PROMPT_WARN_CHARS = 780;
