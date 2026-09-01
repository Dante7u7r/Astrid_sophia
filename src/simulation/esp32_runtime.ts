// ==========================================================================
// ESP32 HARDWARE RUNTIME & RESTRICTED ARDUINO SKETCH INTERPRETER
// ==========================================================================

export type Esp32PinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP" | "INPUT_PULLDOWN";

export interface LedcChannel {
  channel: number;
  freq: number;
  resolutionBits: number;
  duty: number; // 0 a (2^res - 1)
  attachedPin: number | null; // GPIO number
}

export interface Esp32RuntimeState {
  // 1. Estado de los GPIO (por número de GPIO)
  pinModes: Record<number, Esp32PinMode>;
  digitalOutputs: Record<number, number>; // 0 o 1
  analogInputs: Record<number, number>; // 0 a 4095 (12 bits)
  dacOutputs: Record<number, number>; // 0 a 255 (8 bits en GPIO25/26)

  // 2. Controlador PWM LEDC (16 canales)
  ledcChannels: LedcChannel[];

  // 3. Monitor Serie (UART0)
  serialTxBuffer: string[];
  serialRxBuffer: string[];
  baudRate: number;

  // 4. Temporizadores y estado de simulación
  timeMicros: number;
  lastLoopMicros: number;
  loopIntervalMicros: number;
  isRunning: boolean;
  hasSetupRun: boolean;

  // 5. Código fuente y funciones de usuario compiladas
  sourceCode: string;
  setupFn: (() => void) | null;
  loopFn: (() => void) | null;
  errorMessage: string | null;
}

// Mapeo de número de Pin físico del DevKit (0..29) a número de GPIO
export const DEVKIT_INDEX_TO_GPIO: Record<number, number | null> = {
  0: null, // 3V3
  1: null, // EN
  2: 36,   // VP / IO36
  3: 39,   // VN / IO39
  4: 34,   // IO34
  5: 35,   // IO35
  6: 32,   // IO32
  7: 33,   // IO33
  8: 25,   // IO25 (DAC1)
  9: 26,   // IO26 (DAC2)
  10: 27,  // IO27
  11: 14,  // IO14
  12: 12,  // IO12
  13: null,// GND
  14: 13,  // IO13

  15: null,// VIN
  16: null,// GND
  17: 23,  // IO23
  18: 22,  // IO22
  19: 1,   // TX0 / IO1
  20: 3,   // RX0 / IO3
  21: 21,  // IO21
  22: null,// GND
  23: 19,  // IO19
  24: 18,  // IO18
  25: 5,   // IO5
  26: 17,  // IO17
  27: 16,  // IO16
  28: 4,   // IO4
  29: 2,   // IO2 (LED Onboard)
};

export function createEsp32Runtime(initialCode?: string): Esp32RuntimeState {
  const ledcChannels: LedcChannel[] = [];
  for (let i = 0; i < 16; i++) {
    ledcChannels.push({
      channel: i,
      freq: 5000,
      resolutionBits: 8,
      duty: 0,
      attachedPin: null,
    });
  }

  const defaultSketch = initialCode || `
// Sketch ESP32 Arduino - Blink & Serial Telemetry
int ledPin = 2; // LED Onboard
int sensorPin = 34; // Entrada analógica

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(115200);
  Serial.println("ESP32 Inicializado correctamente.");
}

void loop() {
  digitalWrite(ledPin, HIGH);
  int val = analogRead(sensorPin);
  Serial.print("Lectura Sensor: ");
  Serial.println(val);
  delay(500);
  
  digitalWrite(ledPin, LOW);
  delay(500);
}
`;

  const state: Esp32RuntimeState = {
    pinModes: {},
    digitalOutputs: {},
    analogInputs: {},
    dacOutputs: {},
    ledcChannels,
    serialTxBuffer: [],
    serialRxBuffer: [],
    baudRate: 115200,
    timeMicros: 0,
    lastLoopMicros: 0,
    loopIntervalMicros: 10000, // 10ms por iteración de loop por defecto
    isRunning: true,
    hasSetupRun: false,
    sourceCode: defaultSketch,
    setupFn: null,
    loopFn: null,
    errorMessage: null,
  };

  compileEsp32Sketch(state, defaultSketch);
  return state;
}

const ESP32_RUNTIME_BY_OWNER = new WeakMap<object, Esp32RuntimeState>();

