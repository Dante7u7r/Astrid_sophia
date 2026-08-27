/**
 * Astryd Sophia — Language Server Protocol (LSP) Engine para SPICE Netlists y Esquemas.
 *
 * Implementa las especificaciones LSP (Language Server Protocol v3.17) para:
 * 1. Diagnostics (Linter en vivo, validación de sintaxis, reglas eléctricas ERC, nodos huérfanos, falta de GND).
 * 2. Hover (Documentación técnica, desglose de terminales, valores en ingeniería SI, modelos semiconductores).
 * 3. Completion (Autocompletado contextual de directivas .tran/.ac/.dc/.model/.subckt, snippets de componentes y modelos comerciales).
 * 4. JSON-RPC 2.0 Dispatcher (Soporte stdio / WebSocket para extensiones de VS Code).
 */

import { parseSpiceValue } from "../simulation/spice_value_parser";
import { COMMERCIAL_BJTS, COMMERCIAL_DIODES, COMMERCIAL_MOSFETS, COMMERCIAL_OPAMPS } from "../simulation/commercial_models_catalog";

// ============================================================================
// TIPOS Y DEFINICIONES DE LA ESPECIFICACIÓN LSP (Language Server Protocol)
// ============================================================================

export interface LspPosition {
  line: number; // 0-indexed
  character: number; // 0-indexed
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export type LspDiagnosticSeverity = 1 | 2 | 3 | 4; // 1=Error, 2=Warning, 3=Info, 4=Hint

export interface LspDiagnostic {
  range: LspRange;
  severity: LspDiagnosticSeverity;
  source: string;
  message: string;
  code?: string | number;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange;
}

export type LspCompletionItemKind =
  | 1 // Text
  | 2 // Method
  | 3 // Function
  | 6 // Variable
  | 7 // Class
  | 10 // Property
  | 14 // Keyword
  | 15 // Snippet
  | 21 // Constant
  | 22; // Struct

export interface LspCompletionItem {
  label: string;
  kind: LspCompletionItemKind;
  detail?: string;
  documentation?: string | { kind: "markdown"; value: string };
  insertText?: string;
  insertTextFormat?: 1 | 2; // 1 = PlainText, 2 = Snippet
}

// ============================================================================
// 1. MOTOR DE DIAGNÓSTICOS Y LINTER EN VIVO (LSP DIAGNOSTICS)
// ============================================================================

export function validateSpiceDocument(text: string): LspDiagnostic[] {
  const diagnostics: LspDiagnostic[] = [];
  const lines = text.split(/\r?\n/);

  let hasGround = false;
  const nodeReferences = new Map<string, number>();
  const subcktStack: string[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const trimmed = rawLine.trim();

    // Ignorar líneas vacías y comentarios (* o $)
    if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("$")) {
      continue;
    }

    const tokens = trimmed.split(/\s+/);
    const firstToken = tokens[0];
    const firstChar = firstToken[0].toUpperCase();

    // 1. Directivas de punto (.TRAN, .AC, .DC, .MODEL, .SUBCKT, .ENDS, .PARAM, etc.)
    if (firstToken.startsWith(".")) {
      const directive = firstToken.toUpperCase();

      if (directive === ".SUBCKT") {
        if (tokens.length < 2) {
          diagnostics.push({
            range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
            severity: 1,
            source: "astryd-spice-lsp",
            message: "Sintaxis .SUBCKT incompleta. Formato esperado: .SUBCKT <nombre> <nodo1> <nodo2> ...",
            code: "ERC_SUBCKT_SYNTAX",
          });
        } else {
          subcktStack.push(tokens[1]);
        }
      } else if (directive === ".ENDS") {
        if (subcktStack.length === 0) {
          diagnostics.push({
            range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
            severity: 1,
            source: "astryd-spice-lsp",
            message: "Directiva .ENDS sin un bloque .SUBCKT correspondiente abierto.",
            code: "ERC_DANGLING_ENDS",
          });
        } else {
          subcktStack.pop();
        }
      } else if (directive === ".TRAN") {
        if (tokens.length < 3) {
          diagnostics.push({
            range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
            severity: 1,
            source: "astryd-spice-lsp",
            message: "Directiva .TRAN incompleta. Formato esperado: .TRAN <Tstep> <Tstop> [Tstart] [Tmax]",
            code: "SPICE_TRAN_SYNTAX",
          });
        }
      } else if (directive === ".AC") {
        if (tokens.length < 5) {
          diagnostics.push({
            range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
            severity: 1,
            source: "astryd-spice-lsp",
            message: "Directiva .AC incompleta. Formato: .AC <DEC|OCT|LIN> <puntos> <fstart> <fstop>",
            code: "SPICE_AC_SYNTAX",
          });
        }
      } else if (directive === ".DC") {
        if (tokens.length < 5) {
          diagnostics.push({
            range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
            severity: 1,
            source: "astryd-spice-lsp",
            message: "Directiva .DC incompleta. Formato: .DC <fuente> <vstart> <vstop> <vstep>",
            code: "SPICE_DC_SYNTAX",
          });
        }
      }
      continue;
    }

    // 2. Componentes de dos terminales (R, C, L, D, V, I)
    if (firstChar === "R" || firstChar === "C" || firstChar === "L") {
      if (tokens.length < 4) {
        diagnostics.push({
          range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
          severity: 1,
          source: "astryd-spice-lsp",
          message: `Definición incompleta para componente ${firstToken}. Formato: ${firstToken} <nodo+> <nodo-> <valor>`,
          code: "SPICE_COMP_SYNTAX",
        });
      } else {
        const valStr = tokens[3];
        const parsed = parseSpiceValue(valStr);
        if (!parsed.valid) {
          diagnostics.push({
            range: { start: { line: lineIdx, character: rawLine.indexOf(valStr) }, end: { line: lineIdx, character: rawLine.indexOf(valStr) + valStr.length } },
            severity: 1,
            source: "astryd-spice-lsp",
            message: `Valor numérico SPICE no reconocido: '${valStr}'. Usa sufijos de ingeniería válidos (ej: 10k, 1u, 100n).`,
            code: "SPICE_INVALID_VALUE",
          });
        }
        // Registrar nodos
        recordNode(tokens[1]);
        recordNode(tokens[2]);
      }
    } else if (firstChar === "V" || firstChar === "I") {
      if (tokens.length < 3) {
        diagnostics.push({
          range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
          severity: 1,
          source: "astryd-spice-lsp",
          message: `Definición incompleta de fuente ${firstToken}. Formato: ${firstToken} <nodo+> <nodo-> [DC <v>] [AC <v>] [SIN/PULSE/etc]`,
          code: "SPICE_SOURCE_SYNTAX",
        });
      } else {
        recordNode(tokens[1]);
        recordNode(tokens[2]);
      }
    } else if (firstChar === "D") {
      // Diodo: D1 anode cathode model
      if (tokens.length < 4) {
        diagnostics.push({
          range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
          severity: 1,
          source: "astryd-spice-lsp",
          message: `Definición de diodo incompleta. Formato: ${firstToken} <ánodo> <cátodo> <modelo>`,
          code: "SPICE_DIODE_SYNTAX",
        });
      } else {
        recordNode(tokens[1]);
        recordNode(tokens[2]);
      }
    } else if (firstChar === "Q") {
      // BJT: Q1 collector base emitter [substrate] model
      if (tokens.length < 5) {
        diagnostics.push({
          range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
          severity: 1,
          source: "astryd-spice-lsp",
          message: `Definición de BJT incompleta. Formato: ${firstToken} <colector> <base> <emisor> <modelo>`,
          code: "SPICE_BJT_SYNTAX",
        });
      } else {
        recordNode(tokens[1]);
        recordNode(tokens[2]);
        recordNode(tokens[3]);
      }
    } else if (firstChar === "M") {
      // MOSFET: M1 drain gate source bulk model
      if (tokens.length < 6) {
        diagnostics.push({
          range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
          severity: 1,
          source: "astryd-spice-lsp",
          message: `Definición de MOSFET incompleta. Formato: ${firstToken} <drenador> <puerta> <fuente> <sustrato> <modelo>`,
          code: "SPICE_MOSFET_SYNTAX",
        });
      } else {
        recordNode(tokens[1]);
        recordNode(tokens[2]);
        recordNode(tokens[3]);
        recordNode(tokens[4]);
      }
    } else if (firstChar === "X") {
      // Instancia de subcircuito
      if (tokens.length < 3) {
        diagnostics.push({
          range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
          severity: 1,
          source: "astryd-spice-lsp",
          message: `Instancia de subcircuito ${firstToken} incompleta. Formato: ${firstToken} <nodo1> ... <nodoN> <nombre_subcircuito>`,
          code: "SPICE_X_SYNTAX",
        });
      } else {
        for (let i = 1; i < tokens.length - 1; i++) {
          recordNode(tokens[i]);
        }
      }
    }
  }

