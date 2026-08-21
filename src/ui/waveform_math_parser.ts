import { parseSpiceValue } from "../simulation/spice_value_parser";
import type { TimeStepResult } from "./oscilloscope_panel";

export type WaveformMathTokenType =
  | "NUMBER"
  | "CHANNEL"
  | "IDENTIFIER"
  | "PLUS"
  | "MINUS"
  | "MUL"
  | "DIV"
  | "POW"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "EOF";

export interface WaveformMathToken {
  type: WaveformMathTokenType;
  value: string;
  numValue?: number;
}

export type WaveformAstNode =
  | { type: "NUMBER"; value: number }
  | { type: "CHANNEL"; channel: "ch1" | "ch2" | "ch3" | "ch4"; rawNode?: string }
  | { type: "NODE_VOLTAGE"; node: string }
  | { type: "UNARY_OP"; op: "-" | "+"; right: WaveformAstNode }
  | { type: "BINARY_OP"; op: "+" | "-" | "*" | "/" | "^"; left: WaveformAstNode; right: WaveformAstNode }
  | { type: "FUNCTION_CALL"; name: string; args: WaveformAstNode[] };

/**
 * Tokenizador léxico para expresiones de osciloscopio.
 */
export function tokenizeWaveformMath(expression: string): WaveformMathToken[] {
  const tokens: WaveformMathToken[] = [];
  let index = 0;
  const len = expression.length;

  while (index < len) {
    const char = expression[index];

    // Ignorar espacios en blanco
    if (/\s/.test(char)) {
      index++;
      continue;
    }

    // Operadores y delimitadores simples
    if (char === "+") {
      tokens.push({ type: "PLUS", value: "+" });
      index++;
      continue;
    }
    if (char === "-") {
      tokens.push({ type: "MINUS", value: "-" });
      index++;
      continue;
    }
    if (char === "*") {
      tokens.push({ type: "MUL", value: "*" });
      index++;
      continue;
    }
    if (char === "/") {
      tokens.push({ type: "DIV", value: "/" });
      index++;
      continue;
    }
    if (char === "^") {
      tokens.push({ type: "POW", value: "^" });
      index++;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "LPAREN", value: "(" });
      index++;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "RPAREN", value: ")" });
      index++;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "COMMA", value: "," });
      index++;
      continue;
    }

    // Números con prefijos y sufijos SPICE (ej: 10, 2.5, 1k, 100u, 5Meg, 1e-3)
    if (/\d/.test(char) || (char === "." && index + 1 < len && /\d/.test(expression[index + 1]))) {
      let numStr = "";
      while (index < len && /[0-9a-zA-Z._+-]/.test(expression[index])) {
        const c = expression[index];
        if ((c === "+" || c === "-") && numStr.length > 0 && !/[eE]$/.test(numStr)) {
          break;
        }
        numStr += c;
        index++;
      }

      const parsed = parseSpiceValue(numStr);
      if (parsed.valid && parsed.value !== undefined) {
        tokens.push({ type: "NUMBER", value: numStr, numValue: parsed.value });
      } else {
        const num = parseFloat(numStr);
        tokens.push({ type: "NUMBER", value: numStr, numValue: Number.isFinite(num) ? num : 0 });
      }
      continue;
    }

    // Identificadores, canales (CH1..CH4), funciones (FFT, DERIV, INTEG, SIN, etc.) y nodos V(...)
    if (/[a-zA-Z_]/.test(char)) {
      let ident = "";
      while (index < len && /[a-zA-Z0-9_]/.test(expression[index])) {
        ident += expression[index];
        index++;
      }

      const upper = ident.toUpperCase();
      if (upper === "CH1" || upper === "CH2" || upper === "CH3" || upper === "CH4") {
        tokens.push({ type: "CHANNEL", value: upper });
      } else {
        tokens.push({ type: "IDENTIFIER", value: upper });
      }
      continue;
    }

    index++;
  }

  tokens.push({ type: "EOF", value: "" });
  return tokens;
}