/**
 * Mantiene el estado efímero fuera del objeto serializable del componente.
 * Así no se filtran closures del intérprete a los archivos de circuito.
 */
export function getOrCreateEsp32Runtime(owner: object, initialCode?: string): Esp32RuntimeState {
  const existing = ESP32_RUNTIME_BY_OWNER.get(owner);
  if (existing) return existing;
  const runtime = createEsp32Runtime(initialCode);
  ESP32_RUNTIME_BY_OWNER.set(owner, runtime);
  return runtime;
}

type SketchValue = number | string | boolean;

type Expression =
  | { kind: "literal"; value: SketchValue }
  | { kind: "identifier"; name: string }
  | { kind: "call"; name: string; args: Expression[] }
  | { kind: "unary"; operator: "+" | "-" | "!"; operand: Expression }
  | {
    kind: "binary";
    operator: "+" | "-" | "*" | "/" | "%" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "&&" | "||";
    left: Expression;
    right: Expression;
  };

type Statement =
  | { kind: "declare"; name: string; initializer?: Expression }
  | { kind: "assign"; name: string; operator: "=" | "+=" | "-="; value: Expression }
  | { kind: "increment"; name: string; delta: 1 | -1 }
  | { kind: "call"; call: Extract<Expression, { kind: "call" }> };

type Token = {
  kind: "number" | "string" | "identifier" | "operator" | "punctuation" | "eof";
  text: string;
  value?: SketchValue;
};

const SKETCH_CONSTANTS: Readonly<Record<string, SketchValue>> = {
  HIGH: 1,
  LOW: 0,
  INPUT: "INPUT",
  OUTPUT: "OUTPUT",
  INPUT_PULLUP: "INPUT_PULLUP",
  INPUT_PULLDOWN: "INPUT_PULLDOWN",
  true: true,
  false: false,
  PI: Math.PI,
};

const SUPPORTED_API_CALLS = new Set([
  "pinMode",
  "digitalWrite",
  "digitalRead",
  "analogRead",
  "dacWrite",
  "ledcSetup",
  "ledcAttachPin",
  "ledcWrite",
  "Serial.begin",
  "Serial.print",
  "Serial.println",
  "Serial.available",
  "Serial.read",
  "millis",
  "micros",
  "delay",
  "delayMicroseconds",
  "map",
  "constrain",
  "sq",
  "sin",
  "cos",
  "abs",
  "round",
  "floor",
  "ceil",
  "min",
  "max",
]);