  // 3. Validar cierre de bloques .SUBCKT
  if (subcktStack.length > 0) {
    diagnostics.push({
      range: { start: { line: lines.length - 1, character: 0 }, end: { line: lines.length - 1, character: 1 } },
      severity: 1,
      source: "astryd-spice-lsp",
      message: `Bloque .SUBCKT [${subcktStack.join(", ")}] sin cerrar al final del archivo. Añade '.ENDS'.`,
      code: "ERC_UNCLOSED_SUBCKT",
    });
  }

  // 4. Validar referencia a Tierra (GND / 0)
  if (lines.some(l => l.trim() && !l.trim().startsWith("*")) && !hasGround) {
    diagnostics.push({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: Math.max(1, lines[0].length) } },
      severity: 2,
      source: "astryd-spice-lsp",
      message: "Referencia a Tierra (Nodo '0' o 'GND') no encontrada en el netlist. Se recomienda conectar al menos un terminal al nodo 0.",
      code: "ERC_NO_GND",
    });
  }

  // 5. Detectar nodos huérfanos (referenciados exactamente 1 vez)
  for (const [nodeName, count] of nodeReferences.entries()) {
    if (nodeName !== "0" && nodeName.toUpperCase() !== "GND" && count === 1) {
      diagnostics.push({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: Math.max(1, lines[0].length) } },
        severity: 2,
        source: "astryd-spice-lsp",
        message: `Posible nodo flotante/huérfano: El nodo '${nodeName}' solo está conectado a 1 terminal.`,
        code: "ERC_FLOATING_NODE",
      });
    }
  }

  function recordNode(nodeStr: string) {
    if (!nodeStr) return;
    const clean = nodeStr.trim();
    if (clean === "0" || clean.toUpperCase() === "GND") {
      hasGround = true;
    } else {
      nodeReferences.set(clean, (nodeReferences.get(clean) || 0) + 1);
    }
  }

  return diagnostics;
}

