#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2025-11-25";
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const APP_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

function bundleArgument(argv) {
  const index = argv.indexOf("--bundle");
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return process.env.ASTRYD_SUPPORT_BUNDLE;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateBundle(value) {
  if (!value || typeof value !== "object") throw new Error("El paquete no es un objeto JSON.");
  if (value.manifest?.format !== "astryd-feedback-support") throw new Error("Formato de paquete desconocido.");
  if (value.manifest?.formatVersion !== 2) throw new Error("Versión de paquete no compatible; se requiere la versión 2.");
  if (!Array.isArray(value.events)) throw new Error("El paquete no contiene una lista de eventos.");
  if (typeof value.summaryMarkdown !== "string") throw new Error("El paquete no contiene el resumen Markdown.");
  if (value.manifest.eventCount !== value.events.length) throw new Error("El conteo del manifiesto no coincide.");
  const expected = sha256(JSON.stringify({ events: value.events, summaryMarkdown: value.summaryMarkdown }));
  if (value.manifest.contentSha256 !== expected) throw new Error("Falló la verificación SHA-256 del paquete.");
  for (const event of value.events) {
    if (!event || typeof event !== "object" || typeof event.kind !== "string" || typeof event.eventId !== "string") {
      throw new Error("El paquete contiene un evento inválido.");
    }
  }
  return value;
}

function loadBundle(pathValue) {
  if (!pathValue) throw new Error("Indica un paquete con --bundle <archivo.json> o ASTRYD_SUPPORT_BUNDLE.");
  const path = resolve(pathValue);
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error("La ruta del paquete no es un archivo.");
  if (stat.size > MAX_BUNDLE_BYTES) throw new Error("El paquete excede el límite de 32 MiB.");
  return validateBundle(JSON.parse(readFileSync(path, "utf8")));
}

function terminalEvents(bundle) {
  return bundle.events.filter((event) => event.kind === "simulation.completed" || event.kind === "simulation.failed");
}

function compareVersions(bundle) {
  const versions = new Map();
  for (const event of terminalEvents(bundle)) {
    const row = versions.get(event.appVersion) ?? { version: event.appVersion, completed: 0, failed: 0, durationsMs: [] };
    if (event.kind === "simulation.completed") {
      row.completed += 1;
      if (Number.isFinite(event.payload?.durationMs)) row.durationsMs.push(event.payload.durationMs);
    } else {
      row.failed += 1;
    }
    versions.set(event.appVersion, row);
  }
  return [...versions.values()].sort((left, right) => left.version.localeCompare(right.version)).map((row) => {
    const total = row.completed + row.failed;
    const sorted = [...row.durationsMs].sort((left, right) => left - right);
    const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return {
      version: row.version,
      completed: row.completed,
      failed: row.failed,
      successRate: total === 0 ? null : row.completed / total,
      durationP95Ms: sorted.length === 0 ? null : sorted[p95Index],
    };
  });
}

function toolResult(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
    isError,
  };
}

function audit(method, detail = {}) {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), method, ...detail })}\n`);
}

function success(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function failure(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function resources(bundle) {
  return [
    { uri: "astryd://support/summary", name: "summary", title: "Resumen de diagnóstico", mimeType: "text/markdown" },
    { uri: "astryd://support/manifest", name: "manifest", title: "Manifiesto y redacciones", mimeType: "application/json" },
    { uri: "astryd://support/events", name: "events", title: "Eventos redactados", mimeType: "application/json" },
  ];
}

const TOOL_DEFINITIONS = [
  {
    name: "list_failures",
    title: "Listar fallos redactados",
    description: "Lista eventos de simulación fallida del paquete seleccionado. No modifica datos.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "compare_versions",
    title: "Comparar versiones",
    description: "Compara éxito y duración p95 entre versiones presentes en el paquete. No modifica datos.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_event",
    title: "Leer evento redactado",
    description: "Obtiene un evento por su identificador reasignado dentro del paquete. No modifica datos.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string", pattern: "^event-[0-9]{4,}$" } },
      required: ["eventId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

let bundle;
try {
  bundle = loadBundle(bundleArgument(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`Astryd MCP: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

let initialized = false;
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    failure(null, -32700, "JSON inválido.");
    return;
  }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    failure(message?.id ?? null, -32600, "Solicitud JSON-RPC inválida.");
    return;
  }
  if (!("id" in message)) {
    if (message.method === "notifications/initialized") initialized = true;
    return;
  }
  if (message.method === "initialize") {
    initialized = true;
    audit("initialize");
    success(message.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { resources: {}, tools: {} },
      serverInfo: {
        name: "astryd-feedback-readonly",
        title: "Astryd Sophia — diagnóstico local de solo lectura",
        version: APP_VERSION,
        description: "Consulta un paquete de soporte redactado sin acceder al proyecto ni a la base interna.",
      },
      instructions: "Sólo hay recursos y consultas de lectura. El acceso termina al cerrar este proceso.",
    });
    return;
  }
  if (message.method === "ping") {
    success(message.id, {});
    return;
  }
  if (!initialized) {
    failure(message.id, -32002, "El servidor debe inicializarse primero.");
    return;
  }
  if (message.method === "resources/list") {
    audit("resources/list", { resultCount: 3 });
    success(message.id, { resources: resources(bundle) });
    return;
  }
  if (message.method === "resources/read") {
    const uri = message.params?.uri;
    let text;
    let mimeType;
    if (uri === "astryd://support/summary") {
      text = bundle.summaryMarkdown;
      mimeType = "text/markdown";
    } else if (uri === "astryd://support/manifest") {
      text = JSON.stringify(bundle.manifest, null, 2);
      mimeType = "application/json";
    } else if (uri === "astryd://support/events") {
      text = JSON.stringify(bundle.events, null, 2);
      mimeType = "application/json";
    } else {
      failure(message.id, -32602, "Recurso desconocido.");
      return;
    }
    audit("resources/read", { uri });
    success(message.id, { contents: [{ uri, mimeType, text }] });
    return;
  }
  if (message.method === "tools/list") {
    audit("tools/list", { resultCount: TOOL_DEFINITIONS.length });
    success(message.id, { tools: TOOL_DEFINITIONS });
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (name === "list_failures") {
      const limit = Number.isInteger(args.limit) ? args.limit : 25;
      if (limit < 1 || limit > 100) {
        failure(message.id, -32602, "limit debe estar entre 1 y 100.");
        return;
      }
      const result = bundle.events.filter((event) => event.kind === "simulation.failed").slice(0, limit);
      audit("tools/call", { tool: name, resultCount: result.length });
      success(message.id, toolResult(result));
      return;
    }
    if (name === "compare_versions") {
      const result = compareVersions(bundle);
      audit("tools/call", { tool: name, resultCount: result.length });
      success(message.id, toolResult(result));
      return;
    }
    if (name === "get_event") {
      if (typeof args.eventId !== "string") {
        failure(message.id, -32602, "eventId es obligatorio.");
        return;
      }
      const result = bundle.events.find((event) => event.eventId === args.eventId) ?? null;
      audit("tools/call", { tool: name, found: result !== null });
      success(message.id, toolResult(result));
      return;
    }
    failure(message.id, -32602, "Herramienta desconocida.");
    return;
  }
  failure(message.id, -32601, "Método no encontrado.");
});

input.on("close", () => {
  bundle = null;
  process.exit(0);
});
