import type { Point2D } from "../canvas_orchestrator";

export interface ParsedBusLabel {
  raw: string;
  baseName: string;
  isBus: boolean;
  isBusMember: boolean;
  start?: number;
  end?: number;
  index?: number;
  width: number;
  members: string[];
}

/**
 * Parsea una etiqueta de red vectorial o de bus (ej. "DATA[0:7]", "ADDR[15:0]", "BUS[0..7]", "DATA[3]", "DATA_3")
 */
export function parseBusLabel(label?: string): ParsedBusLabel {
  const trimmed = (label ?? "").trim();
  if (!trimmed) {
    return {
      raw: "",
      baseName: "",
      isBus: false,
      isBusMember: false,
      width: 1,
      members: [],
    };
  }

  // 1. Sintaxis de Rango Vectorial: NAME[START:END] o NAME[START..END]
  const busRangeRegex = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\[\s*(\d+)\s*(?::|\.\.)\s*(\d+)\s*\]$/;
  const rangeMatch = trimmed.match(busRangeRegex);

  if (rangeMatch) {
    const baseName = rangeMatch[1].toUpperCase();
    const start = Number.parseInt(rangeMatch[2], 10);
    const end = Number.parseInt(rangeMatch[3], 10);

    const step = start <= end ? 1 : -1;
    const count = Math.abs(end - start) + 1;
    const members: string[] = [];

    for (let i = 0; i < count; i++) {
      const idx = start + i * step;
      members.push(`${baseName}[${idx}]`);
    }

    return {
      raw: trimmed,
      baseName,
      isBus: true,
      isBusMember: false,
      start,
      end,
      width: count,
      members,
    };
  }

  // 2. Sintaxis de Miembro Indexado: NAME[INDEX] o NAME_INDEX (ej. DATA[3] o DATA_3)
  const memberBracketRegex = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\[\s*(\d+)\s*\]$/;
  const bracketMatch = trimmed.match(memberBracketRegex);
  if (bracketMatch) {
    const baseName = bracketMatch[1].toUpperCase();
    const index = Number.parseInt(bracketMatch[2], 10);
    return {
      raw: trimmed,
      baseName,
      isBus: false,
      isBusMember: true,
      index,
      width: 1,
      members: [`${baseName}[${index}]`],
    };
  }

  const memberUnderscoreRegex = /^([a-zA-Z_][a-zA-Z0-9]*)\_(\d+)$/;
  const underscoreMatch = trimmed.match(memberUnderscoreRegex);
  if (underscoreMatch) {
    const baseName = underscoreMatch[1].toUpperCase();
    const index = Number.parseInt(underscoreMatch[2], 10);
    return {
      raw: trimmed,
      baseName,
      isBus: false,
      isBusMember: true,
      index,
      width: 1,
      members: [`${baseName}[${index}]`],
    };
  }

  // 3. Etiqueta Escalar Estándar
  return {
    raw: trimmed,
    baseName: trimmed.toUpperCase(),
    isBus: false,
    isBusMember: false,
    width: 1,
    members: [trimmed.toUpperCase()],
  };
}

/**
 * Retorna la lista de nombres de señales individuales que componen la etiqueta.
 */
export function expandBusLabel(label?: string): string[] {
  return parseBusLabel(label).members;
}

/**
 * Comprueba si una etiqueta representa un bus vectorial [START:END].
 */
export function isBusLabel(label?: string): boolean {
  return parseBusLabel(label).isBus;
}

/**
 * Retorna el ancho en bits/líneas de la etiqueta.
 */
export function getBusWidth(label?: string): number {
  return parseBusLabel(label).width;
}

/**
 * Comprueba si un miembro individual (ej. "DATA[3]" o "DATA_3") pertenece a un bus (ej. "DATA[0:7]").
 */
export function matchBusMember(
  busLabel: string,
  memberLabel: string,
): { matches: boolean; bitIndex?: number } {
  const bus = parseBusLabel(busLabel);
  const member = parseBusLabel(memberLabel);

  if (!bus.isBus || !member.isBusMember) {
    return { matches: false };
  }

  if (bus.baseName !== member.baseName || member.index === undefined) {
    return { matches: false };
  }

  const minIdx = Math.min(bus.start ?? 0, bus.end ?? 0);
  const maxIdx = Math.max(bus.start ?? 0, bus.end ?? 0);

  if (member.index >= minIdx && member.index <= maxIdx) {
    return { matches: true, bitIndex: member.index };
  }

  return { matches: false };
}

/**
 * Dibuja la marca gráfica de slash diagonal (/N) que identifica un cable de bus en el canvas esquemático.
 */
export function drawBusSlash(
  ctx: CanvasRenderingContext2D,
  point: Point2D,
  width: number,
  strokeColor: string,
  angleRad = 0,
): void {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(angleRad);

  // Línea diagonal a 60 grados (Slash de bus EDA)
  const slashLen = 8;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-4, slashLen);
  ctx.lineTo(4, -slashLen);
  ctx.stroke();

  // Texto con el ancho de bits (ej. "8" o "/8")
  ctx.fillStyle = strokeColor;
  ctx.font = "bold 9px 'JetBrains Mono', monospace, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`${width}`, 6, -6);

  ctx.restore();
}