// ============================================================================
// 2. MOTOR DE INFORMACIÓN EN HOVER (LSP HOVER)
// ============================================================================

export function getHoverInfo(text: string, position: LspPosition): LspHover | null {
  const lines = text.split(/\r?\n/);
  if (position.line >= lines.length) return null;

  const line = lines[position.line];
  const wordMatch = findWordAtPosition(line, position.character);
  if (!wordMatch) return null;

  const word = wordMatch.word;
  const upper = word.toUpperCase();

  // 1. Directivas SPICE
  if (upper.startsWith(".")) {
    const doc = SPICE_DIRECTIVE_DOCS[upper];
    if (doc) {
      return {
        contents: {
          kind: "markdown",
          value: `### Directiva SPICE \`${upper}\`\n\n${doc.description}\n\n**Sintaxis:**\n\`\`\`spice\n${doc.syntax}\n\`\`\`\n\n**Ejemplo:**\n\`\`\`spice\n${doc.example}\n\`\`\``,
        },
      };
    }
  }

  // 2. Componentes de circuito (R1, C1, L1, V1, D1, Q1, M1)
  const firstChar = upper[0];
  if (/^[RCLVDIQMX][0-9A-Z_]*$/i.test(word)) {
    const typeDescriptions: Record<string, string> = {
      R: "Resistor (Resistencia eléctrica en Ohmios [Ω])",
      C: "Capacitor (Capacidad electrostática en Faradios [F])",
      L: "Inductor (Autoinducción magnética en Henrios [H])",
      V: "Fuente de Tensión Independiente (Voltios [V])",
      I: "Fuente de Corriente Independiente (Amperios [A])",
      D: "Diodo Semiconductor (P-N, Schottky, Zener)",
      Q: "Transistor Bipolar de Unión (BJT NPN/PNP)",
      M: "Transistor de Efecto de Campo MOSFET (NMOS/PMOS)",
      X: "Instancia de Subcircuito Jerárquico / Macromodelo",
    };

    const desc = typeDescriptions[firstChar] || "Componente SPICE";
    return {
      contents: {
        kind: "markdown",
        value: `### Componente \`${word}\`\n\n**Tipo:** ${desc}\n\n**Sintaxis Estándar:**\n- \`${firstChar} <nodo_a> <nodo_b> [valor/modelo]\`\n\n*Haz clic o edita en Biaani para simular.*`,
      },
    };
  }

  // 3. Modelos Comerciales Integrados
  const diodeList = Object.values(COMMERCIAL_DIODES);
  const diodeModel = diodeList.find(d => d.name.toUpperCase() === upper);
  if (diodeModel) {
    const breakdownStr = diodeModel.bv ? `- **Tensión de ruptura ($V_{BR}$ / Zener):** ${diodeModel.bv} V\n` : "";
    const ttStr = diodeModel.tt ? `- **Tiempo de tránsito / recuperación ($t_t$):** ${(diodeModel.tt * 1e9).toFixed(2)} ns\n` : "";
    const vfStr = diodeModel.forwardVoltage ? `- **Tensión directa típica ($V_F$):** ${diodeModel.forwardVoltage} V\n` : "";
    return {
      contents: {
        kind: "markdown",
        value: `### Modelo de Diodo \`${diodeModel.name}\`\n\n**Descripción:** ${diodeModel.description}\n\n${vfStr}${breakdownStr}${ttStr}- **Corriente de saturación ($I_S$):** ${diodeModel.is.toExponential(2)} A\n- **Factor de idealidad ($N$):** ${diodeModel.n}`,
      },
    };
  }

  const bjtList = Object.values(COMMERCIAL_BJTS);
  const bjtModel = bjtList.find(b => b.name.toUpperCase() === upper);
  if (bjtModel) {
    return {
      contents: {
        kind: "markdown",
        value: `### Transistor BJT \`${bjtModel.name}\`\n\n**Tipo:** ${bjtModel.polarity.toUpperCase()} | ${bjtModel.description}\n\n- **Ganancia típica ($h_{FE}$ / $\\beta_F$):** ${bjtModel.bf}\n- **Corriente de saturación ($I_S$):** ${bjtModel.is.toExponential(2)} A\n- **Resistencia de base ($R_B$):** ${bjtModel.rb ?? 10} Ω`,
      },
    };
  }

  const mosfetList = Object.values(COMMERCIAL_MOSFETS);
  const mosfetModel = mosfetList.find(m => m.name.toUpperCase() === upper);
  if (mosfetModel) {
    return {
      contents: {
        kind: "markdown",
        value: `### MOSFET \`${mosfetModel.name}\`\n\n**Tipo:** ${mosfetModel.polarity.toUpperCase()} Canal | ${mosfetModel.description}\n\n- **Tensión umbral ($V_{GS(th)}$ / $V_{th}$):** ${mosfetModel.vth} V\n- **Resistencia en conducción ($R_{DS(on)}$):** ${mosfetModel.ron} Ω`,
      },
    };
  }

  return null;
}

