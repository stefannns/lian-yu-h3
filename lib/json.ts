/** Repair the common ways a model can produce almost-valid JSON strings. */
function repairStringContent(source: string): string {
  let repaired = "";
  let inString = false;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (!inString) {
      repaired += character;
      if (character === '"') inString = true;
      continue;
    }

    if (character === '"') {
      repaired += character;
      inString = false;
      continue;
    }

    if (character === "\\") {
      const next = source[index + 1];
      if (next && '"\\/bfnrt'.includes(next)) {
        repaired += character + next;
        index++;
        continue;
      }
      if (next === "u" && /^[0-9a-fA-F]{4}$/.test(source.slice(index + 2, index + 6))) {
        repaired += source.slice(index, index + 6);
        index += 5;
        continue;
      }
      // Preserve an unexpected backslash as literal text so malformed
      // model output becomes valid without changing its visible content.
      repaired += "\\\\";
      continue;
    }

    const code = character.charCodeAt(0);
    if (code < 0x20) {
      if (character === "\n") repaired += "\\n";
      else if (character === "\r") repaired += "\\r";
      else if (character === "\t") repaired += "\\t";
      else repaired += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }

    repaired += character;
  }

  return repaired;
}

/** Parse a JSON object even when JSON mode wraps it or emits a bad string escape. */
export function parseJsonObjectReply(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const extracted = trimmed.slice(start, end + 1);
    if (extracted !== trimmed) candidates.push(extracted);
  }

  let lastError: unknown = new SyntaxError("no JSON object in reply");
  for (const candidate of candidates) {
    const repaired = repairStringContent(candidate);
    for (const source of repaired === candidate ? [candidate] : [candidate, repaired]) {
      try {
        const parsed = JSON.parse(source) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
        lastError = new SyntaxError("JSON reply is not an object");
      } catch (cause) {
        lastError = cause;
      }
    }
  }

  throw lastError;
}
