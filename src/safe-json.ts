import type { ZodType } from 'zod';
import { getErrorMessage } from './validation.js';

export type SafeJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Parse JSON without throwing and return a contextual error message. */
export function safeJsonParse(raw: string, context = 'JSON payload'): SafeJsonResult<unknown> {
  try {
    return { ok: true, data: JSON.parse(raw) as unknown };
  } catch (err) {
    return { ok: false, error: `${context} is not valid JSON: ${getErrorMessage(err)}` };
  }
}

/** Parse JSON and validate the resulting structure with a Zod schema. */
export function safeJsonParseSchema<T>(
  raw: string,
  schema: ZodType<T>,
  context = 'JSON payload',
): SafeJsonResult<T> {
  const parsed = safeJsonParse(raw, context);
  if (!parsed.ok) return parsed;

  const validated = schema.safeParse(parsed.data);
  if (!validated.success) {
    const reason = validated.error.issues.map(i => i.message).join(', ');
    return { ok: false, error: `${context} has invalid structure: ${reason}` };
  }

  return { ok: true, data: validated.data };
}