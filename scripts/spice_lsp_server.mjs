#!/usr/bin/env node

/**
 * Astryd Sophia — SPICE Language Server (JSON-RPC stdio)
 *
 * Servidor LSP ejecutable compatible con clientes de Language Server Protocol (VS Code, Neovim, Emacs, Helix).
 * Provee diagnóstico en vivo, autocompletado y hover para archivos .spice, .cir, .net, .mod, .lib y .astryd.
 */

// ============================================================================
// CATÁLOGO DE MODELOS COMERCIALES
// ============================================================================

const COMMERCIAL_DIODES = {
  "1N4148": { name: "1N4148", description: "Diodo de conmutación ultra-rápida (100V, 200mA, 4ns)", is: 2.52e-9, rs: 0.568, n: 1.752, cjo: 4.0e-12, tt: 5.7e-9, bv: 100.0, ibv: 1e-4, forwardVoltage: 0.72 },
  "1N4007": { name: "1N4007", description: "Diodo rectificador de potencia estándar (1000V, 1A)", is: 7.02e-9, rs: 0.034, n: 1.800, cjo: 15.0e-12, tt: 5.0e-6, bv: 1000.0, ibv: 5e-5, forwardVoltage: 0.75 },
  "1N4001": { name: "1N4001", description: "Diodo rectificador de propósito general (50V, 1A)", is: 5.0e-9, rs: 0.035, n: 1.750, cjo: 15.0e-12, tt: 5.0e-6, bv: 50.0, ibv: 5e-5, forwardVoltage: 0.73 },
  "1N5819": { name: "1N5819", description: "Diodo Schottky de baja caída directa (40V, 1A, VF~0.35V)", is: 3.17e-5, rs: 0.051, n: 1.050, cjo: 110.0e-12, tt: 1.0e-9, bv: 40.0, ibv: 1e-3, forwardVoltage: 0.36 },
  "BZX55C5V1": { name: "BZX55C5V1", description: "Diodo Zener regulador de tensión (5.1V, 500mW)", is: 1.0e-12, rs: 0.5, n: 1.1, cjo: 50.0e-12, bv: 5.1, ibv: 5e-3, forwardVoltage: 0.75 },
};

const COMMERCIAL_BJTS = {
  "2N2222": { name: "2N2222", polarity: "npn", description: "Transistor NPN de conmutación rápida y amplificación de propósito general (40V, 800mA)", is: 1.43e-14, bf: 255.9, vaf: 74.03, rb: 10, rc: 1 },
  "2N3904": { name: "2N3904", polarity: "npn", description: "Transistor NPN de propósito general para audio y pequeña señal (40V, 200mA)", is: 6.73e-15, bf: 416.4, vaf: 74.03, rb: 20, rc: 0.1 },
  "2N3906": { name: "2N3906", polarity: "pnp", description: "Transistor PNP complementario del 2N3904 para pequeña señal (40V, 200mA)", is: 1.41e-15, bf: 180.7, vaf: 18.7, rb: 20, rc: 0.1 },
  "BC547": { name: "BC547", polarity: "npn", description: "Transistor NPN europeo de bajo ruido para etapas de preamplificación (45V, 100mA)", is: 1.8e-14, bf: 400.0, vaf: 80.0, rb: 15, rc: 0.5 },
  "TIP120": { name: "TIP120", polarity: "npn", description: "Transistor Darlington NPN de potencia para cargas de alta corriente (60V, 5A)", is: 2.0e-12, bf: 1000.0, vaf: 100.0, rb: 50, rc: 0.05 },
};

const COMMERCIAL_MOSFETS = {
  "IRF540": { name: "IRF540", polarity: "nmos", description: "MOSFET N-Channel de potencia HEXFET (100V, 33A, 44mΩ)", vth: 3.5, ron: 0.044, cgs: 1700e-12, cgd: 120e-12 },
  "2N7000": { name: "2N7000", polarity: "nmos", description: "MOSFET N-Channel de pequeña señal (60V, 200mA, 5Ω)", vth: 2.1, ron: 5.0, cgs: 60e-12, cgd: 15e-12 },
  "BS170": { name: "BS170", polarity: "nmos", description: "MOSFET N-Channel para conmutación ultrarrápida (60V, 500mA, 5Ω)", vth: 2.0, ron: 5.0, cgs: 60e-12, cgd: 15e-12 },
};

const COMMERCIAL_OPAMPS = {
  "LM741": { name: "LM741", description: "Amplificador operacional de propósito general clásico (GBW=1MHz, SR=0.5V/µs)", aol: 200000, gbwHz: 1e6, slewRateVUs: 0.5, rin: 2e6, rout: 75, vos: 0.001 },
  "TL072": { name: "TL072", description: "Doble Amp-Op con entradas JFET de bajo ruido (GBW=3MHz, SR=13V/µs)", aol: 200000, gbwHz: 3e6, slewRateVUs: 13.0, rin: 1e12, rout: 100, vos: 0.003 },
  "NE555": { name: "NE555", description: "Temporizador / Oscilador monostable y astable analógico universal", aol: 100000, gbwHz: 2e6, slewRateVUs: 10.0, rin: 1e6, rout: 10, vos: 0.002 },
};