const DECLARATION_PATTERN = /^(?:const\s+)?(?:(?:unsigned\s+)?(?:int|long|short)|float|double|char|bool|boolean|String)\s+([A-Za-z_]\w*)(?:\s*=\s*(.+))?$/s;
const ASSIGNMENT_PATTERN = /^([A-Za-z_]\w*)\s*(=|\+=|-=)\s*(.+)$/s;
const INCREMENT_PATTERN = /^([A-Za-z_]\w*)\s*(\+\+|--)$/;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stripSketchComments(code: string): string {
  let output = "";
  let index = 0;
  let quote: string | null = null;

  while (index < code.length) {
    const char = code[index];
    const next = code[index + 1];
    if (quote) {
      output += char;
      if (char === "\\" && next !== undefined) {
        output += next;
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < code.length && code[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < code.length && !(code[index] === "*" && code[index + 1] === "/")) {
        output += code[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index >= code.length) throw new Error("Comentario de bloque sin cerrar.");
      index += 2;
      continue;
    }
    output += char;
    index += 1;
  }

  if (quote) throw new Error("Cadena de texto sin cerrar.");
  return output;
}

function findMatchingBrace(code: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < code.length; index += 1) {
    const char = code[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Bloque de función sin cerrar.");
}

function extractFunction(code: string, name: "setup" | "loop"): { body: string; remainder: string } {
  const signature = new RegExp(`\\bvoid\\s+${name}\\s*\\(\\s*\\)\\s*\\{`, "g");
  const matches = [...code.matchAll(signature)];
  if (matches.length !== 1 || matches[0].index === undefined) {
    throw new Error(`El sketch debe declarar exactamente una función void ${name}().`);
  }
  const start = matches[0].index;
  const open = code.indexOf("{", start);
  const close = findMatchingBrace(code, open);
  return {
    body: code.slice(open + 1, close),
    remainder: `${code.slice(0, start)} ${code.slice(close + 1)}`,
  };
}

function splitStatements(body: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let quote: string | null = null;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    else if ((char === "{" || char === "}") && parenDepth === 0) {
      throw new Error("if, for, while y bloques anidados todavía no están soportados.");
    } else if (char === ";" && parenDepth === 0) {
      const statement = body.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    if (parenDepth < 0) throw new Error("Paréntesis desbalanceados.");
  }

  if (quote || parenDepth !== 0) throw new Error("Expresión sin cerrar.");
  const tail = body.slice(start).trim();
  if (tail) statements.push(tail);
  if (statements.length > 256) throw new Error("El bloque excede el límite de 256 instrucciones.");
  return statements;
}

function tokenizeExpression(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") {
          const escaped = source[index + 1];
          if (escaped === undefined) throw new Error("Escape incompleto en cadena.");
          const replacements: Record<string, string> = { n: "\n", r: "\r", t: "\t" };
          value += replacements[escaped] ?? escaped;
          index += 2;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (source[index] !== quote) throw new Error("Cadena de texto sin cerrar.");
      index += 1;
      tokens.push({ kind: "string", text: value, value });
      continue;
    }
    const numberMatch = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numberMatch) {
      const value = Number(numberMatch[0]);
      tokens.push({ kind: "number", text: numberMatch[0], value });
      index += numberMatch[0].length;
      continue;
    }
    const identifierMatch = source.slice(index).match(/^[A-Za-z_]\w*/);
    if (identifierMatch) {
      tokens.push({ kind: "identifier", text: identifierMatch[0] });
      index += identifierMatch[0].length;
      continue;
    }
    const twoChar = source.slice(index, index + 2);
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(twoChar)) {
      tokens.push({ kind: "operator", text: twoChar });
      index += 2;
      continue;
    }
    if (["+", "-", "*", "/", "%", "<", ">", "!"].includes(char)) {
      tokens.push({ kind: "operator", text: char });
      index += 1;
      continue;
    }
    if (["(", ")", ",", "."].includes(char)) {
      tokens.push({ kind: "punctuation", text: char });
      index += 1;
      continue;
    }
    throw new Error(`Token no soportado en expresión: ${char}`);
  }
  tokens.push({ kind: "eof", text: "" });
  return tokens;
}

class ExpressionParser {
  private index = 0;

  public constructor(private readonly tokens: readonly Token[]) {}

  public parse(): Expression {
    const expression = this.parseLogicalOr();
    if (this.peek().kind !== "eof") {
      throw new Error(`Texto inesperado en expresión: ${this.peek().text}`);
    }
    return expression;
  }

  private peek(offset = 0): Token {
    return this.tokens[this.index + offset] ?? { kind: "eof", text: "" };
  }

  private consume(text?: string): Token {
    const token = this.peek();
    if (text !== undefined && token.text !== text) {
      throw new Error(`Se esperaba '${text}' y se encontró '${token.text}'.`);
    }
    this.index += 1;
    return token;
  }

  private parseLogicalOr(): Expression {
    return this.parseBinary(() => this.parseLogicalAnd(), ["||"]);
  }

  private parseLogicalAnd(): Expression {
    return this.parseBinary(() => this.parseEquality(), ["&&"]);
  }

  private parseEquality(): Expression {
    return this.parseBinary(() => this.parseComparison(), ["==", "!="]);
  }

  private parseComparison(): Expression {
    return this.parseBinary(() => this.parseAdditive(), ["<", "<=", ">", ">="]);
  }

  private parseAdditive(): Expression {
    return this.parseBinary(() => this.parseMultiplicative(), ["+", "-"]);
  }

  private parseMultiplicative(): Expression {
    return this.parseBinary(() => this.parseUnary(), ["*", "/", "%"]);
  }

  private parseBinary(next: () => Expression, operators: readonly string[]): Expression {
    let left = next();
    while (operators.includes(this.peek().text)) {
      const operator = this.consume().text as Extract<Expression, { kind: "binary" }>["operator"];
      left = { kind: "binary", operator, left, right: next() };
    }
    return left;
  }

