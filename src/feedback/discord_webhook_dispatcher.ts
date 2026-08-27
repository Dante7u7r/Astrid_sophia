import type { DiagnosticBundle } from "./diagnostic_collector";

export const DEFAULT_DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1542319580997881908/3VLJv_4C5wDJZorXRR_x_c9SfcijdRVEI6dIKAaXWimz2SAzw9gQ5Xbihdt5tVOhGzgj";

export interface DiscordSendResult {
  readonly success: boolean;
  readonly fallbackSaved?: boolean;
  readonly error?: string;
}

export function getEffectiveDiscordWebhookUrl(): string {
  if (typeof localStorage !== "undefined") {
    const custom = localStorage.getItem("astryd-custom-webhook-url");
    if (custom && custom.startsWith("https://discord.com/api/webhooks/")) {
      return custom;
    }
  }
  return DEFAULT_DISCORD_WEBHOOK_URL;
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const parts = dataUrl.split(",");
    if (parts.length !== 2) return null;
    const meta = parts[0]!;
    const raw = parts[1]!;
    const mimeMatch = meta.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/png";
    const binary = atob(raw);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

export function saveDiagnosticLocally(bundle: DiagnosticBundle, filename?: string): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  try {
    const dateStr = new Date(bundle.createdAt).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const name = filename || `biaani_diagnostico_${dateStr}.json`;
    const jsonStr = JSON.stringify(bundle, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

function resolveEmbedColor(category: string, isCrash: boolean): number {
  if (isCrash) return 0xef4444; // Rojo intenso (Crash)
  switch (category) {
    case "comparison":
      return 0x10b981; // Verde esmeralda (Comparativa / Benchmark)
    case "simulation":
      return 0xf59e0b; // Ámbar (Solver / Simulación)
    case "canvas":
      return 0x06b6d4; // Cyan (Canvas / UI)
    case "feature":
      return 0x8b5cf6; // Púrpura (Sugerencia)
    default:
      return 0x3b82f6; // Azul (General)
  }
}

function resolveCategoryLabel(category: string, isCrash: boolean): string {
  if (isCrash) return "🔴 CRASH CRÍTICO";
  switch (category) {
    case "comparison":
      return "📊 Comparativa de Simulación (vs otro simulador)";
    case "simulation":
      return "⚙️ Error de Simulación / Solver";
    case "canvas":
      return "🎨 Fallo Visual o de Lienzo";
    case "feature":
      return "💡 Sugerencia / Nueva Función";
    default:
      return "💬 Comentario / Reporte";
  }
}

export async function sendDiagnosticToDiscord(
  bundle: DiagnosticBundle,
  webhookUrl = getEffectiveDiscordWebhookUrl(),
): Promise<DiscordSendResult> {
  const isCrash = Boolean(bundle.errorDetails);
  const color = resolveEmbedColor(bundle.category, isCrash);
  const categoryLabel = resolveCategoryLabel(bundle.category, isCrash);

  const embedFields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: "📱 Entorno",
      value: `**Biaani:** \`${bundle.environment?.appVersion || "0.1.0"}\`\n**SO:** ${bundle.environment?.os || "Desconocido"}\n**Res:** ${bundle.environment?.screenResolution || "N/A"}`,
      inline: true,
    },
    {
      name: "⚡ Simulación",
      value: `**Modo:** \`${bundle.simulation?.activeMode || "TRAN"}\`\n**Comps:** ${bundle.circuit?.componentCount ?? 0} | **Cables:** ${bundle.circuit?.wireCount ?? 0}\n**Simulando:** ${bundle.simulation?.isSimulating ? "Sí" : "No"}`,
      inline: true,
    },
  ];

  if (bundle.contact) {
    embedFields.push({
      name: "👤 Contacto",
      value: `\`${bundle.contact}\``,
      inline: false,
    });
  }

  if (bundle.externalAttachment) {
    embedFields.push({
      name: "📎 Archivo / Captura de Referencia",
      value: `**Archivo:** \`${bundle.externalAttachment.name}\` (${(bundle.externalAttachment.sizeBytes / 1024).toFixed(1)} KB)`,
      inline: false,
    });
  }

  if (bundle.errorDetails) {
    const errorSnippet = bundle.errorDetails.stack
      ? `\`\`\`javascript\n${bundle.errorDetails.stack.slice(0, 800)}\n\`\`\``
      : `\`${bundle.errorDetails.message}\``;
    embedFields.push({
      name: "🛑 Excepción / Stack Trace",
      value: errorSnippet,
      inline: false,
    });
  }

  const userDescription = bundle.userNote.trim()
    ? bundle.userNote
    : isCrash
      ? "*Fallo no controlado capturado automáticamente por el sistema de recuperación.*"
      : "*Sin comentarios adicionales por el usuario.*";

  const embed: Record<string, unknown> = {
    title: `[BIAANI DEMO] ${categoryLabel}`,
    description: userDescription.slice(0, 2048),
    color,
    fields: embedFields,
    footer: {
      text: `Biaani Diagnostic Engine • ${new Date(bundle.createdAt).toLocaleDateString()} ${new Date(bundle.createdAt).toLocaleTimeString()}`,
    },
    timestamp: bundle.createdAt,
  };

  const formData = new FormData();
  let fileCounter = 0;
  let hasCanvasImage = false;

  // 1. Adjuntar screenshot de Biaani si existe
  if (bundle.screenshotBase64) {
    const blob = dataUrlToBlob(bundle.screenshotBase64);
    if (blob) {
      formData.append(`files[${fileCounter}]`, blob, "screenshot_biaani.png");
      embed.image = { url: "attachment://screenshot_biaani.png" };
      hasCanvasImage = true;
      fileCounter++;
    }
  }

  // 2. Adjuntar archivo o captura externa si existe
  if (bundle.externalAttachment) {
    const safeName = bundle.externalAttachment.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (bundle.externalAttachment.dataUrl) {
      const extBlob = dataUrlToBlob(bundle.externalAttachment.dataUrl);
      if (extBlob) {
        formData.append(`files[${fileCounter}]`, extBlob, safeName);
        if (bundle.category === "comparison" || !hasCanvasImage) {
          embed.image = { url: `attachment://${safeName}` };
          if (hasCanvasImage) {
            embed.thumbnail = { url: "attachment://screenshot_biaani.png" };
          }
        } else {
          embed.thumbnail = { url: `attachment://${safeName}` };
        }
        fileCounter++;
      }
    } else if (bundle.externalAttachment.textContent) {
      const textBlob = new Blob([bundle.externalAttachment.textContent], { type: "text/plain" });
      formData.append(`files[${fileCounter}]`, textBlob, safeName);
      fileCounter++;
    }
  }

  // 3. Adjuntar el archivo JSON completo de diagnóstico
  const jsonBundleClean = {
    ...bundle,
    screenshotBase64: bundle.screenshotBase64 ? "[ADJUNTO EN screenshot_biaani.png]" : undefined,
    externalAttachment: bundle.externalAttachment?.dataUrl
      ? { ...bundle.externalAttachment, dataUrl: `[ADJUNTO EN ${bundle.externalAttachment.name}]` }
      : bundle.externalAttachment,
  };
  const jsonBlob = new Blob([JSON.stringify(jsonBundleClean, null, 2)], {
    type: "application/json",
  });
  formData.append(`files[${fileCounter}]`, jsonBlob, "diagnostico_biaani.json");

  const payload = {
    username: "Biaani Telemetry & Bug Reporter",
    avatar_url: "https://raw.githubusercontent.com/tauri-apps/tauri/dev/.github/splash.png",
    embeds: [embed],
  };

  formData.append("payload_json", JSON.stringify(payload));

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      body: formData,
    });

    if (response.ok || response.status === 204) {
      return { success: true };
    }

    const errorText = await response.text().catch(() => "Error desconocido");
    const fallbackSaved = saveDiagnosticLocally(bundle);
    return {
      success: false,
      fallbackSaved,
      error: `Discord respondió con estado ${response.status}: ${errorText.slice(0, 120)}`,
    };
  } catch (err) {
    const fallbackSaved = saveDiagnosticLocally(bundle);
    return {
      success: false,
      fallbackSaved,
      error: `Fallo de conexión con Discord: ${(err as Error).message || "Error de red"}`,
    };
  }
}