const SPICE_DIRECTIVE_DOCS = {
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
};

function parseSpiceValue(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return { valid: false };

  const match = /^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*([a-zA-ZΩµ]*)$/.exec(trimmed);
  if (!match) return { valid: false };

  const num = parseFloat(match[1]);
  if (!Number.isFinite(num)) return { valid: false };

  const suffix = match[2].toUpperCase();
  const validSuffixes = ["", "MEG", "T", "G", "K", "M", "U", "µ", "N", "P", "F", "OHM", "HZ", "V", "A", "S", "H"];
  for (const s of validSuffixes) {
    if (suffix.startsWith(s)) return { valid: true, value: num };
  }
  return { valid: false };
}

function validateSpiceDocument(text) {
  const diagnostics = [];
  const lines = text.split(/\r?\n/);

  let hasGround = false;
  const nodeReferences = new Map();
  const subcktStack = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("$")) continue;

    const tokens = trimmed.split(/\s+/);
    const firstToken = tokens[0];
    const firstChar = firstToken[0].toUpperCase();

    if (firstToken.startsWith(".")) {
      const directive = firstToken.toUpperCase();
      if (directive === ".SUBCKT") {
        if (tokens.length < 2) {
          diagnostics.push({
            range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
            severity: 1,
            source: "astryd-spice-lsp",
            message: "Sintaxis .SUBCKT incompleta.",
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
            message: "Directiva .ENDS huérfana.",
            code: "ERC_DANGLING_ENDS",
          });
        } else {
          subcktStack.pop();
        }
      }
      continue;
    }

    if (firstChar === "R" || firstChar === "C" || firstChar === "L") {
      if (tokens.length < 4) {
        diagnostics.push({
          range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
          severity: 1,
          source: "astryd-spice-lsp",
          message: `Definición incompleta para componente ${firstToken}.`,
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
            message: `Valor numérico SPICE no reconocido: '${valStr}'.`,
            code: "SPICE_INVALID_VALUE",
          });
        }
        recordNode(tokens[1]);
        recordNode(tokens[2]);
      }
    } else if (firstChar === "V" || firstChar === "I" || firstChar === "D") {
      if (tokens.length < (firstChar === "D" ? 4 : 3)) {
        diagnostics.push({
          range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: rawLine.length } },
          severity: 1,
          source: "astryd-spice-lsp",
          message: `Definición incompleta para ${firstToken}.`,
          code: firstChar === "D" ? "SPICE_DIODE_SYNTAX" : "SPICE_SOURCE_SYNTAX",
        });
      } else {
        recordNode(tokens[1]);
        recordNode(tokens[2]);
      }
    }
  }

  if (subcktStack.length > 0) {
    diagnostics.push({
      range: { start: { line: lines.length - 1, character: 0 }, end: { line: lines.length - 1, character: 1 } },
      severity: 1,
      source: "astryd-spice-lsp",
      message: `Bloque .SUBCKT [${subcktStack.join(", ")}] sin cerrar.`,
      code: "ERC_UNCLOSED_SUBCKT",
    });
  }

  if (lines.some(l => l.trim() && !l.trim().startsWith("*")) && !hasGround) {
    diagnostics.push({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: Math.max(1, lines[0].length) } },
      severity: 2,
      source: "astryd-spice-lsp",
      message: "Referencia a Tierra (Nodo '0' o 'GND') no encontrada.",
      code: "ERC_NO_GND",
    });
  }

  function recordNode(nodeStr) {
    if (!nodeStr) return;
    const clean = nodeStr.trim();
    if (clean === "0" || clean.toUpperCase() === "GND") hasGround = true;
    else nodeReferences.set(clean, (nodeReferences.get(clean) || 0) + 1);
  }

  return diagnostics;
}

function getHoverInfo(text, position) {
  const lines = text.split(/\r?\n/);
  if (position.line >= lines.length) return null;

  const line = lines[position.line];
  const match = findWord(line, position.character);
  if (!match) return null;

  const word = match.word;
  const upper = word.toUpperCase();

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

  const firstChar = upper[0];
  if (/^[RCLVDIQMX][0-9A-Z_]*$/i.test(word)) {
    const typeDescriptions = {
      R: "Resistor (Resistencia eléctrica [Ω])",
      C: "Capacitor (Capacidad [F])",
      L: "Inductor (Autoinducción [H])",
      V: "Fuente de Tensión (Voltios [V])",
      I: "Fuente de Corriente (Amperios [A])",
      D: "Diodo Semiconductor",
      Q: "Transistor BJT",
      M: "MOSFET",
      X: "Instancia de Subcircuito",
    };
    return {
      contents: {
        kind: "markdown",
        value: `### Componente \`${word}\`\n\n**Tipo:** ${typeDescriptions[firstChar] || "Componente SPICE"}`,
      },
    };
  }

  const diode = COMMERCIAL_DIODES[upper];
  if (diode) {
    return {
      contents: {
        kind: "markdown",
        value: `### Diodo \`${diode.name}\`\n\n${diode.description}`,
      },
    };
  }

  const bjt = COMMERCIAL_BJTS[upper];
  if (bjt) {
    return {
      contents: {
        kind: "markdown",
        value: `### Transistor BJT \`${bjt.name}\`\n\n${bjt.description}`,
      },
    };
  }

  const mos = COMMERCIAL_MOSFETS[upper];
  if (mos) {
    return {
      contents: {
        kind: "markdown",
        value: `### MOSFET \`${mos.name}\`\n\n${mos.description}`,
      },
    };
  }

  return null;
}

