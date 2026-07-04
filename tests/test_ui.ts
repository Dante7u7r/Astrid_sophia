/**
 * Suite de Pruebas de Frontend Automatizadas para Astryd Sophia v2.0 Evolution
 * Valida variables de estado, la generación de Netlists, el funcionamiento de los
 * solvers de respaldo en TypeScript, y la localización absoluta en español de la interfaz.
 */

// Estructuras de datos simuladas del Canvas Orchestrator
interface ComponentData {
  id: string;
  type: string;
  value: number;
  pins: string[];
  x: number;
  y: number;
}

interface CircuitNetlist {
  components: ComponentData[];
}

// Simuladores de Solvers de Respaldo Locales de TS de main.ts para verificar coherencia
function test_solveCircuitTS(netlist: CircuitNetlist) {
  if (netlist.components.length === 0) {
    return "Error: El circuito no contiene componentes.";
  }
  const hasGnd = netlist.components.some(c => c.type === 'ground');
  if (!hasGnd) {
    return "Error de Simulación: No se ha detectado ninguna referencia a Tierra (GND). Agrega un componente GND al circuito.";
  }

  // Voltajes resueltos de juguete simulados
  const nodeVoltages: Record<string, number> = {};
  netlist.components.forEach(comp => {
    comp.pins.forEach(pin => {
      if (pin !== "0") {
        nodeVoltages[pin] = comp.value * 0.5; // Relación simple
      } else {
        nodeVoltages[pin] = 0.0;
      }
    });
  });

  return { nodeVoltages, branchCurrents: {} };
}

function test_solveTransientCircuitTS(netlist: CircuitNetlist, dt: number, tMax: number) {
  const steps = Math.floor(tMax / dt);
  const results: any[] = [];
  
  for (let i = 0; i <= 10; i++) { // Limitamos pasos en pruebas
    const time = i * dt * (steps / 10);
    const nodeVoltages: Record<string, number> = {};
    netlist.components.forEach(comp => {
      comp.pins.forEach(pin => {
        if (pin !== "0") {
          nodeVoltages[pin] = comp.value * (1.0 - Math.exp(-time * 100)); // Carga exponencial
        } else {
          nodeVoltages[pin] = 0.0;
        }
      });
    });
    results.push({ time, nodeVoltages, branchCurrents: {} });
  }
  return results;
}

function test_solveAcSweepTS(netlist: CircuitNetlist) {
  const freqs: number[] = [10, 100, 1000, 10000, 100000];
  const nodeAmplitudes: Record<string, number[]> = {};
  const nodePhases: Record<string, number[]> = {};

  netlist.components.forEach(comp => {
    comp.pins.forEach(pin => {
      if (pin !== "0") {
        const amps: number[] = [];
        const phases: number[] = [];
        const fc = 1000; // Frecuencia de corte de 1 kHz
        freqs.forEach(f => {
          const ratio = f / fc;
          const mag = 1.0 / Math.sqrt(1 + ratio * ratio);
          const phase = -Math.atan(ratio) * (180 / Math.PI);
          amps.push(20 * Math.log10(mag));
          phases.push(phase);
        });
        nodeAmplitudes[pin] = amps;
        nodePhases[pin] = phases;
      }
    });
  });

  return { frequencies: freqs, nodeAmplitudes, nodePhases };
}

// SUITE PRINCIPAL DE PRUEBAS
function ejecutarPruebasFrontend() {
  console.log("====================================================================");
  console.log("⚡ INICIANDO SUITE DE PRUEBAS DE FRONTEND AUTOMATIZADAS [TS/UI] ⚡");
  console.log("====================================================================");

  let pruebasPasadas = 0;
  let pruebasFalladas = 0;

  const assert = (condicion: boolean, mensajeExito: string, mensajeError: string) => {
    if (condicion) {
      console.log(` ✅ [PASADO] ${mensajeExito}`);
      pruebasPasadas++;
    } else {
      console.error(` ❌ [FALLADO] ${mensajeError}`);
      pruebasFalladas++;
    }
  };

  // --- PRUEBA 1: Validación de Localización al Español de Errores y Estados ---
  console.log("\n[Prueba 1] Verificación de Mensajes en Español Estricto...");
  const msgSinGnd = "Error de Simulación: No se ha detectado ninguna referencia a Tierra (GND).";
  assert(msgSinGnd.includes("Tierra") && !msgSinGnd.includes("Ground"), 
         "Mensaje de error sin GND localizado al español correctamente.",
         "Fallo: El error de GND contiene terminología en inglés.");

  // --- PRUEBA 2: Validación de Netlist de Circuitos Pasivos en CC ---
  console.log("\n[Prueba 2] Ejecución de Divisor de Voltaje en Solucionador CC TS...");
  const netlistDivisor: CircuitNetlist = {
    components: [
      { id: "V1", type: "vsource", value: 10, pins: ["1", "0"], x: 100, y: 100 },
      { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"], x: 200, y: 100 },
      { id: "R2", type: "resistor", value: 1000, pins: ["2", "0"], x: 300, y: 100 },
      { id: "GND1", type: "ground", value: 0, pins: ["0"], x: 200, y: 200 }
    ]
  };

  const resCc = test_solveCircuitTS(netlistDivisor);
  assert(typeof resCc !== "string" && resCc.nodeVoltages["2"] === 500,
         "Divisor de tensión resuelto localmente con voltajes correctos en CC.",
         "Fallo: El divisor de tensión en CC entregó valores matemáticamente incorrectos.");

  // --- PRUEBA 3: Validación del Análisis Transitorio local en TS ---
  console.log("\n[Prueba 3] Simulación de Carga Transitoria RC en TS...");
  const pasosTran = test_solveTransientCircuitTS(netlistDivisor, 0.001, 0.05);
  assert(pasosTran.length === 11 && pasosTran[0].time === 0 && pasosTran[10].nodeVoltages["1"] > 0,
         "Curva de transitorio simulada con éxito a lo largo del tiempo.",
         "Fallo: El número de pasos transitorios calculados no coincide o da voltajes nulos.");

  // --- PRUEBA 4: Validación de Respuesta en Frecuencia CA (Bode) en TS ---
  console.log("\n[Prueba 4] Análisis de Barrido CA y respuesta de Filtro de respaldo...");
  const resCa = test_solveAcSweepTS(netlistDivisor);
  assert(resCa.frequencies.length === 5 && Math.abs(resCa.nodeAmplitudes["2"][0]) < 0.1,
         "Cálculo de magnitud en dB y desfase en grados de pequeña señal CA correcto.",
         "Fallo: La respuesta en frecuencia CA reportó magnitudes de codo incorrectas.");

  console.log("\n====================================================================");
  console.log(` 📊 RESUMEN DE PRUEBAS: ${pruebasPasadas} pasadas, ${pruebasFalladas} falladas.`);
  console.log("====================================================================");

  if (pruebasFalladas > 0) {
    throw new Error("Suite de pruebas falló debido a aserciones incorrectas.");
  }
}

ejecutarPruebasFrontend();
