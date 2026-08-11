/**
 * INTEGRATION-EXAMPLE.tsx
 *
 * Este archivo NO es un módulo más para copiar — es un ejemplo de cómo
 * los 8 módulos de assets/components/ colaboran dentro de un único
 * componente de esquemático interactivo, conectado a la arquitectura
 * real de Astryd Sophia: streaming transitorio vía evento Tauri
 * `sim-frame-update`, comandos `Result<T,String>`, y la convención de
 * naming NetId/WireId que coincide con las keys de
 * `SimulationFrame.node_voltages`/`branch_currents`.
 *
 * Flujo que demuestra:
 *   1. Usuario arrastra un componente -> CommandHistory agrupa el drag
 *      en una sola entrada de undo (command-history.ts)
 *   2. Usuario dibuja un wire -> wire-router.ts calcula la ruta ortogonal,
 *      net-graph.ts registra la conexión eléctrica y produce el NetId
 *      que el backend Rust debe usar para nombrar ese nodo en el MNA
 *   3. Usuario edita el valor de una resistencia -> spice-value-parser.ts
 *      valida y parsea "4.7k" a 4700 ohms
 *   4. Usuario inicia simulación transitoria -> transient-stream.ts
 *      escucha "sim-frame-update", voltage-color-scale.ts colorea
 *      los nets vía colorForNet(), current-flow-animation.tsx anima
 *      la corriente en wires vía currentForWire()
 *   5. Si el comando Tauri retorna Err(String) -> simulation-error.ts
 *      lo clasifica y resalta el nodo sospechoso si Rust lo interpoló
 *      en el mensaje
 *
 * Lo que este ejemplo SIMPLIFICA a propósito (no son gaps reales, son
 * recortes para que el archivo quepa en una skill):
 *   - Solo 2 resistencias, sin rotación/flip ni selección múltiple.
 *   - `pins` de ComponentInstance se asumen en offsets fijos (+1,0) y
 *     (0,0) relativos a la posición del componente — tu definición real
 *     de pines por tipo de componente seguramente vive en otro lugar
 *     (un catálogo de footprints/símbolos) y debe reemplazar a
 *     `getPinOffsets()` de abajo.
 *   - No incluye el flujo de co-simulación con MCU (mcu-runtime.ts) —
 *     fuera del alcance de esta skill de UX, pero el mismo
 *     SimulationFrame que consumes aquí es el que sincroniza estados
 *     lógicos de pines con el solver analógico en ese flujo también.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  NetGraph,
  GRID_STEP_PX,
  type PinRef,
  type NetWireRef,
  type GridPoint,
} from "./net-graph";
import { routeOrthogonal } from "./wire-router";
import {
  colorForNet,
  DEFAULT_VOLTAGE_SCALE,
  computeAutoRange,
  formatVoltageForDisplay,
} from "./voltage-color-scale";
import { parseSpiceValue, formatSpiceValue } from "./spice-value-parser";
import {
  CommandHistory,
  createMoveCommand,
  type ComponentStore,
} from "./command-history";
import { CurrentFlowAnimation } from "./current-flow-animation";
import {
  createTransientStreamListener,
  stopTransientSimulation,
  currentForWire,
  type SimulationFrame,
  type TransientStreamStatus,
} from "./transient-stream";
import {
  classifySimulationError,
  type ClassifiedSimulationError,
} from "./simulation-error";

// --- Tipos de dominio mínimos, nombrados para calzar con tu arquitectura ---
// real (ver desglose que diste de canvas_orchestrator.ts). En tu app esto
// ya existe — aquí solo se declara el subconjunto de campos que este
// ejemplo necesita tocar.

interface ComponentInstance {
  id: string;
  type: "resistor" | "capacitor" | "voltage-source";
  position: GridPoint;
  valueOhmsOrFaradsOrVolts: number;
}

interface WireInstance {
  id: string;
  fromComponentId: string;
  toComponentId: string;
  points: GridPoint[];
}

function gridToScreen(p: GridPoint): { x: number; y: number } {
  return { x: p.x * GRID_STEP_PX, y: p.y * GRID_STEP_PX };
}

/**
 * Offsets de pin relativos a la posición del componente, en unidades de
 * grid. Simplificación de ejemplo — en tu app real esto viene de la
 * definición de símbolo/footprint de cada tipo de componente, no de una
 * función hardcodeada como esta.
 */