function findWordAtPosition(line: string, charIndex: number): { word: string; start: number; end: number } | null {
  if (charIndex > line.length) return null;

  let start = charIndex;
  while (start > 0 && /[A-Za-z0-9_.\-]/.test(line[start - 1])) {
    start--;
  }

  let end = charIndex;
  while (end < line.length && /[A-Za-z0-9_.\-]/.test(line[end])) {
    end++;
  }

  if (start === end) return null;
  return { word: line.substring(start, end), start, end };
}

// ============================================================================
// 3. MOTOR DE AUTOCOMPLETADO (LSP COMPLETION)
// ============================================================================

export function getCompletions(text: string, position: LspPosition): LspCompletionItem[] {
  const lines = text.split(/\r?\n/);
  const currentLine = lines[position.line] || "";
  const prefix = currentLine.substring(0, position.character).trimStart();

  const items: LspCompletionItem[] = [];

  // Si la línea empieza con un punto o está vacía, ofrecer directivas SPICE
  if (prefix.startsWith(".") || prefix === "") {
    for (const [dir, doc] of Object.entries(SPICE_DIRECTIVE_DOCS)) {
      items.push({
        label: dir,
        kind: 14, // Keyword
        detail: doc.syntax,
        documentation: { kind: "markdown", value: doc.description },
        insertText: doc.snippet || dir,
        insertTextFormat: doc.snippet ? 2 : 1,
      });
    }
  }

  // Snippets de componentes comunes
  if (!prefix.startsWith(".")) {
    items.push(
      {
        label: "Resistor",
        kind: 15, // Snippet
        detail: "R<name> <node+> <node-> <value>",
        insertText: "R${1:1} ${2:in} ${3:out} ${4:1k}",
        insertTextFormat: 2,
      },
      {
        label: "Capacitor",
        kind: 15,
        detail: "C<name> <node+> <node-> <value>",
        insertText: "C${1:1} ${2:in} ${3:0} ${4:100n}",
        insertTextFormat: 2,
      },
      {
        label: "Inductor",
        kind: 15,
        detail: "L<name> <node+> <node-> <value>",
        insertText: "L${1:1} ${2:in} ${3:out} ${4:10u}",
        insertTextFormat: 2,
      },
      {
        label: "Voltage Source DC",
        kind: 15,
        detail: "V<name> <node+> <node-> DC <value>",
        insertText: "V${1:1} ${2:vcc} ${3:0} DC ${4:5}",
        insertTextFormat: 2,
      },
      {
        label: "Voltage Source SINE",
        kind: 15,
        detail: "V<name> <node+> <node-> SIN(offset amp freq)",
        insertText: "V${1:in} ${2:in} ${3:0} SIN(${4:0} ${5:1} ${6:1k})",
        insertTextFormat: 2,
      },
      {
        label: "Voltage Source PULSE",
        kind: 15,
        detail: "V<name> <node+> <node-> PULSE(v1 v2 td tr tf pw per)",
        insertText: "V${1:clk} ${2:clk} ${3:0} PULSE(${4:0} ${5:5} ${6:0} ${7:1n} ${8:1n} ${9:500n} ${10:1u})",
        insertTextFormat: 2,
      }
    );

    // Modelos comerciales
    for (const d of Object.values(COMMERCIAL_DIODES)) {
      items.push({
        label: d.name,
        kind: 7, // Class / Model
        detail: `Diodo: ${d.description}`,
        insertText: `D\${1:1} \${2:anode} \${3:cathode} ${d.name}`,
        insertTextFormat: 2,
      });
    }

    for (const b of Object.values(COMMERCIAL_BJTS)) {
      items.push({
        label: b.name,
        kind: 7,
        detail: `BJT ${b.polarity.toUpperCase()}: ${b.description}`,
        insertText: `Q\${1:1} \${2:c} \${3:b} \${4:e} ${b.name}`,
        insertTextFormat: 2,
      });
    }

    for (const m of Object.values(COMMERCIAL_MOSFETS)) {
      items.push({
        label: m.name,
        kind: 7,
        detail: `MOSFET ${m.polarity.toUpperCase()} Canal: ${m.description}`,
        insertText: `M\${1:1} \${2:d} \${3:g} \${4:s} \${5:s} ${m.name}`,
        insertTextFormat: 2,
      });
    }

    for (const op of Object.values(COMMERCIAL_OPAMPS)) {
      items.push({
        label: op.name,
        kind: 7,
        detail: `Amp Op: ${op.description}`,
        insertText: `X\${1:1} \${2:in_plus} \${3:in_minus} \${4:vcc} \${5:vee} \${6:out} ${op.name}`,
        insertTextFormat: 2,
      });
    }
  }

  return items;
}

