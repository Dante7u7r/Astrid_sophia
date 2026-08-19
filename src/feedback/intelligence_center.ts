import {
  FEEDBACK_SCHEMA_VERSION,
  type FeedbackEventKind,
  type FeedbackEventV1,
} from "./contracts.generated";
import {
  type FeedbackBus,
  type FeedbackConsentMode,
  type FeedbackStoreStatus,
} from "./feedback_bus";
import { privacyFingerprint } from "./instrumentation";
import type { AdvisorRecommendation } from "../intelligence/advisor";
import {
  applyRecommendation,
  getCurrentRecommendations,
  rejectRecommendation,
  setRuleDisabled,
  undoRecommendation,
} from "../intelligence/advisor_runtime";
import {
  createShadowRegistryArtifact,
  evaluateShadowPromotion,
  registerShadowArtifact,
  rollbackShadowRegistry,
  type ShadowModelRegistry,
} from "../intelligence/shadow_learning";

interface SupportBundleManifest {
  readonly format: "astryd-feedback-support";
  readonly formatVersion: 2;
  readonly eventSchemaVersion: number;
  readonly exportedAtUnixMs: number;
  readonly eventCount: number;
  readonly truncated: boolean;
  readonly contentSha256: string;
  readonly schemaValidation: "validated-on-ingest";
  readonly redactions: Readonly<Record<string, number>>;
}