/**
 * Parser de descenso recursivo para construir el AST matemático.
 */
export class WaveformMathParser {
  private tokens: WaveformMathToken[] = [];
  private current = 0;

  constructor(expression: string) {
    this.tokens = tokenizeWaveformMath(expression);
  }

  public parse(): WaveformAstNode {
    if (this.tokens.length === 0 || this.peek().type === "EOF") {
      return {
        type: "BINARY_OP",
        op: "-",
        left: { type: "CHANNEL", channel: "ch1" },
        right: { type: "CHANNEL", channel: "ch2" },
      };
    }
    const node = this.parseExpression();
    return node;
  }

  private peek(): WaveformMathToken {
    return this.tokens[this.current] || { type: "EOF", value: "" };
  }

  private advance(): WaveformMathToken {
    const tok = this.peek();
    if (tok.type !== "EOF") this.current++;
    return tok;
  }

  private match(...types: WaveformMathTokenType[]): boolean {
    const currentType = this.peek().type;
    if (types.includes(currentType)) {
      this.advance();
      return true;
    }
    return false;
  }

  private parseExpression(): WaveformAstNode {
    return this.parseAdditionSubtraction();
  }

  private parseAdditionSubtraction(): WaveformAstNode {
    let expr = this.parseMultiplicationDivision();

    while (this.peek().type === "PLUS" || this.peek().type === "MINUS") {
      const op = this.advance().value as "+" | "-";
      const right = this.parseMultiplicationDivision();
      expr = { type: "BINARY_OP", op, left: expr, right };
    }

    return expr;
  }

  private parseMultiplicationDivision(): WaveformAstNode {
    let expr = this.parsePower();

    while (this.peek().type === "MUL" || this.peek().type === "DIV") {
      const op = this.advance().value as "*" | "/";
      const right = this.parsePower();
      expr = { type: "BINARY_OP", op, left: expr, right };
    }

    return expr;
  }

  private parsePower(): WaveformAstNode {
    let expr = this.parseUnary();

    while (this.peek().type === "POW") {
      this.advance();
      const right = this.parseUnary();
      expr = { type: "BINARY_OP", op: "^", left: expr, right };
    }

    return expr;
  }