function getPinOffsets(type: ComponentInstance["type"]): GridPoint[] {
  switch (type) {
    case "resistor":
      return [{ x: 0, y: 0 }, { x: 1, y: 0 }]; // pin 1 (izq), pin 2 (der)
    default:
      return [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  }
}

function toPinRefs(component: ComponentInstance): PinRef[] {
  return getPinOffsets(component.type).map((offset, i) => ({
    id: `${component.id}:${i + 1}`,
    componentId: component.id,
    position: { x: component.position.x + offset.x, y: component.position.y + offset.y },
  }));
}

function toNetWireRef(wire: WireInstance): NetWireRef {
  return { id: wire.id, points: wire.points };
}

/**
 * Componente de ejemplo: un esquemático minimalista con dos resistencias
 * y un wire entre ellas, mostrando edición de valor, wiring, simulación
 * transitoria real vía streaming, y manejo de error de convergencia —
 * todo conectado a través de los 8 módulos.
 */
export function SchematicCanvasExample() {
  const [components, setComponents] = useState<ComponentInstance[]>([
    { id: "R1", type: "resistor", position: { x: 2, y: 2 }, valueOhmsOrFaradsOrVolts: 4700 },
    { id: "R2", type: "resistor", position: { x: 8, y: 2 }, valueOhmsOrFaradsOrVolts: 10000 },
  ]);
  const [wires, setWires] = useState<WireInstance[]>([]);

  const [latestFrame, setLatestFrame] = useState<SimulationFrame | null>(null);
  const [streamStatus, setStreamStatus] = useState<TransientStreamStatus>("idle");
  const [simError, setSimError] = useState<ClassifiedSimulationError | null>(null);

  const netGraphRef = useRef(new NetGraph());
  const historyRef = useRef(new CommandHistory());
  const disposeListenerRef = useRef<(() => void) | null>(null);

  // Reconstruye NetGraph cada vez que cambia components/wires — ver
  // rebuildFromScratch() en net-graph.ts y la nota de integración al
  // inicio de ese archivo sobre por qué reconstruir es preferible a
  // mutación incremental sincronizada a mano.
  useEffect(() => {
    const pins = components.flatMap(toPinRefs);
    const netWireRefs = wires.map(toNetWireRef);
    netGraphRef.current.rebuildFromScratch(pins, netWireRefs);
  }, [components, wires]);

  // Limpieza del listener de streaming al desmontar — ver advertencia en
  // transient-stream.ts sobre por qué SIEMPRE hay que llamar dispose().
  useEffect(() => {
    return () => {
      disposeListenerRef.current?.();
    };
  }, []);

  const store: ComponentStore = {
    getPosition: (id) => components.find((c) => c.id === id)?.position ?? { x: 0, y: 0 },
    setPosition: (id, position) => {
      setComponents((prev) => prev.map((c) => (c.id === id ? { ...c, position } : c)));
    },
    getValue: (id) => {
      const c = components.find((c) => c.id === id);
      return c ? formatSpiceValue(c.valueOhmsOrFaradsOrVolts) : "";
    },
    setValue: (id, valueStr) => {
      const parsed = parseSpiceValue(valueStr);
      if (!parsed.valid || parsed.value === undefined) return;
      setComponents((prev) =>
        prev.map((c) => (c.id === id ? { ...c, valueOhmsOrFaradsOrVolts: parsed.value! } : c))
      );
    },
  };

  // --- Drag de componente: agrupación de Command en historial ---
  const handleDragStart = useCallback((componentId: string) => {
    historyRef.current.beginGroup(`Mover ${componentId}`);
  }, []);

  const handleDragMove = useCallback((componentId: string, newPos: GridPoint) => {
    const from = store.getPosition(componentId);
    historyRef.current.execute(createMoveCommand(store, componentId, from, newPos));
  }, []);

  const handleDragEnd = useCallback(() => {
    historyRef.current.endGroup();
  }, []);

  // --- Edición de valor ---
  const handleValueEdit = useCallback((componentId: string, rawInput: string) => {
    const parsed = parseSpiceValue(rawInput);
    if (!parsed.valid) {
      console.warn(`Valor inválido para ${componentId}: ${parsed.error}`);
      return;
    }
    store.setValue(componentId, rawInput);
  }, []);

  // --- Wiring ---
  const connectComponents = useCallback(
    (fromCompId: string, toCompId: string) => {
      const fromComp = components.find((c) => c.id === fromCompId);
      const toComp = components.find((c) => c.id === toCompId);
      if (!fromComp || !toComp) return;

      // pin 2 del primero (derecha) al pin 1 del segundo (izquierda) —
      // ver getPinOffsets, simplificación de ejemplo.
      const fromPos = { x: fromComp.position.x + 1, y: fromComp.position.y };
      const toPos = { x: toComp.position.x, y: toComp.position.y };
      const routedPoints = routeOrthogonal(fromPos, toPos);

      const newWire: WireInstance = {
        id: `wire-${fromCompId}-${toCompId}`,
        fromComponentId: fromCompId,
        toComponentId: toCompId,
        points: routedPoints,
      };
      setWires((prev) => [...prev, newWire]);
      // El useEffect de arriba reconstruye NetGraph automáticamente tras
      // este setState — no hace falta llamar netGraphRef aquí también.
    },
    [components]
  );

  // --- Simulación transitoria: streaming real vía evento Tauri ---
  const startSimulation = useCallback(async () => {
    setSimError(null);
    setStreamStatus("running");

    const { state, dispose } = await createTransientStreamListener({
      onFrame: (frame) => setLatestFrame(frame),
      onFinal: () => setStreamStatus("stopped"),
      onError: (msg) => setSimError(classifySimulationError(msg)),
    });
    disposeListenerRef.current = dispose;
    void state; // `state` también disponible para lectura imperativa si no quieres pasar por React state en cada frame (ver advertencia de throttling en transient-stream.ts)

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Result<T,String> del lado Rust: invoke() lanza si Err. Tu comando
      // real probablemente toma parámetros (netlist, dt, duración) — aquí
      // omitidos porque no los especificaste; ajusta la firma al llamar.
      await invoke<void>("start_interactive_transient");
    } catch (err) {
      const rawMessage = typeof err === "string" ? err : String(err);
      setSimError(classifySimulationError(rawMessage));
      setStreamStatus("error");
      dispose();
      disposeListenerRef.current = null;
    }
  }, []);

  const stopSimulation = useCallback(async () => {
    await stopTransientSimulation();
    disposeListenerRef.current?.();
    disposeListenerRef.current = null;
    setStreamStatus("stopped");
  }, []);

  // --- Render ---
  const voltageRange =
    DEFAULT_VOLTAGE_SCALE.mode === "fixed"
      ? { min: DEFAULT_VOLTAGE_SCALE.fixedMin, max: DEFAULT_VOLTAGE_SCALE.fixedMax }
      : computeAutoRange(latestFrame?.node_voltages ?? {});

  return (
    <div>
      <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={startSimulation} disabled={streamStatus === "running"}>
          ▶ Simular
        </button>
        <button onClick={stopSimulation} disabled={streamStatus !== "running"}>
          ■ Detener
        </button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          estado: {streamStatus}
          {latestFrame && ` · t=${latestFrame.time.toFixed(4)}s · frame #${latestFrame.frame_index}`}
        </span>
      </div>

      {/* Feedback de convergence failure — ver references/simulation-feedback.md,
          "Convergence failure": señala el nodo problemático, no solo texto genérico. */}
      {simError && (
        <div style={{ color: "#f87171", fontSize: 13, marginBottom: 8 }}>
          {simError.userMessage}
          {simError.suspectedComponentOrNetId && (
            <strong> (revisar {simError.suspectedComponentOrNetId})</strong>
          )}
        </div>
      )}

      <svg viewBox="0 0 400 200" style={{ background: "#1a1a1a" }}>
        {components.map((comp) => {
          const screenPos = gridToScreen(comp.position);
          const pinRefs = toPinRefs(comp);
          // El voltaje a mostrar es el del net del primer pin — un
          // componente de 2 terminales como una resistencia no tiene "un"
          // voltaje propio, tiene uno por cada pin/net al que se conecta.
          // Esto es intencional y refleja el modelo eléctrico real, no
          // una simplificación: ver references/canvas-wiring.md sobre
          // por qué conexión = net compartido, no propiedad del símbolo.
          const primaryNetId = netGraphRef.current.getVoltageKey(pinRefs[0].id);
          const fillColor = colorForNet(primaryNetId, latestFrame, voltageRange);
          const primaryVoltage = latestFrame?.node_voltages[primaryNetId];

          return (
            <g key={comp.id} transform={`translate(${screenPos.x}, ${screenPos.y})`}>
              <rect
                width={GRID_STEP_PX * 2}
                height={GRID_STEP_PX}
                fill={fillColor}
                stroke="#fff"
                strokeWidth={1}
                onMouseDown={() => handleDragStart(comp.id)}
              />
              <text x={4} y={14} fontSize={10} fill="#fff">
                {comp.id}: {formatSpiceValue(comp.valueOhmsOrFaradsOrVolts)}
                {primaryVoltage !== undefined && ` (${formatVoltageForDisplay(primaryVoltage)})`}
              </text>
            </g>
          );
        })}

        {wires.map((wire) => (
          <CurrentFlowAnimation
            key={wire.id}
            points={wire.points.map(gridToScreen)}
            currentAmps={currentForWire(wire.id, latestFrame)}
          />
        ))}
      </svg>
    </div>
  );
}