export interface RedactedSupportBundle {
  readonly manifest: SupportBundleManifest;
  readonly summaryMarkdown: string;
  readonly events: readonly FeedbackEventV1[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function percentile(values: readonly number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? null;
}

function payloadRecord(event: FeedbackEventV1): Record<string, unknown> {
  return event.payload as unknown as Record<string, unknown>;
}

function eventAnalysis(event: FeedbackEventV1): string {
  const analysis = payloadRecord(event).analysis;
  return typeof analysis === "string" ? analysis : "—";
}

function eventState(event: FeedbackEventV1): string {
  if (event.kind === "simulation.completed") return event.payload.converged ? "Completado" : "Sin converger";
  if (event.kind === "simulation.failed") return event.payload.errorCode;
  if (event.kind === "simulation.cancelled") return `Cancelado: ${event.payload.reason}`;
  if (event.kind === "erc.completed") return event.payload.passed ? "Correcto" : "Falló";
  return event.privacyClass;
}

function consentLabel(mode: FeedbackConsentMode): string {
  switch (mode) {
    case "disabled": return "Desactivado: no se capturan datos nuevos";
    case "local": return "Local: los datos permanecen en este equipo";
    case "share-on-export": return "Local: sólo se comparten mediante exportación manual";
  }
}

function createDiagnosticSummary(events: readonly FeedbackEventV1[], exportedAtUnixMs: number): string {
  const completed = events.filter((event) => event.kind === "simulation.completed");
  const failed = events.filter((event) => event.kind === "simulation.failed");
  const cancelled = events.filter((event) => event.kind === "simulation.cancelled");
  const durations = completed.map((event) => event.payload.durationMs);
  const durationP95 = percentile(durations, 0.95);
  const byVersion = new Map<string, { completed: number; failed: number; durations: number[] }>();
  const failureCodes = new Map<string, number>();
  for (const event of events) {
    const version = byVersion.get(event.appVersion) ?? { completed: 0, failed: 0, durations: [] };
    if (event.kind === "simulation.completed") {
      version.completed += 1;
      version.durations.push(event.payload.durationMs);
    } else if (event.kind === "simulation.failed") {
      version.failed += 1;
      failureCodes.set(event.payload.errorCode, (failureCodes.get(event.payload.errorCode) ?? 0) + 1);
    }
    byVersion.set(event.appVersion, version);
  }
  const versionRows = [...byVersion.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([version, stats]) => {
      const total = stats.completed + stats.failed;
      const success = total === 0 ? "—" : `${((stats.completed / total) * 100).toFixed(1)}%`;
      const p95 = percentile(stats.durations, 0.95);
      return `| ${version} | ${stats.completed} | ${stats.failed} | ${success} | ${p95 === null ? "—" : p95.toFixed(1)} |`;
    });
  const failureRows = [...failureCodes.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([code, count]) => `- \`${code}\`: ${count}`);
  return [
    "# Diagnóstico de Astryd Sophia",
    "",
    `Exportado: ${new Date(exportedAtUnixMs).toISOString()}`,
    "",
    "> Este resumen procede de telemetría local redactada. No contiene netlists, firmware, rutas ni identificadores originales.",
    "",
    "## Resultado general",
    "",
    `- Eventos: ${events.length}`,
    `- Simulaciones completadas: ${completed.length}`,
    `- Simulaciones fallidas: ${failed.length}`,
    `- Simulaciones canceladas: ${cancelled.length}`,
    `- Duración p95 completada: ${durationP95 === null ? "—" : `${durationP95.toFixed(1)} ms`}`,
    "",
    "## Comparación por versión",
    "",
    "| Versión | Completadas | Fallidas | Éxito | p95 ms |",
    "|---|---:|---:|---:|---:|",
    ...(versionRows.length > 0 ? versionRows : ["| — | 0 | 0 | — | — |"]),
    "",
    "## Fallos observados",
    "",
    ...(failureRows.length > 0 ? failureRows : ["No se observaron fallos en el conjunto exportado."]),
    "",
    "## Límites de interpretación",
    "",
    "Este paquete permite diagnosticar comportamiento operativo; no demuestra por sí solo exactitud científica ni causalidad.",
    "",
  ].join("\n");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function aliasFactory(prefix: string): (value: string | undefined) => string | undefined {
  const aliases = new Map<string, string>();
  return (value) => {
    if (!value) return undefined;
    let alias = aliases.get(value);
    if (!alias) {
      alias = `${prefix}-${String(aliases.size + 1).padStart(4, "0")}`;
      aliases.set(value, alias);
    }
    return alias;
  };
}

export async function createRedactedSupportBundle(
  sourceEvents: readonly FeedbackEventV1[],
  truncated: boolean,
  exportedAtUnixMs = Date.now(),
): Promise<RedactedSupportBundle> {
  const eventAlias = aliasFactory("event");
  const sessionAlias = aliasFactory("session");
  const runAlias = aliasFactory("run");
  const workspaceAlias = aliasFactory("workspace");
  const recommendationAlias = aliasFactory("recommendation");
  const fingerprintAlias = aliasFactory("fingerprint");
  let fingerprintRedactions = 0;
  const redactPayload = (payload: unknown): unknown => {
    if (Array.isArray(payload)) return payload.map(redactPayload);
    if (typeof payload !== "object" || payload === null) return payload;
    return Object.fromEntries(Object.entries(payload as Record<string, unknown>).map(([key, value]) => {
      if (key === "subjectEventId" && typeof value === "string") return [key, eventAlias(value)];
      if (key === "previousSessionId" && typeof value === "string") return [key, sessionAlias(value)];
      if (key === "recommendationId" && typeof value === "string") return [key, recommendationAlias(value)];
      if (key.endsWith("Fingerprint") && typeof value === "string") {
        fingerprintRedactions += 1;
        return [key, fingerprintAlias(value)];
      }
      return [key, redactPayload(value)];
    }));
  };
  const events = sourceEvents.map((event) => {
    const clone = structuredClone(event) as FeedbackEventV1;
    return {
      ...clone,
      eventId: eventAlias(event.eventId)!,
      sessionId: sessionAlias(event.sessionId)!,
      ...(event.runId ? { runId: runAlias(event.runId) } : {}),
      ...(event.workspaceId ? { workspaceId: workspaceAlias(event.workspaceId) } : {}),
      payload: redactPayload(clone.payload),
    } as FeedbackEventV1;
  });
  const summaryMarkdown = createDiagnosticSummary(events, exportedAtUnixMs);
  const serializedContent = JSON.stringify({ events, summaryMarkdown });
  return {
    manifest: {
      format: "astryd-feedback-support",
      formatVersion: 2,
      eventSchemaVersion: FEEDBACK_SCHEMA_VERSION,
      exportedAtUnixMs,
      eventCount: events.length,
      truncated,
      contentSha256: await sha256Hex(serializedContent),
      schemaValidation: "validated-on-ingest",
      redactions: {
        eventIds: new Set(sourceEvents.map((event) => event.eventId)).size,
        sessionIds: new Set(sourceEvents.map((event) => event.sessionId)).size,
        runIds: new Set(sourceEvents.flatMap((event) => event.runId ? [event.runId] : [])).size,
        workspaceIds: new Set(sourceEvents.flatMap((event) => event.workspaceId ? [event.workspaceId] : [])).size,
        fingerprints: fingerprintRedactions,
      },
    },
    summaryMarkdown,
    events,
  };
}

export class IntelligenceCenter {
  private events: readonly FeedbackEventV1[] = [];
  private selectedEvent: FeedbackEventV1 | null = null;
  private initialized = false;

  constructor(
    private readonly bus: FeedbackBus,
    private readonly documentRef: Document = document,
  ) {}

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.ensureDom();
    this.element<HTMLButtonElement>("intelligence-refresh-btn")?.addEventListener("click", () => {
      void this.refresh();
    });
    this.element<HTMLSelectElement>("intelligence-kind-filter")?.addEventListener("change", () => {
      void this.refresh();
    });
    this.element<HTMLFormElement>("intelligence-feedback-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitHumanFeedback();
    });
    this.element<HTMLButtonElement>("intelligence-export-btn")?.addEventListener("click", () => {
      void this.exportBundle();
    });
    this.element<HTMLButtonElement>("intelligence-delete-expired")?.addEventListener("click", () => {
      void this.deleteExpired();
    });
    const confirmation = this.element<HTMLInputElement>("intelligence-delete-confirm");
    const deleteAll = this.element<HTMLButtonElement>("intelligence-delete-all");
    confirmation?.addEventListener("input", () => {
      if (deleteAll) deleteAll.disabled = confirmation.value !== "ELIMINAR";
    });
    deleteAll?.addEventListener("click", () => void this.deleteAll());
    this.element<HTMLButtonElement>("intelligence-shadow-evaluate")?.addEventListener("click", () => {
      void this.evaluateShadowModel();
    });
    this.element<HTMLButtonElement>("intelligence-shadow-disable")?.addEventListener("click", () => {
      localStorage.removeItem("astryd.shadowModel.v1");
      this.setText("intelligence-shadow-status", "Modelo local desactivado y eliminado. El asesor determinista sigue activo.");
      this.announce("Modelo de sombra desactivado.");
    });
    this.element<HTMLButtonElement>("intelligence-shadow-rollback")?.addEventListener("click", () => {
      const registry = this.readShadowRegistry();
      if (!registry) {
        this.announce("No existe un registro de modelos para restaurar.");
        return;
      }
      const rolledBack = rollbackShadowRegistry(registry);
      localStorage.setItem("astryd.shadowModel.v1", JSON.stringify(rolledBack));
      this.setText(
        "intelligence-shadow-status",
        rolledBack.activeArtifactId
          ? `Modelo anterior restaurado: ${rolledBack.activeArtifactId}. Continúa en modo sombra.`
          : "No existe un modelo anterior; el registro quedó sin modelo activo.",
      );
      this.announce("Rollback del registro de modelos completado.");
    });
    window.addEventListener("astryd-recommendations", (event) => {
      const recommendations = (event as CustomEvent<readonly AdvisorRecommendation[]>).detail;
      this.renderRecommendations(recommendations);
    });
    this.renderRecommendations(getCurrentRecommendations());
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const refreshButton = this.element<HTMLButtonElement>("intelligence-refresh-btn");
    if (refreshButton) refreshButton.disabled = true;
    try {
      const status = await this.bus.getStatus();
      const selectedKind = this.element<HTMLSelectElement>("intelligence-kind-filter")?.value;
      const query = selectedKind
        ? { kind: selectedKind as FeedbackEventKind, limit: 500 }
        : { limit: 500 };
      const page = await this.bus.query(query);
      this.events = page.events;
      this.render(status, page.hasMore);
      this.announce(`Centro actualizado: ${status.eventCount} eventos locales.`);
    } catch (error) {
      this.announce(`No se pudo leer el centro local: ${String(error)}`);
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  private render(status: FeedbackStoreStatus, hasMore: boolean): void {
    this.setText("intelligence-consent-summary", consentLabel(status.consentMode));
    this.setText("intelligence-event-count", String(status.eventCount));
    this.setText("intelligence-byte-count", formatBytes(status.logicalBytes));
    const completed = this.events.filter((event) => event.kind === "simulation.completed");
    const failed = this.events.filter((event) => event.kind === "simulation.failed");
    const terminalCount = completed.length + failed.length;
    this.setText(
      "intelligence-success-rate",
      terminalCount > 0 ? `${((completed.length / terminalCount) * 100).toFixed(1)}%` : "—",
    );
    const durations = completed.map((event) => event.payload.durationMs);
    const p95 = percentile(durations, 0.95);
    this.setText("intelligence-p95", p95 === null ? "—" : `${p95.toFixed(1)} ms`);
    this.renderHistory(hasMore);
    this.renderVersionComparison();
  }

  private renderHistory(hasMore: boolean): void {
    const body = this.element<HTMLTableSectionElement>("intelligence-history-body");
    if (!body) return;
    body.replaceChildren();
    for (const event of this.events) {
      const row = this.documentRef.createElement("tr");
      row.tabIndex = 0;
      row.setAttribute("aria-label", `${event.kind}, ${eventState(event)}`);
      for (const value of [
        new Date(event.occurredAtUnixMs).toLocaleString(),
        event.kind,
        eventAnalysis(event),
        eventState(event),
      ]) {
        const cell = this.documentRef.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      }
      const select = (): void => this.selectEvent(event);
      row.addEventListener("click", select);
      row.addEventListener("keydown", (keyboardEvent) => {
        if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
          keyboardEvent.preventDefault();
          select();
        }
      });
      body.appendChild(row);
    }
    const empty = this.element<HTMLElement>("intelligence-empty-state");
    if (empty) {
      empty.hidden = this.events.length > 0;
      empty.textContent = hasMore
        ? "Se muestran los 500 eventos más recientes. Aplica un filtro para reducir el conjunto."
        : "No hay datos locales para este filtro.";
    }
  }

  private selectEvent(event: FeedbackEventV1): void {
    this.selectedEvent = event;
    this.setText("intelligence-privacy-viewer", JSON.stringify(event, null, 2));
    this.announce(`Evento seleccionado: ${event.kind}.`);
  }

  private renderVersionComparison(): void {
    const versions = new Map<string, { completed: number; failed: number; durations: number[] }>();
    for (const event of this.events) {
      const summary = versions.get(event.appVersion) ?? { completed: 0, failed: 0, durations: [] };
      if (event.kind === "simulation.completed") {
        summary.completed += 1;
        summary.durations.push(event.payload.durationMs);
      } else if (event.kind === "simulation.failed") {
        summary.failed += 1;
      }
      versions.set(event.appVersion, summary);
    }
    const lines = [...versions.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([version, summary]) => {
        const total = summary.completed + summary.failed;
        const success = total > 0 ? `${((summary.completed / total) * 100).toFixed(1)}%` : "—";
        const p95 = percentile(summary.durations, 0.95);
        return `${version}: éxito ${success}; p95 ${p95 === null ? "—" : `${p95.toFixed(1)} ms`}; n=${total}`;
      });
    this.setText(
      "intelligence-version-comparison",
      lines.length >= 2 ? lines.join("\n") : "Aún no hay dos versiones comparables.",
    );
  }

  private renderRecommendations(recommendations: readonly AdvisorRecommendation[]): void {
    const container = this.element<HTMLElement>("intelligence-recommendations-list");
    if (!container) return;
    container.replaceChildren();
    if (recommendations.length === 0) {
      const emptyDiv = this.documentRef.createElement("div");
      emptyDiv.id = "intelligence-empty-state";
      emptyDiv.style.cssText = "font-size: 0.72rem; color: var(--text-muted); text-align: center; padding: 30px; background: rgba(0,0,0,0.25); border-radius: 6px; border: 1px dashed rgba(255,255,255,0.08);";
      emptyDiv.textContent = "✓ Sin advertencias ni conflictos detectados en el circuito actual.";
      container.appendChild(emptyDiv);
      return;
    }

    for (const recommendation of recommendations) {
      const card = this.documentRef.createElement("article");
      const safety = recommendation.safetyClass;
      const safetyClass =
        safety === "scientific-review-required" ? "critical" :
        safety === "reversible" ? "reversible" : "informational";
      card.className = `intel-card ${safetyClass} intelligence-recommendation`;

      // Encabezado de la tarjeta: Badge de Severidad y Medidor de Confianza
      const header = this.documentRef.createElement("div");
      header.style.cssText = "display: flex; justify-content: space-between; align-items: center; gap: 6px;";

      const badge = this.documentRef.createElement("span");
      badge.style.cssText = `font-size: 0.58rem; font-weight: 700; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; font-family: var(--font-mono); ${
        safety === "scientific-review-required" ? "background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);" :
        safety === "reversible" ? "background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4);" :
        "background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4);"
      }`;
      badge.textContent =
        safety === "scientific-review-required" ? "🛑 Revisión Requerida" :
        safety === "reversible" ? "⚡ Ajuste Automático" : "ℹ️ Información";

      const confidenceSpan = this.documentRef.createElement("span");
      confidenceSpan.style.cssText = "font-size: 0.62rem; color: var(--text-muted); font-family: var(--font-mono);";
      confidenceSpan.textContent = `Confianza: ${(recommendation.confidence * 100).toFixed(0)}%`;

      header.append(badge, confidenceSpan);

      // Título
      const title = this.documentRef.createElement("h5");
      title.style.cssText = "margin: 0; font-size: 0.78rem; font-weight: 700; color: #fff;";
      title.textContent = recommendation.title;

      // Explicación teórica
      const explanation = this.documentRef.createElement("p");
      explanation.style.cssText = "margin: 0; font-size: 0.7rem; color: rgba(226, 232, 240, 0.85); line-height: 1.4;";
      explanation.textContent = recommendation.explanation;

      // Evidencia física / topológica
      const evidence = this.documentRef.createElement("div");
      evidence.className = "intelligence-evidence";
      evidence.style.cssText = "background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255,255,255,0.06); padding: 4px 8px; border-radius: 4px; font-size: 0.62rem; color: #38bdf8; font-family: var(--font-mono);";
      evidence.textContent = `🔍 Evidencia: ${recommendation.evidence}`;

      // Barra de acciones
      const actions = this.documentRef.createElement("div");
      actions.className = "intelligence-actions";
      actions.style.cssText = "display: flex; gap: 6px; align-items: center; margin-top: 2px;";

      if (recommendation.safetyClass === "reversible" && recommendation.settingsPatch) {
        const apply = this.documentRef.createElement("button");
        apply.type = "button";
        apply.className = "intel-btn active";
        apply.style.cssText = "font-size: 0.65rem; padding: 3px 8px;";
        apply.textContent = "⚡ Aplicar ajuste";
        let isApplied = false;
        apply.addEventListener("click", () => {
          const changed = isApplied
            ? undoRecommendation(recommendation.recommendationId)
            : applyRecommendation(recommendation.recommendationId);
          if (!changed) {
            this.announce("No se pudo aplicar o revertir la recomendación.");
            return;
          }
          isApplied = !isApplied;
          apply.textContent = isApplied ? "↩ Deshacer ajuste" : "⚡ Aplicar ajuste";
          apply.classList.toggle("active", !isApplied);
          this.announce(isApplied ? "Ajuste aplicado; puedes deshacerlo." : "Ajuste revertido.");
        });
        actions.appendChild(apply);
      }

      const reject = this.documentRef.createElement("button");
      reject.type = "button";
      reject.className = "intel-btn";
      reject.style.cssText = "font-size: 0.65rem; padding: 3px 8px;";
      reject.textContent = "✕ Descartar";
      reject.addEventListener("click", () => {
        rejectRecommendation(recommendation.recommendationId);
        card.remove();
        this.announce("Recomendación descartada.");
      });
      actions.appendChild(reject);

      const disable = this.documentRef.createElement("button");
      disable.type = "button";
      disable.className = "intel-btn";
      disable.style.cssText = "font-size: 0.65rem; padding: 3px 8px;";
      disable.textContent = "🔇 Silenciar regla";
      disable.addEventListener("click", () => {
        setRuleDisabled(recommendation.ruleId, true);
        this.announce(`Regla ${recommendation.ruleId} desactivada localmente.`);
      });
      actions.appendChild(disable);

      card.append(header, title, explanation, evidence, actions);
      container.appendChild(card);
    }
  }

  private async submitHumanFeedback(): Promise<void> {
    const form = this.element<HTMLFormElement>("intelligence-feedback-form");
    const confirmation = this.element<HTMLInputElement>("intelligence-content-confirm");
    if (!form?.reportValidity() || !confirmation?.checked) return;
    const rating = this.documentRef.querySelector<HTMLInputElement>('input[name="feedback-rating"]:checked')?.value;
    if (rating !== "correct" && rating !== "uncertain" && rating !== "incorrect") return;
    const category = this.element<HTMLSelectElement>("intelligence-feedback-category")?.value;
    if (
      category !== "convergence"
      && category !== "performance"
      && category !== "interface"
      && category !== "model"
      && category !== "other"
    ) return;
    const expectedRaw = this.element<HTMLInputElement>("intelligence-expected-value")?.value.trim();
    const expectedValue = expectedRaw ? Number(expectedRaw) : undefined;
    if (expectedValue !== undefined && !Number.isFinite(expectedValue)) return;
    const expectedUnit = this.element<HTMLInputElement>("intelligence-expected-unit")?.value.trim();
    const note = this.element<HTMLTextAreaElement>("intelligence-feedback-note")?.value.trim();
    const accepted = this.bus.emit("user.feedback_submitted", {
      ...(this.selectedEvent ? { subjectEventId: this.selectedEvent.eventId } : {}),
      rating,
      category,
      ...(expectedValue === undefined ? {} : { expectedValue }),
      ...(expectedUnit ? { expectedUnit } : {}),
      ...(note ? { note, noteFingerprint: privacyFingerprint(note) } : {}),
      attachmentIncluded: false,
    }, { userContentConfirmed: true });
    if (!accepted) {
      this.announce("No se guardó el feedback: activa la persistencia local primero.");
      return;
    }
    await this.bus.flush();
    form.reset();
    this.announce("Feedback humano guardado localmente.");
    await this.refresh();
  }

  private async exportBundle(): Promise<void> {
    const button = this.element<HTMLButtonElement>("intelligence-export-btn");
    if (button) button.disabled = true;
    this.announce("Preparando paquete redactado…");
    try {
      const page = await this.bus.export({ limit: 10_000 });
      const bundle = await createRedactedSupportBundle(page.events, page.hasMore);
      const content = JSON.stringify(bundle, null, 2);
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const link = this.documentRef.createElement("a");
      link.href = url;
      link.download = `astryd-feedback-${bundle.manifest.contentSha256.slice(0, 12)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      this.bus.emit("export.created", {
        exportKind: "support-bundle",
        itemCount: bundle.events.length,
        redactionCount: Object.values(bundle.manifest.redactions).reduce((sum, value) => sum + value, 0),
      });
      await this.bus.flush();
      this.announce(`Paquete redactado creado con ${bundle.events.length} eventos.`);
    } catch (error) {
      this.announce(`No se pudo exportar el paquete: ${String(error)}`);
    } finally {
      if (button) button.disabled = false;
    }
  }

  private async deleteExpired(): Promise<void> {
    const receipt = await this.bus.delete({ scope: "expired" });
    this.bus.emit("data.deleted", { scope: "expired", ...receipt });
    await this.bus.flush();
    this.announce(`Se borraron ${receipt.rowsDeleted} eventos vencidos.`);
    await this.refresh();
  }

  private async evaluateShadowModel(): Promise<void> {
    const button = this.element<HTMLButtonElement>("intelligence-shadow-evaluate");
    if (button) button.disabled = true;
    try {
      const page = await this.bus.export({ limit: 10_000 });
      if (page.hasMore) {
        this.setText("intelligence-shadow-status", "Dataset truncado a 10 000 eventos; no se entrenó para evitar una muestra incompleta.");
        return;
      }
      const result = await createShadowRegistryArtifact(page.events);
      if (result.status === "blocked") {
        this.setText(
          "intelligence-shadow-status",
          `${result.reason} Progreso: ${result.usefulExecutionCount}/${result.requiredExecutionCount}; sesiones: ${result.sessionCount}.`,
        );
        return;
      }
      if (result.status !== "artifact") return;
      const registry = registerShadowArtifact(this.readShadowRegistry(), result.artifact);
      localStorage.setItem("astryd.shadowModel.v1", JSON.stringify(registry));
      const model = result.artifact.model;
      const promotion = evaluateShadowPromotion(model, {
        scientificValidationPassed: false,
        artifactSignatureVerified: false,
        prospectiveFieldPilotCompleted: false,
      });
      this.setText(
        "intelligence-shadow-status",
        `Modelo sombra v${model.version}: ${model.trainingExamples} ejemplos en ${model.trainingSessionCount} sesiones de entrenamiento y ${model.holdoutExamples} en ${model.holdoutSessionCount} sesiones futuras. Mejora Brier mínima 95 %: ${model.brierImprovementLower95?.toFixed(4) ?? "—"}. No promocionado: ${promotion.reasons.join(" ")}`,
      );
      this.announce("Modelo de sombra registrado con dataset, hash de integridad y estado de firma explícito.");
    } finally {
      if (button) button.disabled = false;
    }
  }

  private readShadowRegistry(): ShadowModelRegistry | null {
    try {
      const parsed = JSON.parse(localStorage.getItem("astryd.shadowModel.v1") ?? "null") as ShadowModelRegistry | null;
      return parsed?.format === "astryd-shadow-model-registry" ? parsed : null;
    } catch {
      return null;
    }
  }

  private async deleteAll(): Promise<void> {
    const confirmation = this.element<HTMLInputElement>("intelligence-delete-confirm");
    if (confirmation?.value !== "ELIMINAR") return;
    const receipt = await this.bus.delete({ scope: "all" });
    confirmation.value = "";
    const button = this.element<HTMLButtonElement>("intelligence-delete-all");
    if (button) button.disabled = true;
    this.events = [];
    this.selectedEvent = null;
    this.announce(`Datos eliminados: ${receipt.rowsDeleted} eventos. La captura quedó desactivada.`);
    await this.refresh();
  }

  private ensureDom(): void {
    const container = this.element("inst-intelligence");
    if (!container || this.element("intelligence-recommendations-list")) return;

    container.innerHTML = `
      <div class="intel-main-layout">
        <!-- Área Principal: Lista de Recomendaciones del Asesor -->
        <main class="intel-content-area">
          <!-- Barra Superior: Estado Global y Acciones -->
          <div class="intel-top-bar">
            <div style="display: flex; gap: 6px; align-items: center;">
              <span style="font-weight: bold; font-size: 0.75rem; color: #38bdf8; display: flex; align-items: center; gap: 4px;">
                ◈ Asesor Experto y Diagnóstico
              </span>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <span id="intelligence-live-status" style="font-size: 0.65rem; color: var(--text-muted); font-family: var(--font-mono);">
                Asistente en tiempo real listo
              </span>
            </div>
          </div>

          <!-- Lista de Tarjetas del Asesor -->
          <div id="intelligence-recommendations-list" class="intel-recommendations-scroll">
            <div id="intelligence-empty-state" style="font-size: 0.72rem; color: var(--text-muted); text-align: center; padding: 30px; background: rgba(0,0,0,0.25); border-radius: 6px; border: 1px dashed rgba(255,255,255,0.08);">
              ✓ Sin advertencias ni conflictos detectados en el circuito actual.
            </div>
          </div>
        </main>

        <!-- Barra Lateral: Telemetría, Rendimiento y Salud MNA -->
        <aside class="intel-sidebar">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <h4 class="gen-section-title" style="color: #38bdf8;">📊 Telemetría y Solver</h4>
          </div>

          <!-- Tarjetas de Métricas -->
          <div class="tracer-metric-card">
            <span class="rack-label" style="font-size: 0.55rem; color: #38bdf8;">Tasa de Éxito MNA</span>
            <span id="intelligence-success-rate" class="tracer-metric-val" style="color: #22c55e;">100%</span>
          </div>

          <div class="tracer-metric-card">
            <span class="rack-label" style="font-size: 0.55rem; color: #a855f7;">Latencia P95 del Solver</span>
            <span id="intelligence-p95" class="tracer-metric-val" style="color: #c084fc;">—</span>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
            <div class="tracer-metric-card">
              <span class="rack-label" style="font-size: 0.55rem;">Eventos</span>
              <span id="intelligence-event-count" style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: bold; color: #fff;">0</span>
            </div>
            <div class="tracer-metric-card">
              <span class="rack-label" style="font-size: 0.55rem;">Almacén</span>
              <span id="intelligence-byte-count" style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: bold; color: #fff;">0 B</span>
            </div>
          </div>

          <div class="tracer-metric-card">
            <span class="rack-label" style="font-size: 0.55rem;">Consentimiento</span>
            <span id="intelligence-consent-summary" style="font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-sub);">Local</span>
          </div>

          <!-- Botones de Acción -->
          <div style="display: flex; gap: 4px; margin-top: 4px;">
            <button id="intelligence-refresh-btn" type="button" class="intel-btn" style="flex: 1; justify-content: center;">🔄 Actualizar</button>
            <button id="intelligence-export-btn" type="button" class="intel-btn" style="flex: 1; justify-content: center;">📥 Exportar</button>
          </div>

          <div id="intelligence-shadow-status" style="font-size: 0.62rem; color: var(--text-muted); margin-top: 4px; line-height: 1.4;"></div>
        </aside>
      </div>
    `;
  }

  private element<T extends HTMLElement>(id: string): T | null {
    return this.documentRef.getElementById(id) as T | null;
  }

  private setText(id: string, value: string): void {
    const element = this.element<HTMLElement>(id);
    if (element) element.textContent = value;
  }

  private announce(message: string): void {
    this.setText("intelligence-live-status", message);
  }
}
