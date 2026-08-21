import { describe, expect, it } from "vitest";
import {
  validateSpiceDocument,
  getHoverInfo,
  getCompletions,
  handleLspMessage,
} from "./spice_language_server";

describe("Language Server Protocol (LSP) para SPICE Netlists y Esquemas", () => {
  describe("1. Diagnostics & Live Linter", () => {
    it("valida netlist correcto sin errores críticos", () => {
      const netlist = [
        "* Filtro RC Pasa-Bajos",
        "V1 in 0 DC 5.0 SIN(0 5 1k)",
        "R1 in out 1k",
        "C1 out 0 100n",
        ".tran 10u 10m",
        ".end",
      ].join("\n");

      const diagnostics = validateSpiceDocument(netlist);
      const errors = diagnostics.filter(d => d.severity === 1);
      expect(errors.length).toBe(0);
    });

    it("detecta ausencia de conexión a Tierra (GND / Nodo 0)", () => {
      const netlist = [
        "V1 in 1 DC 5",
        "R1 in out 1k",
        "R2 out 1 1k",
      ].join("\n");

      const diagnostics = validateSpiceDocument(netlist);
      const gndWarning = diagnostics.find(d => d.code === "ERC_NO_GND");
      expect(gndWarning).toBeDefined();
      expect(gndWarning?.severity).toBe(2);
    });

    it("detecta componentes incompletos y valores con sintaxis inválida", () => {
      const netlist = [
        "R1 in",               // Incompleto
        "C1 in 0 100xyz",      // Sufijo inválido
        "D1 in",               // Diodo incompleto
      ].join("\n");

      const diagnostics = validateSpiceDocument(netlist);
      expect(diagnostics.some(d => d.code === "SPICE_COMP_SYNTAX")).toBe(true);
      expect(diagnostics.some(d => d.code === "SPICE_INVALID_VALUE")).toBe(true);
      expect(diagnostics.some(d => d.code === "SPICE_DIODE_SYNTAX")).toBe(true);
    });

    it("detecta bloques .SUBCKT sin cerrar", () => {
      const netlist = [
        ".SUBCKT OPAMP_BLOCK IN OUT",
        "R1 IN OUT 10k",
        // Falta .ENDS
      ].join("\n");

      const diagnostics = validateSpiceDocument(netlist);
      expect(diagnostics.some(d => d.code === "ERC_UNCLOSED_SUBCKT")).toBe(true);
    });

    it("detecta directiva .ENDS huérfana", () => {
      const netlist = [
        "R1 IN 0 1k",
        ".ENDS",
      ].join("\n");

      const diagnostics = validateSpiceDocument(netlist);
      expect(diagnostics.some(d => d.code === "ERC_DANGLING_ENDS")).toBe(true);
    });
  });

  describe("2. Hover Information", () => {
    it("muestra información de directiva SPICE (.tran, .ac, .model, .meas)", () => {
      const text = ".tran 10u 10m\n.ac DEC 100 10 100k";

      const tranHover = getHoverInfo(text, { line: 0, character: 2 });
      expect(tranHover).not.toBeNull();
      expect(tranHover?.contents.value).toContain(".TRAN");
      expect(tranHover?.contents.value).toContain("Análisis transitorio");

      const acHover = getHoverInfo(text, { line: 1, character: 2 });
      expect(acHover).not.toBeNull();
      expect(acHover?.contents.value).toContain(".AC");
      expect(acHover?.contents.value).toContain("frecuencia");
    });

    it("muestra información técnica de componentes (R, C, V, M, Q)", () => {
      const text = "R1 in out 1k\nQ1 c b e 2N2222";

      const rHover = getHoverInfo(text, { line: 0, character: 1 });
      expect(rHover).not.toBeNull();
      expect(rHover?.contents.value).toContain("Resistor");

      const qHover = getHoverInfo(text, { line: 1, character: 1 });
      expect(qHover).not.toBeNull();
      expect(qHover?.contents.value).toContain("Transistor Bipolar");
    });

    it("muestra parámetros de modelos semiconductores comerciales (1N4148, 2N2222)", () => {
      const text = "D1 a k 1N4148\nQ1 c b e 2N2222";

      const diodeHover = getHoverInfo(text, { line: 0, character: 8 });
      expect(diodeHover).not.toBeNull();
      expect(diodeHover?.contents.value).toContain("1N4148");
      expect(diodeHover?.contents.value).toContain("recuperación");

      const bjtHover = getHoverInfo(text, { line: 1, character: 10 });
      expect(bjtHover).not.toBeNull();
      expect(bjtHover?.contents.value).toContain("2N2222");
      expect(bjtHover?.contents.value).toContain("h_{FE}");
    });
  });

  describe("3. Autocompletion Engine", () => {
    it("ofrece directivas SPICE al escribir punto (.)", () => {
      const completions = getCompletions(".t", { line: 0, character: 2 });
      expect(completions.some(c => c.label === ".TRAN")).toBe(true);
      expect(completions.some(c => c.label === ".AC")).toBe(true);
      expect(completions.some(c => c.label === ".MODEL")).toBe(true);
      expect(completions.some(c => c.label === ".SUBCKT")).toBe(true);
    });

    it("ofrece snippets de componentes y modelos comerciales en líneas regulares", () => {
      const completions = getCompletions("R", { line: 0, character: 1 });
      expect(completions.some(c => c.label === "Resistor")).toBe(true);
      expect(completions.some(c => c.label === "Capacitor")).toBe(true);
      expect(completions.some(c => c.label === "Voltage Source SINE")).toBe(true);
      expect(completions.some(c => c.label === "1N4148")).toBe(true);
      expect(completions.some(c => c.label === "2N2222")).toBe(true);
    });
  });

  describe("4. JSON-RPC Protocol Dispatcher", () => {
    it("responde al mensaje 'initialize' con capacidades LSP", () => {
      const res = handleLspMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      });

      expect(res).not.toBeNull();
      expect(res?.id).toBe(1);
      expect(res?.result.capabilities.hoverProvider).toBe(true);
      expect(res?.result.capabilities.completionProvider).toBeDefined();
      expect(res?.result.serverInfo.name).toBe("astryd-spice-lsp");
    });

    it("procesa 'textDocument/didOpen' y publica diagnósticos", () => {
      const res = handleLspMessage({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: "file:///test.cir",
            text: "R1 in",
          },
        },
      });

      expect(res).not.toBeNull();
      expect(res?.method).toBe("textDocument/publishDiagnostics");
      expect(res?.params.diagnostics.length).toBeGreaterThan(0);
    });

    it("atiende solicitudes 'textDocument/hover'", () => {
      const res = handleLspMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "textDocument/hover",
        params: {
          text: ".tran 10u 10m",
          position: { line: 0, character: 2 },
        },
      });

      expect(res?.result).not.toBeNull();
      expect(res?.result.contents.value).toContain(".TRAN");
    });

    it("atiende solicitudes 'textDocument/completion'", () => {
      const res = handleLspMessage({
        jsonrpc: "2.0",
        id: 3,
        method: "textDocument/completion",
        params: {
          text: ".",
          position: { line: 0, character: 1 },
        },
      });

      expect(res?.result).toBeInstanceOf(Array);
      expect(res?.result.length).toBeGreaterThan(5);
    });
  });
});