  private parseUnary(): Expression {
    if (["+", "-", "!"].includes(this.peek().text)) {
      const operator = this.consume().text as Extract<Expression, { kind: "unary" }>["operator"];
      return { kind: "unary", operator, operand: this.parseUnary() };
    }
    if (
      this.peek().text === "("
      && this.peek(1).kind === "identifier"
      && ["int", "long", "float", "double", "bool"].includes(this.peek(1).text)
      && this.peek(2).text === ")"
    ) {
      this.consume("(");
      this.consume();
      this.consume(")");
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    const token = this.peek();
    if (token.kind === "number" || token.kind === "string") {
      this.consume();
      return { kind: "literal", value: token.value ?? 0 };
    }
    if (token.text === "(") {
      this.consume("(");
      const expression = this.parseLogicalOr();
      this.consume(")");
      return expression;
    }
    if (token.kind !== "identifier") {
      throw new Error(`Expresión no soportada cerca de '${token.text}'.`);
    }

    let name = this.consume().text;
    if (this.peek().text === ".") {
      this.consume(".");
      const member = this.consume();
      if (member.kind !== "identifier") throw new Error("Miembro inválido.");
      name += `.${member.text}`;
    }
    if (this.peek().text !== "(") return { kind: "identifier", name };

    this.consume("(");
    const args: Expression[] = [];
    if (this.peek().text !== ")") {
      do {
        args.push(this.parseLogicalOr());
        if (this.peek().text !== ",") break;
        this.consume(",");
      } while (true);
    }
    this.consume(")");
    return { kind: "call", name, args };
  }
}

function parseExpression(source: string): Expression {
  return new ExpressionParser(tokenizeExpression(source)).parse();
}

function parseStatement(source: string, allowCall = true): Statement {
  const declaration = source.match(DECLARATION_PATTERN);
  if (declaration) {
    return {
      kind: "declare",
      name: declaration[1],
      ...(declaration[2] ? { initializer: parseExpression(declaration[2]) } : {}),
    };
  }
  const assignment = source.match(ASSIGNMENT_PATTERN);
  if (assignment) {
    return {
      kind: "assign",
      name: assignment[1],
      operator: assignment[2] as "=" | "+=" | "-=",
      value: parseExpression(assignment[3]),
    };
  }
  const increment = source.match(INCREMENT_PATTERN);
  if (increment) {
    return { kind: "increment", name: increment[1], delta: increment[2] === "++" ? 1 : -1 };
  }
  if (allowCall) {
    const expression = parseExpression(source);
    if (expression.kind === "call") return { kind: "call", call: expression };
  }
  throw new Error(`Instrucción no soportada: ${source}`);
}

function validateExpression(
  expression: Expression,
  declaredVariables: ReadonlySet<string>,
  allowCalls: boolean,
): void {
  if (expression.kind === "literal") return;
  if (expression.kind === "identifier") {
    if (
      !declaredVariables.has(expression.name)
      && !Object.prototype.hasOwnProperty.call(SKETCH_CONSTANTS, expression.name)
    ) {
      throw new Error(`Identificador no definido: ${expression.name}.`);
    }
    return;
  }
  if (expression.kind === "call") {
    if (!allowCalls) {
      throw new Error("Los inicializadores globales no pueden invocar funciones.");
    }
    if (!SUPPORTED_API_CALLS.has(expression.name)) {
      throw new Error(`API no soportada: ${expression.name}.`);
    }
    expression.args.forEach(argument => validateExpression(argument, declaredVariables, allowCalls));
    return;
  }
  if (expression.kind === "unary") {
    validateExpression(expression.operand, declaredVariables, allowCalls);
    return;
  }
  validateExpression(expression.left, declaredVariables, allowCalls);
  validateExpression(expression.right, declaredVariables, allowCalls);
}

function validateStatements(
  statements: readonly Statement[],
  initialVariables: ReadonlySet<string>,
  allowCalls: boolean,
): Set<string> {
  const declaredVariables = new Set(initialVariables);
  for (const statement of statements) {
    if (statement.kind === "declare") {
      if (declaredVariables.has(statement.name)) {
        throw new Error(`Variable declarada más de una vez en el mismo alcance: ${statement.name}.`);
      }
      if (statement.initializer) {
        validateExpression(statement.initializer, declaredVariables, allowCalls);
      }
      declaredVariables.add(statement.name);
    } else if (statement.kind === "assign") {
      if (!declaredVariables.has(statement.name)) {
        throw new Error(`Asignación a variable no declarada: ${statement.name}.`);
      }
      validateExpression(statement.value, declaredVariables, allowCalls);
    } else if (statement.kind === "increment") {
      if (!declaredVariables.has(statement.name)) {
        throw new Error(`Incremento de variable no declarada: ${statement.name}.`);
      }
    } else {
      validateExpression(statement.call, declaredVariables, allowCalls);
    }
  }
  return declaredVariables;
}

function numeric(value: SketchValue, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context} requiere un número finito.`);
  }
  return value;
}

function executeApiCall(name: string, args: SketchValue[], state: Esp32RuntimeState): SketchValue {
  const numberArg = (index: number) => numeric(args[index] ?? 0, `${name} argumento ${index + 1}`);
  switch (name) {
    case "pinMode": {
      const pin = numberArg(0);
      const mode = args[1];
      if (mode !== "INPUT" && mode !== "OUTPUT" && mode !== "INPUT_PULLUP" && mode !== "INPUT_PULLDOWN") {
        throw new Error("pinMode recibió un modo no soportado.");
      }
      state.pinModes[pin] = mode;
      return 0;
    }
    case "digitalWrite":
      state.digitalOutputs[numberArg(0)] = numberArg(1) ? 1 : 0;
      return 0;
    case "digitalRead":
      return state.digitalOutputs[numberArg(0)] ?? 0;
    case "analogRead":
      return state.analogInputs[numberArg(0)] ?? 0;
    case "dacWrite":
      state.dacOutputs[numberArg(0)] = Math.max(0, Math.min(255, Math.round(numberArg(1))));
      return 0;
    case "ledcSetup": {
      const channel = numberArg(0);
      const target = state.ledcChannels[channel];
      if (!target) throw new Error(`Canal LEDC fuera de rango: ${channel}.`);
      target.freq = numberArg(1);
      target.resolutionBits = numberArg(2);
      return 0;
    }
    case "ledcAttachPin": {
      const pin = numberArg(0);
      const channel = numberArg(1);
      const target = state.ledcChannels[channel];
      if (!target) throw new Error(`Canal LEDC fuera de rango: ${channel}.`);
      target.attachedPin = pin;
      state.pinModes[pin] = "OUTPUT";
      return 0;
    }
    case "ledcWrite": {
      const channel = numberArg(0);
      const target = state.ledcChannels[channel];
      if (!target) throw new Error(`Canal LEDC fuera de rango: ${channel}.`);
      target.duty = numberArg(1);
      return 0;
    }
    case "Serial.begin":
      state.baudRate = numberArg(0);
      return 0;
    case "Serial.print":
      state.serialTxBuffer.push(String(args[0] ?? ""));
      return 0;
    case "Serial.println":
      state.serialTxBuffer.push(`${String(args[0] ?? "")}\n`);
      return 0;
    case "Serial.available":
      return state.serialRxBuffer.length;
    case "Serial.read": {
      const char = state.serialRxBuffer.shift();
      return char ? char.charCodeAt(0) : -1;
    }
    case "millis":
      return Math.floor(state.timeMicros / 1000);
    case "micros":
      return Math.floor(state.timeMicros);
    case "delay":
      state.timeMicros += Math.max(0, numberArg(0)) * 1000;
      return 0;
    case "delayMicroseconds":
      state.timeMicros += Math.max(0, numberArg(0));
      return 0;
    case "map": {
      const inputSpan = numberArg(2) - numberArg(1);
      if (inputSpan === 0) throw new Error("map no admite un rango de entrada nulo.");
      return ((numberArg(0) - numberArg(1)) * (numberArg(4) - numberArg(3))) / inputSpan + numberArg(3);
    }
    case "constrain":
      return Math.max(numberArg(1), Math.min(numberArg(2), numberArg(0)));
    case "sq":
      return numberArg(0) * numberArg(0);
    case "sin":
      return Math.sin(numberArg(0));
    case "cos":
      return Math.cos(numberArg(0));
    case "abs":
      return Math.abs(numberArg(0));
    case "round":
      return Math.round(numberArg(0));
    case "floor":
      return Math.floor(numberArg(0));
    case "ceil":
      return Math.ceil(numberArg(0));
    case "min":
      return Math.min(...args.map((value, index) => numeric(value, `min argumento ${index + 1}`)));
    case "max":
      return Math.max(...args.map((value, index) => numeric(value, `max argumento ${index + 1}`)));
    default:
      throw new Error(`API no soportada: ${name}.`);
  }
}

function evaluateExpression(
  expression: Expression,
  variables: Record<string, SketchValue>,
  state: Esp32RuntimeState,
): SketchValue {
  if (expression.kind === "literal") return expression.value;
  if (expression.kind === "identifier") {
    if (Object.prototype.hasOwnProperty.call(variables, expression.name)) return variables[expression.name];
    if (Object.prototype.hasOwnProperty.call(SKETCH_CONSTANTS, expression.name)) return SKETCH_CONSTANTS[expression.name];
    throw new Error(`Identificador no definido: ${expression.name}.`);
  }
  if (expression.kind === "call") {
    return executeApiCall(
      expression.name,
      expression.args.map(argument => evaluateExpression(argument, variables, state)),
      state,
    );
  }
  if (expression.kind === "unary") {
    const operand = evaluateExpression(expression.operand, variables, state);
    if (expression.operator === "!") return !operand;
    const value = numeric(operand, `Operador ${expression.operator}`);
    return expression.operator === "-" ? -value : value;
  }

  const left = evaluateExpression(expression.left, variables, state);
  if (expression.operator === "&&") return Boolean(left) && Boolean(evaluateExpression(expression.right, variables, state));
  if (expression.operator === "||") return Boolean(left) || Boolean(evaluateExpression(expression.right, variables, state));
  const right = evaluateExpression(expression.right, variables, state);
  if (expression.operator === "+" && (typeof left === "string" || typeof right === "string")) {
    return String(left) + String(right);
  }
  if (expression.operator === "==") return left === right;
  if (expression.operator === "!=") return left !== right;
  const a = numeric(left, `Operador ${expression.operator}`);
  const b = numeric(right, `Operador ${expression.operator}`);
  switch (expression.operator) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/":
      if (b === 0) throw new Error("División entre cero.");
      return a / b;
    case "%":
      if (b === 0) throw new Error("Módulo entre cero.");
      return a % b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    default: throw new Error(`Operador no soportado: ${expression.operator}.`);
  }
}

function executeStatements(
  statements: readonly Statement[],
  variables: Record<string, SketchValue>,
  state: Esp32RuntimeState,
): void {
  for (const statement of statements) {
    if (statement.kind === "declare") {
      variables[statement.name] = statement.initializer
        ? evaluateExpression(statement.initializer, variables, state)
        : 0;
    } else if (statement.kind === "assign") {
      if (!Object.prototype.hasOwnProperty.call(variables, statement.name)) {
        throw new Error(`Asignación a variable no declarada: ${statement.name}.`);
      }
      const value = evaluateExpression(statement.value, variables, state);
      if (statement.operator === "=") variables[statement.name] = value;
      else {
        const current = numeric(variables[statement.name], `Variable ${statement.name}`);
        variables[statement.name] = statement.operator === "+="
          ? current + numeric(value, `Asignación ${statement.name}`)
          : current - numeric(value, `Asignación ${statement.name}`);
      }
    } else if (statement.kind === "increment") {
      variables[statement.name] = numeric(variables[statement.name], `Variable ${statement.name}`) + statement.delta;
    } else {
      evaluateExpression(statement.call, variables, state);
    }
  }
}

/**
 * Analiza un subconjunto explícito de sketches Arduino y crea closures del intérprete.
 * El texto del usuario nunca se entrega al motor JavaScript (`eval`/`Function`).
 */
export function compileEsp32Sketch(state: Esp32RuntimeState, code: string): boolean {
  state.sourceCode = code;
  state.errorMessage = null;
  state.hasSetupRun = false;
  state.setupFn = null;
  state.loopFn = null;
  state.isRunning = false;

  try {
    if (code.length > 100_000) throw new Error("El sketch excede el límite de 100 kB.");
    const cleanCode = stripSketchComments(code);
    const setup = extractFunction(cleanCode, "setup");
    const loop = extractFunction(setup.remainder, "loop");
    if (/[#{}]/.test(loop.remainder)) {
      throw new Error("Directivas de preprocesador, clases y funciones auxiliares no están soportadas.");
    }

    const globalStatements = splitStatements(loop.remainder).map(statement => parseStatement(statement, false));
    if (globalStatements.some(statement => statement.kind !== "declare")) {
      throw new Error("Fuera de setup/loop solo se admiten declaraciones escalares.");
    }
    const setupStatements = splitStatements(setup.body).map(statement => parseStatement(statement));
    const loopStatements = splitStatements(loop.body).map(statement => parseStatement(statement));
    const globalNames = validateStatements(globalStatements, new Set(), false);
    validateStatements(setupStatements, globalNames, true);
    validateStatements(loopStatements, globalNames, true);
    const variables: Record<string, SketchValue> = {};
    executeStatements(globalStatements, variables, state);

    state.setupFn = () => executeStatements(setupStatements, variables, state);
    state.loopFn = () => executeStatements(loopStatements, variables, state);
    state.isRunning = true;
    return true;
  } catch (error: unknown) {
    state.errorMessage = `Sketch no soportado: ${errorText(error)}`;
    return false;
  }
}

/**
 * Avanza el estado del hardware del ESP32 un intervalo de tiempo dtSeconds.
 */
export function stepEsp32(
  state: Esp32RuntimeState,
  dtSeconds: number,
  analogVoltages: Record<number, number> = {},
): void {
  if (!state.isRunning) return;

  if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
    state.errorMessage = "El paso temporal del ESP32 debe ser finito y no negativo.";
    state.isRunning = false;
    return;
  }

  state.timeMicros += Math.round(dtSeconds * 1e6);

  // 1. Actualizar entradas analógicas ADC de los pines (0 a 3.3V -> 0 a 4095)
  for (const [gpioStr, v] of Object.entries(analogVoltages)) {
    const gpio = Number(gpioStr);
    const adcVal = Math.max(0, Math.min(4095, Math.round((v / 3.3) * 4095)));
    state.analogInputs[gpio] = adcVal;
  }

  // 2. Ejecutar setup() si aún no ha corrido
  if (!state.hasSetupRun && state.setupFn) {
    try {
      state.setupFn();
      state.hasSetupRun = true;
    } catch (error: unknown) {
      state.errorMessage = `Error en setup(): ${errorText(error)}`;
      state.isRunning = false;
      return;
    }
  }

  // 3. Ejecutar loop()
  if (state.hasSetupRun && state.loopFn) {
    try {
      state.loopFn();
    } catch (error: unknown) {
      state.errorMessage = `Error en loop(): ${errorText(error)}`;
      state.isRunning = false;
    }
  }
}

/**
 * Obtiene la tensión analógica calculada para cada pin físico del módulo DevKit (0 a 29).
 */
export function getEsp32DevKitPinVoltages(state: Esp32RuntimeState): Record<number, number> {
  const voltages: Record<number, number> = {
    0: 3.3,  // Pin 3V3
    13: 0.0, // GND
    15: 5.0, // VIN
    16: 0.0, // GND
    22: 0.0, // GND
  };

  for (let pinIdx = 0; pinIdx < 30; pinIdx++) {
    const gpio = DEVKIT_INDEX_TO_GPIO[pinIdx];
    if (gpio === null || gpio === undefined) continue;

    // Verificar si el pin tiene salida DAC activa (GPIO25/GPIO26)
    if ((gpio === 25 || gpio === 26) && state.dacOutputs[gpio] !== undefined) {
      voltages[pinIdx] = (state.dacOutputs[gpio] / 255.0) * 3.3;
      continue;
    }

    // Verificar si el pin está asignado a un canal PWM LEDC
    const ledc = state.ledcChannels.find((c) => c.attachedPin === gpio);
    if (ledc && ledc.duty > 0) {
      const maxDuty = Math.pow(2, ledc.resolutionBits) - 1;
      const dutyFraction = Math.min(1.0, ledc.duty / maxDuty);
      voltages[pinIdx] = dutyFraction * 3.3;
      continue;
    }

    // Salida Digital estándar
    if (state.pinModes[gpio] === "OUTPUT") {
      const isHigh = state.digitalOutputs[gpio] === 1;
      voltages[pinIdx] = isHigh ? 3.3 : 0.0;
    } else if (state.pinModes[gpio] === "INPUT_PULLUP") {
      voltages[pinIdx] = 3.3;
    } else {
      voltages[pinIdx] = 0.0;
    }
  }

  return voltages;
}