function findWord(line, charIndex) {
  let start = charIndex;
  while (start > 0 && /[A-Za-z0-9_.\-]/.test(line[start - 1])) start--;
  let end = charIndex;
  while (end < line.length && /[A-Za-z0-9_.\-]/.test(line[end])) end++;
  if (start === end) return null;
  return { word: line.substring(start, end) };
}

function getCompletions(text, position) {
  const lines = text.split(/\r?\n/);
  const line = lines[position.line] || "";
  const prefix = line.substring(0, position.character).trimStart();
  const items = [];

  if (prefix.startsWith(".") || prefix === "") {
    for (const [dir, doc] of Object.entries(SPICE_DIRECTIVE_DOCS)) {
      items.push({
        label: dir,
        kind: 14,
        detail: doc.syntax,
        insertText: doc.snippet || dir,
        insertTextFormat: doc.snippet ? 2 : 1,
      });
    }
  }

  if (!prefix.startsWith(".")) {
    items.push(
      { label: "Resistor", kind: 15, insertText: "R${1:1} ${2:in} ${3:out} ${4:1k}", insertTextFormat: 2 },
      { label: "Capacitor", kind: 15, insertText: "C${1:1} ${2:in} ${3:0} ${4:100n}", insertTextFormat: 2 },
      { label: "Inductor", kind: 15, insertText: "L${1:1} ${2:in} ${3:out} ${4:10u}", insertTextFormat: 2 },
      { label: "Voltage Source DC", kind: 15, insertText: "V${1:1} ${2:vcc} ${3:0} DC ${4:5}", insertTextFormat: 2 }
    );
    for (const d of Object.values(COMMERCIAL_DIODES)) items.push({ label: d.name, kind: 7, detail: d.description });
    for (const b of Object.values(COMMERCIAL_BJTS)) items.push({ label: b.name, kind: 7, detail: b.description });
    for (const m of Object.values(COMMERCIAL_MOSFETS)) items.push({ label: m.name, kind: 7, detail: m.description });
    for (const op of Object.values(COMMERCIAL_OPAMPS)) items.push({ label: op.name, kind: 7, detail: op.description });
  }

  return items;
}

// ============================================================================
// PROTOCOLO JSON-RPC STDIO
// ============================================================================

let buffer = "";
const documentMap = new Map();

function sendLspMessage(obj) {
  const json = JSON.stringify(obj);
  const header = `Content-Length: ${Buffer.byteLength(json, "utf-8")}\r\n\r\n`;
  process.stdout.write(header + json);
}

process.stdin.setEncoding("utf-8");

process.stdin.on("data", (chunk) => {
  buffer += chunk;

  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const header = buffer.substring(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.substring(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;

    if (buffer.length < bodyStart + contentLength) {
      break;
    }

    const body = buffer.substring(bodyStart, bodyStart + contentLength);
    buffer = buffer.substring(bodyStart + contentLength);

    try {
      const msg = JSON.parse(body);
      processMessage(msg);
    } catch (err) {}
  }
});

function processMessage(msg) {
  const method = msg.method;
  const id = msg.id;
  const params = msg.params || {};

  if (method === "initialize") {
    sendLspMessage({
      jsonrpc: "2.0",
      id,
      result: {
        capabilities: {
          textDocumentSync: 1,
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
    });
    return;
  }

  if (method === "textDocument/didOpen") {
    const uri = params.textDocument?.uri || "";
    const text = params.textDocument?.text || "";
    documentMap.set(uri, text);
    const diagnostics = validateSpiceDocument(text);
    sendLspMessage({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, diagnostics },
    });
    return;
  }

  if (method === "textDocument/didChange") {
    const uri = params.textDocument?.uri || "";
    const text = params.contentChanges?.[0]?.text || "";
    documentMap.set(uri, text);
    const diagnostics = validateSpiceDocument(text);
    sendLspMessage({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, diagnostics },
    });
    return;
  }

  if (method === "textDocument/hover") {
    const uri = params.textDocument?.uri || "";
    const text = documentMap.get(uri) || "";
    const hover = getHoverInfo(text, params.position || { line: 0, character: 0 });
    sendLspMessage({
      jsonrpc: "2.0",
      id,
      result: hover,
    });
    return;
  }

  if (method === "textDocument/completion") {
    const uri = params.textDocument?.uri || "";
    const text = documentMap.get(uri) || "";
    const completions = getCompletions(text, params.position || { line: 0, character: 0 });
    sendLspMessage({
      jsonrpc: "2.0",
      id,
      result: completions,
    });
    return;
  }
}