// ============================================================================
// DICCIONARIO DE DIRECTIVAS SPICE
// ============================================================================

const SPICE_DIRECTIVE_DOCS: Record<string, { description: string; syntax: string; example: string; snippet?: string }> = {
  ".TRAN": {
    description: "Análisis transitorio en el dominio del tiempo. Resuelve las ecuaciones diferenciales ordinarias del circuito en cada paso temporal.",
    syntax: ".TRAN <Tstep> <Tstop> [Tstart] [Tmax]",
    example: ".TRAN 10u 10m 0 10u",
    snippet: ".TRAN ${1:10u} ${2:10m} ${3:0} ${4:10u}",
  },
  ".AC": {
    description: "Análisis en pequeña señal en el dominio de la frecuencia (Respuesta de Bode).",
    syntax: ".AC <DEC|OCT|LIN> <Npoints> <Fstart> <Fstop>",
    example: ".AC DEC 100 10 100k",
    snippet: ".AC DEC ${1:100} ${2:10} ${3:100k}",
  },
  ".DC": {
    description: "Barrido en corriente continua (DC Sweep) variando una fuente de tensión o corriente.",
    syntax: ".DC <Source> <Vstart> <Vstop> <Vstep>",
    example: ".DC V1 0 5 0.1",
    snippet: ".DC ${1:V1} ${2:0} ${3:5} ${4:0.1}",
  },
  ".MODEL": {
    description: "Define los parámetros físicos y de proceso para un componente semiconductor (Diodo, BJT, MOSFET, JFET).",
    syntax: ".MODEL <ModelName> <Type> (Param1=Val1 Param2=Val2 ...)",
    example: ".MODEL D1N4148 D (IS=2.52n RS=0.568 N=1.752 BV=100 IBV=10u)",
    snippet: ".MODEL ${1:MYMODEL} ${2|D,NPN,PNP,NMOS,PMOS|} (${3:IS=1e-14})",
  },
  ".SUBCKT": {
    description: "Declara un bloque jerárquico o macromodelo reutilizable con terminales externos.",
    syntax: ".SUBCKT <SubcktName> <Pin1> <Pin2> ... <PinN>",
    example: ".SUBCKT OPAMP_IDEAL INP INN VOUT",
    snippet: ".SUBCKT ${1:MY_BLOCK} ${2:IN} ${3:OUT} ${4:0}\n  R1 2 3 1k\n.ENDS",
  },
  ".ENDS": {
    description: "Cierra la definición de un subcircuito .SUBCKT.",
    syntax: ".ENDS [SubcktName]",
    example: ".ENDS OPAMP_IDEAL",
    snippet: ".ENDS",
  },
  ".PARAM": {
    description: "Define constantes y fórmulas matemáticas globales evaluadas antes del análisis.",
    syntax: ".PARAM <Name>=<Expression>",
    example: ".PARAM R_LOAD=1k V_SUPPLY=5.0",
    snippet: ".PARAM ${1:R_VAL}=${2:1k}",
  },
  ".MEAS": {
    description: "Calcula métricas automáticas sobre curvas transitorias o de frecuencia (Rise/Fall time, THD, Ancho de Banda, Ganancia).",
    syntax: ".MEAS <TRAN|AC> <Name> <TRIG|FIND|MAX|MIN|AVG|RMS|THD> ...",
    example: ".MEAS TRAN trise TRIG V(out) VAL=0.5 RISE=1 TARG V(out) VAL=4.5 RISE=1",
    snippet: ".MEAS TRAN ${1:trise} TRIG V(${2:out}) VAL=0.5 RISE=1 TARG V(${2:out}) VAL=4.5 RISE=1",
  },
  ".INCLUDE": {
    description: "Incluye el contenido de un archivo netlist o librería externa.",
    syntax: ".INCLUDE <filepath>",
    example: ".INCLUDE ./models/transistors.lib",
    snippet: ".INCLUDE \"${1:models.lib}\"",
  },
  ".IC": {
    description: "Condiciones iniciales de tensión de nodo o corriente para análisis transitorio.",
    syntax: ".IC V(node)=<value>",
    example: ".IC V(1)=0 V(2)=5",
    snippet: ".IC V(${1:1})=${2:0}",
  },
  ".GLOBAL": {
    description: "Declara nodos globales compartidos a través de todos los niveles de jerarquía .SUBCKT.",
    syntax: ".GLOBAL <Node1> <Node2> ...",
    example: ".GLOBAL VCC GND",
    snippet: ".GLOBAL ${1:VCC} ${2:GND}",
  },
};

