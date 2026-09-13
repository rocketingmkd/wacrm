/**
 * Substitute a template's `{{N}}` body placeholders with resolved
 * values, for display purposes (the message-thread optimistic bubble
 * and the persisted `messages.content_text` for a template send).
 * Leaves an unresolved placeholder as-is rather than blanking it, so a
 * missing value is visible instead of silently disappearing.
 */
export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}