  private parseUnary(): WaveformAstNode {
    if (this.peek().type === "MINUS") {
      this.advance();
      const right = this.parseUnary();
      return { type: "UNARY_OP", op: "-", right };
    }
    if (this.peek().type === "PLUS") {
      this.advance();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): WaveformAstNode {
    const token = this.peek();

    if (token.type === "NUMBER") {
      this.advance();
      return { type: "NUMBER", value: token.numValue ?? 0 };
    }

    if (token.type === "CHANNEL") {
      this.advance();
      const ch = token.value.toLowerCase() as "ch1" | "ch2" | "ch3" | "ch4";
      return { type: "CHANNEL", channel: ch };
    }

    if (token.type === "IDENTIFIER") {
      const name = this.advance().value;

      if (this.peek().type === "LPAREN") {
        this.advance(); // consume '('
        const args: WaveformAstNode[] = [];

        if (this.peek().type !== "RPAREN") {
          args.push(this.parseExpression());
          while (this.match("COMMA")) {
            args.push(this.parseExpression());
          }
        }

        if (this.peek().type === "RPAREN") {
          this.advance();
        }

        if (name === "V" && args.length === 1) {
          const firstArg = args[0];
          if (firstArg.type === "CHANNEL") {
            return firstArg;
          }
        }

        return { type: "FUNCTION_CALL", name, args };
      }

      return { type: "NODE_VOLTAGE", node: name };
    }

    if (token.type === "LPAREN") {
      this.advance();
      const expr = this.parseExpression();
      if (this.peek().type === "RPAREN") {
        this.advance();
      }
      return expr;
    }

    this.advance();
    return { type: "NUMBER", value: 0 };
  }
}

export interface WaveformChannelBinding {
  ch1Node: string | null;
  ch2Node: string | null;
  ch3Node: string | null;
  ch4Node: string | null;
}

export function evaluateWaveformMath(
  expression: string,
  results: readonly TimeStepResult[],
  bindings: WaveformChannelBinding,
): Float64Array {
  const count = results.length;
  if (count === 0) return new Float64Array(0);

  let ast: WaveformAstNode;
  try {
    const parser = new WaveformMathParser(expression);
    ast = parser.parse();
  } catch {
    ast = {
      type: "BINARY_OP",
      op: "-",
      left: { type: "CHANNEL", channel: "ch1" },
      right: { type: "CHANNEL", channel: "ch2" },
    };
  }

  return evaluateAstNode(ast, results, bindings);
}

function evaluateAstNode(
  node: WaveformAstNode,
  results: readonly TimeStepResult[],
  bindings: WaveformChannelBinding,
): Float64Array {
  const count = results.length;
  const output = new Float64Array(count);

  switch (node.type) {
    case "NUMBER": {
      output.fill(node.value);
      return output;
    }

    case "CHANNEL": {
      let targetNode: string | null = null;
      if (node.channel === "ch1") targetNode = bindings.ch1Node;
      else if (node.channel === "ch2") targetNode = bindings.ch2Node;
      else if (node.channel === "ch3") targetNode = bindings.ch3Node;
      else if (node.channel === "ch4") targetNode = bindings.ch4Node;

      for (let i = 0; i < count; i++) {
        output[i] = targetNode ? (results[i].nodeVoltages[targetNode] ?? 0) : 0;
      }
      return output;
    }

    case "NODE_VOLTAGE": {
      const nodeName = node.node;
      for (let i = 0; i < count; i++) {
        output[i] = results[i].nodeVoltages[nodeName] ?? 0;
      }
      return output;
    }

    case "UNARY_OP": {
      const inner = evaluateAstNode(node.right, results, bindings);
      if (node.op === "-") {
        for (let i = 0; i < count; i++) {
          output[i] = -inner[i];
        }
      } else {
        output.set(inner);
      }
      return output;
    }

    case "BINARY_OP": {
      const left = evaluateAstNode(node.left, results, bindings);
      const right = evaluateAstNode(node.right, results, bindings);

      switch (node.op) {
        case "+":
          for (let i = 0; i < count; i++) output[i] = left[i] + right[i];
          break;
        case "-":
          for (let i = 0; i < count; i++) output[i] = left[i] - right[i];
          break;
        case "*":
          for (let i = 0; i < count; i++) output[i] = left[i] * right[i];
          break;
        case "/":
          for (let i = 0; i < count; i++) {
            const r = right[i];
            output[i] = Math.abs(r) < 1e-18 ? 0 : left[i] / r;
          }
          break;
        case "^":
          for (let i = 0; i < count; i++) output[i] = Math.pow(left[i], right[i]);
          break;
      }
      return output;
    }

    case "FUNCTION_CALL": {
      const fnName = node.name.toUpperCase();
      const evaluatedArgs = node.args.map((a) => evaluateAstNode(a, results, bindings));
      const arg0 = evaluatedArgs[0] || new Float64Array(count);

      if (fnName === "DERIV" || fnName === "D") {
        if (count >= 2) {
          const dt0 = Math.max(1e-15, results[1].time - results[0].time);
          output[0] = (arg0[1] - arg0[0]) / dt0;

          for (let i = 1; i < count - 1; i++) {
            const dt = Math.max(1e-15, results[i + 1].time - results[i - 1].time);
            output[i] = (arg0[i + 1] - arg0[i - 1]) / dt;
          }

          const dtN = Math.max(1e-15, results[count - 1].time - results[count - 2].time);
          output[count - 1] = (arg0[count - 1] - arg0[count - 2]) / dtN;
        }
        return output;
      }

      if (fnName === "INTEG" || fnName === "INT") {
        let accum = 0;
        output[0] = 0;
        for (let i = 1; i < count; i++) {
          const dt = results[i].time - results[i - 1].time;
          const avgV = (arg0[i] + arg0[i - 1]) / 2;
          accum += avgV * dt;
          output[i] = accum;
        }
        return output;
      }

      if (fnName === "FFT") {
        return computeFftMagnitudeWaveform(arg0);
      }

      if (fnName === "ABS") {
        for (let i = 0; i < count; i++) output[i] = Math.abs(arg0[i]);
        return output;
      }

      if (fnName === "SQRT") {
        for (let i = 0; i < count; i++) output[i] = Math.sqrt(Math.max(0, arg0[i]));
        return output;
      }

      if (fnName === "SIN") {
        for (let i = 0; i < count; i++) output[i] = Math.sin(arg0[i]);
        return output;
      }

      if (fnName === "COS") {
        for (let i = 0; i < count; i++) output[i] = Math.cos(arg0[i]);
        return output;
      }

      if (fnName === "TAN") {
        for (let i = 0; i < count; i++) output[i] = Math.tan(arg0[i]);
        return output;
      }

      if (fnName === "EXP") {
        for (let i = 0; i < count; i++) output[i] = Math.exp(Math.min(50, arg0[i]));
        return output;
      }

      if (fnName === "LN" || fnName === "LOG") {
        for (let i = 0; i < count; i++) output[i] = Math.log(Math.max(1e-18, arg0[i]));
        return output;
      }

      if (fnName === "LOG10") {
        for (let i = 0; i < count; i++) output[i] = Math.log10(Math.max(1e-18, arg0[i]));
        return output;
      }

      if (fnName === "AVG") {
        let sum = 0;
        for (let i = 0; i < count; i++) sum += arg0[i];
        const avg = sum / (count || 1);
        output.fill(avg);
        return output;
      }

      if (fnName === "RMS") {
        let sumSq = 0;
        for (let i = 0; i < count; i++) sumSq += arg0[i] * arg0[i];
        const rms = Math.sqrt(sumSq / (count || 1));
        output.fill(rms);
        return output;
      }

      if (fnName === "MIN" && evaluatedArgs.length >= 2) {
        const arg1 = evaluatedArgs[1];
        for (let i = 0; i < count; i++) output[i] = Math.min(arg0[i], arg1[i]);
        return output;
      }

      if (fnName === "MAX" && evaluatedArgs.length >= 2) {
        const arg1 = evaluatedArgs[1];
        for (let i = 0; i < count; i++) output[i] = Math.max(arg0[i], arg1[i]);
        return output;
      }

      output.set(arg0);
      return output;
    }
  }
}

function computeFftMagnitudeWaveform(input: Float64Array): Float64Array {
  const n = input.length;
  const output = new Float64Array(n);
  if (n < 4) return output;

  let m = 1;
  while (m * 2 <= n && m < 1024) m *= 2;

  const real = new Float64Array(m);
  const imag = new Float64Array(m);

  for (let i = 0; i < m; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (m - 1)));
    real[i] = input[i] * w;
    imag[i] = 0;
  }

  let j = 0;
  for (let i = 0; i < m - 1; i++) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
    let k = m >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (let len = 2; len <= m; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < m; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < half; k++) {
        const tr = wr * real[i + k + half] - wi * imag[i + k + half];
        const ti = wr * imag[i + k + half] + wi * real[i + k + half];

        real[i + k + half] = real[i + k] - tr;
        imag[i + k + half] = imag[i + k] - ti;
        real[i + k] += tr;
        imag[i + k] += ti;

        const nextWr = wr * wStepR - wi * wStepI;
        wi = wr * wStepI + wi * wStepR;
        wr = nextWr;
      }
    }
  }

  const scale = 2 / m;
  const halfM = m / 2;
  for (let i = 0; i < n; i++) {
    const freqIdx = Math.min(halfM - 1, Math.floor((i / n) * halfM));
    const mag = Math.sqrt(real[freqIdx] * real[freqIdx] + imag[freqIdx] * imag[freqIdx]) * scale;
    output[i] = mag;
  }

  return output;
}