// ============================================================================
// 4. DESPACHADOR DE MENSAJES JSON-RPC (LSP PROTOCOL DISPATCHER)
// ============================================================================

export function handleLspMessage(rawMessage: string | Record<string, any>): Record<string, any> | null {
  const msg = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;

  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        capabilities: {
          textDocumentSync: 1, // Full
          completionProvider: {
            resolveProvider: false,
            triggerCharacters: [".", " ", "(", "{"],
          },
          hoverProvider: true,
        },
        serverInfo: {
          name: "astryd-spice-lsp",
          version: "1.0.0",
        },
      },
    };
  }

  if (method === "textDocument/didOpen" || method === "textDocument/didChange") {
    const text = params.textDocument?.text || params.contentChanges?.[0]?.text || "";
    const uri = params.textDocument?.uri || "";
    const diagnostics = validateSpiceDocument(text);
    return {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri,
        diagnostics,
      },
    };
  }

  if (method === "textDocument/hover") {
    const text = params.text || "";
    const position = params.position || { line: 0, character: 0 };
    const hover = getHoverInfo(text, position);
    return {
      jsonrpc: "2.0",
      id,
      result: hover,
    };
  }

  if (method === "textDocument/completion") {
    const text = params.text || "";
    const position = params.position || { line: 0, character: 0 };
    const completions = getCompletions(text, position);
    return {
      jsonrpc: "2.0",
      id,
      result: completions,
    };
  }

  return null;
}
