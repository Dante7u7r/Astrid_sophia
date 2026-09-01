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

/**
 * Desactiva el autocompletado y guardado de historial del navegador/WebView
 * en todos los campos de texto e inputs de la aplicación, evitando que aparezcan
 * popups emergentes ("Información guardada", sugerencias de formularios web, etc.).
 */
export function installWebviewAutofillGuards(): void {
  if (typeof document === 'undefined') return;

  const sanitize = (el: Element) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('autocapitalize', 'off');
      el.setAttribute('spellcheck', 'false');
      el.setAttribute('data-lpignore', 'true');
      el.setAttribute('data-form-type', 'other');
    }
  };

  document.querySelectorAll('input, textarea').forEach(sanitize);

  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
              sanitize(node);
            }
            node.querySelectorAll?.('input, textarea').forEach(sanitize);
          }
        });
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
}

/**
 * Bloquea el menú contextual nativo del WebView/navegador en toda la aplicación,
 * evitando que aparezcan opciones web genéricas (Atrás, Actualizar, Inspeccionar).
 * Permite que los menús contextuales personalizados (Canvas, Instrumentos, Tabs)
 * gestionen su propio comportamiento. Permite el menú nativo únicamente en inputs/textareas
 * si hay texto seleccionado para copiar/cortar.
 */
export function installWebviewContextMenuGuard(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target) {
      const isInput = target.matches('input, textarea');
      const hasTextSelection = (window.getSelection()?.toString().length ?? 0) > 0;
      if (isInput && hasTextSelection) {
        return; // Permitir menú nativo de copiar/pegar en inputs con texto seleccionado
      }
    }
    // Prevenir el menú contextual web por defecto
    e.preventDefault();
  }, { capture: false });
}
