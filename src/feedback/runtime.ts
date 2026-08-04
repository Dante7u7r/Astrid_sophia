import { getCurrentWindow } from "@tauri-apps/api/window";
import packageMetadata from "../../package.json";
import { safeInvoke, setSafeInvokeObserver } from "../simulation/tauri_mock";
import {
  FeedbackBus,
  type FeedbackConsentMode,
  type FeedbackTransport,
} from "./feedback_bus";
import {
  configureFeedbackInstrumentation,
  observeInvokeAfter,
  observeInvokeBefore,
  type InvokeObservationToken,
} from "./instrumentation";
import { IntelligenceCenter } from "./intelligence_center";

type FeedbackLog = (message: string, type?: "system" | "error") => void;

const transport: FeedbackTransport = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    return safeInvoke<T>(command, args);
  },
};

function isTauriEnvironment(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

function createSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `session-${Date.now()}`;
}

function osName(): string {
  const platform = navigator.platform || navigator.userAgent;
  return platform.slice(0, 64);
}

function describeMode(mode: FeedbackConsentMode): string {
  switch (mode) {
    case "disabled":
      return "Desactivado: no se guardan eventos.";
    case "local":
      return "Local: los eventos permanecen en este equipo.";
    case "share-on-export":
      return "Local con exportación manual: no se envía nada automáticamente.";
  }
}

function setConsentUi(
  select: HTMLSelectElement | null,
  status: HTMLElement | null,
  mode: FeedbackConsentMode,
): void {
  if (select) select.value = mode;
  if (status) status.textContent = describeMode(mode);
}

export async function initializeFeedbackRuntime(log: FeedbackLog): Promise<FeedbackBus | null> {
  const select = document.querySelector<HTMLSelectElement>("#feedback-consent-mode");
  const applyButton = document.querySelector<HTMLButtonElement>(
    "#btn-apply-feedback-consent",
  );
  const statusText = document.querySelector<HTMLElement>("#feedback-consent-status");

  if (!isTauriEnvironment()) {
    if (select) select.disabled = true;
    if (applyButton) applyButton.disabled = true;
    if (statusText) {
      statusText.textContent = "Disponible únicamente en la aplicación de escritorio.";
    }
    return null;
  }

  const startedAt = Date.now();
  const bus = new FeedbackBus({
    transport,
    sessionId: createSessionId(),
    appVersion: packageMetadata.version,
  });
  let sessionStarted = false;
  let closing = false;

  const emitSessionStarted = (): void => {
    if (sessionStarted || bus.getConsentMode() === "disabled") return;
    sessionStarted = bus.emit("session.started", {
      os: osName(),
      locale: navigator.language.slice(0, 32),
    });
  };

  try {
    const initial = await bus.initialize();
    configureFeedbackInstrumentation(bus);
    setSafeInvokeObserver({
      before: (command, args) => observeInvokeBefore(command, args),
      after: (token, result, error) => {
        observeInvokeAfter(token as InvokeObservationToken | undefined, result, error);
      },
    });
    setConsentUi(select, statusText, initial.consentMode);
    emitSessionStarted();
    new IntelligenceCenter(bus).init();
  } catch (error) {
    configureFeedbackInstrumentation(null);
    setSafeInvokeObserver(null);
    if (statusText) statusText.textContent = "El almacén local no está disponible.";
    log(`Feedback local deshabilitado: ${String(error)}`, "error");
    return null;
  }

  applyButton?.addEventListener("click", () => {
    const requested = select?.value as FeedbackConsentMode | undefined;
    if (
      requested !== "disabled"
      && requested !== "local"
      && requested !== "share-on-export"
    ) {
      return;
    }

    applyButton.disabled = true;
    void bus
      .setConsent(requested)
      .then((updated) => {
        setConsentUi(select, statusText, updated.consentMode);
        emitSessionStarted();
        log(`Persistencia de feedback: ${describeMode(updated.consentMode)}`, "system");
      })
      .catch((error) => {
        setConsentUi(select, statusText, bus.getConsentMode());
        log(`No se pudo cambiar la privacidad del feedback: ${String(error)}`, "error");
      })
      .finally(() => {
        applyButton.disabled = false;
      });
  });

  try {
    await getCurrentWindow().onCloseRequested(async (event) => {
      if (closing) return;
      event.preventDefault();
      closing = true;

      if (sessionStarted) {
        bus.emit("session.ended", {
          durationMs: Math.max(0, Date.now() - startedAt),
          cleanShutdown: true,
        });
      }
      try {
        await bus.close();
      } catch (error) {
        log(`No se pudo vaciar completamente el feedback: ${String(error)}`, "error");
      } finally {
        configureFeedbackInstrumentation(null);
        setSafeInvokeObserver(null);
        await getCurrentWindow().destroy();
      }
    });
  } catch (error) {
    log(`No se pudo instalar el cierre seguro del feedback: ${String(error)}`, "error");
  }

  return bus;
}
