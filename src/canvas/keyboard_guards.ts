/** True when focus is in a field where keyboard shortcuts must not fire. */
export function isTypingInFormField(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return el.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

// ==========================================================================
// Protección global del WebView contra recargas y navegación accidental
// ==========================================================================
// En una aplicación Tauri, F5, Ctrl+R y Backspace pueden recargar o
// navegar el webview, destruyendo todo el estado de simulación en curso.
// Este guard bloquea esas teclas a nivel de captura (capture phase)
// para que ningún otro listener las vea primero.
// ==========================================================================

/**
 * Instala un listener `keydown` en fase de captura que bloquea:
 *   - F5                → Recarga del webview
 *   - Ctrl+R / Cmd+R    → Recarga del webview
 *   - Ctrl+Shift+I      → DevTools (solo en producción)
 *   - Backspace          → Navegación atrás (solo si no hay campo activo)
 *
 * @param isDevMode  Pass `import.meta.env.DEV` — si true, Ctrl+Shift+I NO se bloquea.
 */
export function installWebviewKeyGuards(isDevMode: boolean): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // --- F5: Recarga ---
    if (e.key === 'F5') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // --- Ctrl+R / Cmd+R: Recarga ---
    if (ctrl && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // --- Ctrl+Shift+I: DevTools (bloquear solo en producción) ---
    if (!isDevMode && ctrl && e.shiftKey && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // --- Backspace fuera de campos de texto: navegación atrás ---
    if (e.key === 'Backspace' && !isTypingInFormField()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }, { capture: true });
}
