/** True when focus is in a field where keyboard shortcuts must not fire. */
export function isTypingInFormField(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return el.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}
