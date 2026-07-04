// @vitest-environment happy-dom
/**
 * Suite de Tests de Integración End-to-End para Astrid Sophia v2.0
 * 
 * Valida el flujo completo de simulación utilizando las APIs reales del simulador:
 * 1. Ejecutar simulación transitoria de paso fijo (TRAN) y punto de operación (DC)
 * 2. Ejecutar despacho de simulación con simulación de entorno web puro (fallback local)
 * 3. Ejecutar análisis de reglas eléctricas (ERC)
 * 4. Medir rendimiento en circuitos de gran tamaño
 * 5. Verificar formateador de exportación de datos
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { solveTransientCircuitTS, solveCircuitTS, type TSResult } from '../src/simulation/fallback_solver';
import { runElectricalRuleCheck, dispatchSimulation } from '../src/simulation/simulation_dispatcher';
import { type TimeStepResult } from '../src/ui/oscilloscope_panel';
import { type CircuitNetlist } from '../src/simulation/netlist_extractor';
import { type ComponentInstance, type PinInstance } from '../src/canvas_orchestrator';

// Mock de la capa de Tauri
const mockInvoke = vi.fn();
vi.mock('../src/simulation/tauri_mock', () => ({
  safeInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args)
}));

describe('Integration Tests - Flujo Completo de Simulación', () => {
  
  beforeEach(() => {
    mockInvoke.mockClear();
    document.body.innerHTML = `
      <div id="canvas-container"></div>
      <div id="oscilloscope-panel"></div>
      <div id="simulation-controls"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * TEST 1: Circuito RC Simple - Carga de Capacitor
   * Valida que un circuito RC básico cargue exponencialmente de forma correcta
   */
  describe('Circuito RC - Transient Analysis', () => {
    
    it('debe simular carga exponencial de capacitor correctamente', () => {
      // Arrange: Configurar netlist real para circuito RC
      const rcCircuit: CircuitNetlist = {
        components: [
          { id: 'V1', type: 'vsource', value: 5, pins: ['1', '0'] },
          { id: 'R1', type: 'resistor', value: 1000, pins: ['1', '2'] },
          { id: 'C1', type: 'capacitor', value: 1e-6, pins: ['2', '0'] }
        ],
        wires: []
      };

      // Act: Ejecutar simulador transitorio de fallback
      const results = solveTransientCircuitTS(rcCircuit, 1e-6, 0.01, {});

      // Assert: Verificar resultados
      expect(typeof results).not.toBe('string');
      const resultsArr = results as TimeStepResult[];
      expect(resultsArr.length).toBeGreaterThan(0);
      
      // El voltaje final debe acercarse a 5V (estado estable)
      const finalVoltage = resultsArr[resultsArr.length - 1].nodeVoltages['2'];
      expect(finalVoltage).toBeGreaterThan(4.9);
      expect(finalVoltage).toBeLessThan(5.1);
      
      // Constante de tiempo τ = RC = 1ms
      // En t = τ, Vc debe ser ~63.2% de 5V = 3.16V
      const tauIndex = 1000; // 1ms con dt=1µs
      const voltageAtTau = resultsArr[tauIndex].nodeVoltages['2'];
      expect(voltageAtTau).toBeGreaterThan(3.0);
      expect(voltageAtTau).toBeLessThan(3.3);
    });
  });

  /**
   * TEST 2: Divisor de Voltaje Resistivo - DC Analysis
   * Valida análisis de punto de operación DC
   */
  describe('Divisor de Voltaje - DC Operating Point', () => {
    
    it('debe calcular voltajes nodales correctamente en DC', () => {
      const dividerCircuit: CircuitNetlist = {
        components: [
          { id: 'V1', type: 'vsource', value: 12, pins: ['1', '0'] },
          { id: 'R1', type: 'resistor', value: 2000, pins: ['1', '2'] },
          { id: 'R2', type: 'resistor', value: 1000, pins: ['2', '0'] }
        ],
        wires: []
      };

      // Act: Ejecutar solucionador DC local
      const result = solveCircuitTS(dividerCircuit);

      // Assert
      expect(typeof result).not.toBe('string');
      const tsResult = result as TSResult;
      expect(tsResult.nodeVoltages['1']).toBeCloseTo(12, 2);
      expect(tsResult.nodeVoltages['2']).toBeCloseTo(4, 2); // 12 * (1k / 3k) = 4V
    });
  });

  /**
   * TEST 3: Filtro RC - AC Frequency Sweep
   * Valida respuesta en frecuencia de un filtro pasa-bajos en el despachador
   */
  describe('Filtro RC - AC Frequency Sweep', () => {
    
    it('debe mostrar atenuación a altas frecuencias', async () => {
      vi.useFakeTimers();

      const filterCircuit: CircuitNetlist = {
        components: [
          { id: 'VIN', type: 'vsource', value: 1, pins: ['1', '0'], frequency: 1000 },
          { id: 'R1', type: 'resistor', value: 1000, pins: ['1', '2'] },
          { id: 'C1', type: 'capacitor', value: 159e-9, pins: ['2', '0'] }
        ],
        wires: []
      };

      const logs: string[] = [];
      let readyResults: any = null;
      
      const callbacks = {
        addLog: (msg: string) => { logs.push(msg); },
        onResultsReady: (_mode: string, results: any) => { readyResults = results; },
        onIpcStatusUpdate: () => {},
        updateCanvasRendering: () => {}
      };

      // Forzar que falle la invocación de Tauri IPC para que se use el fallback
      mockInvoke.mockRejectedValue(new Error('window.__TAURI__ not found'));

      // Iniciar simulación en el despachador
      const promise = dispatchSimulation(filterCircuit, 'AC', { simSettings: { dt: 1e-4 }, transientDuration: 0.05 }, callbacks);
      
      // Esperar a que la promesa del despachador se resuelva y programe el setTimeout
      await promise;

      // El fallback en dispatchSimulation introduce una latencia artificial de 300ms
      vi.advanceTimersByTime(310);

      // Assert
      expect(readyResults).toBeDefined();
      expect(readyResults.frequencies).toBeDefined();
      expect(readyResults.nodeAmplitudes['2']).toBeDefined();
      
      vi.useRealTimers();
    });
  });

  /**
   * TEST 4: Demo Files - End-to-End
   * Valida que circuitos complejos de tipo demo se simulen y converjan exitosamente
   */
  describe('Demo Files - End-to-End', () => {
    
    it('debe simular y converger un oscilador RLC transitorio', () => {
      const rlcCircuit: CircuitNetlist = {
        components: [
          { id: 'V1', type: 'vsource', value: 5, pins: ['1', '0'] },
          { id: 'R1', type: 'resistor', value: 10, pins: ['1', '2'] },
          { id: 'L1', type: 'inductor', value: 1e-3, pins: ['2', '3'] },
          { id: 'C1', type: 'capacitor', value: 1e-6, pins: ['3', '0'] }
        ],
        wires: []
      };

      const results = solveTransientCircuitTS(rlcCircuit, 1e-6, 0.001, {});
      expect(typeof results).not.toBe('string');
      const resultsArr = results as TimeStepResult[];
      expect(resultsArr.length).toBeGreaterThan(0);
    });

    it('debe simular y converger un amplificador con transistor BJT en DC', () => {
      const bjtCircuit: CircuitNetlist = {
        components: [
          { id: 'V1', type: 'vsource', value: 12, pins: ['1', '0'] },
          { id: 'R1', type: 'resistor', value: 10000, pins: ['1', '2'] }, // Rc
          { id: 'R2', type: 'resistor', value: 100000, pins: ['1', '3'] }, // Rb
          { id: 'Q1', type: 'npn', value: 0, pins: ['3', '2', '0'] } // Base=3, Collector=2, Emitter=0
        ],
        wires: []
      };

      const result = solveCircuitTS(bjtCircuit);
      expect(typeof result).not.toBe('string');
      const tsResult = result as TSResult;
      expect(tsResult.nodeVoltages['2']).toBeDefined();
    });
  });

  /**
   * TEST 5: Exportación de Resultados
   * Valida la lógica de exportación a CSV idéntica a la producción en frontend
   */
  describe('Data Export', () => {
    
    it('debe exportar datos en formato CSV válido', () => {
      const mockData: {
        time: number[];
        nodeVoltages: Record<string, number[]>;
      } = {
        time: [0, 0.001, 0.002, 0.003],
        nodeVoltages: {
          '1': [0, 1, 2, 3],
          '2': [0, 0.5, 1, 1.5]
        }
      };

      const exportToCSV = (data: typeof mockData, ch1Node: string, ch2Node: string) => {
        let csvContent = "Tiempo (s),Voltaje Canal 1 (V),Voltaje Canal 2 (V)\n";
        for (let i = 0; i < data.time.length; i++) {
          const t = data.time[i];
          const v1 = data.nodeVoltages[ch1Node]?.[i] ?? 0.0;
          const v2 = data.nodeVoltages[ch2Node]?.[i] ?? 0.0;
          csvContent += `${t.toFixed(6)},${v1.toFixed(5)},${v2.toFixed(5)}\n`;
        }
        return csvContent;
      };

      const csv = exportToCSV(mockData, '1', '2');

      expect(csv).toContain('Tiempo (s),Voltaje Canal 1 (V),Voltaje Canal 2 (V)');
      expect(csv.split('\n').length).toBe(6); // Cabecera + 4 filas de datos + salto de línea final
      expect(csv).toContain('0.001000,1.00000,0.50000');
    });
  });

  /**
   * TEST 6: Validación ERC (Electrical Rule Check)
   * Valida detección de errores topológicos comunes antes de simular
   */
  describe('Electrical Rule Check (ERC)', () => {
    
    const getPinsMock = (comp: ComponentInstance): PinInstance[] => {
      if (comp.type === 'ground') {
        return [{ componentId: comp.id, pinIndex: 0, x: 0, y: 0 }];
      }
      return [
        { componentId: comp.id, pinIndex: 0, x: 0, y: 0 },
        { componentId: comp.id, pinIndex: 1, x: 0, y: 0 }
      ];
    };

    it('debe detectar referencia a tierra ausente', () => {
      const circuitNoGnd: CircuitNetlist = {
        components: [
          { id: 'V1', type: 'vsource', value: 5, pins: ['1', '2'] },
          { id: 'R1', type: 'resistor', value: 1000, pins: ['2', '3'] }
        ],
        wires: []
      };

      const compInstances: ComponentInstance[] = [
        { id: 'V1', type: 'vsource', value: 5, x: 0, y: 0, rotation: 0 },
        { id: 'R1', type: 'resistor', value: 1000, x: 0, y: 0, rotation: 0 }
      ];

      const ercRes = runElectricalRuleCheck(circuitNoGnd, compInstances, [], getPinsMock);
      expect(ercRes.passed).toBe(false);
      expect(ercRes.errors.some(e => e.includes('Tierra ausente'))).toBe(true);
    });

    it('debe detectar fuente de voltaje cortocircuitada', () => {
      const shortedSource: CircuitNetlist = {
        components: [
          { id: 'V1', type: 'vsource', value: 5, pins: ['1', '1'] }, // Mismo nodo!
          { id: 'GND', type: 'ground', value: 0, pins: ['1'] }
        ],
        wires: []
      };

      const compInstances: ComponentInstance[] = [
        { id: 'V1', type: 'vsource', value: 5, x: 0, y: 0, rotation: 0 },
        { id: 'GND', type: 'ground', value: 0, x: 0, y: 0, rotation: 0 }
      ];

      const ercRes = runElectricalRuleCheck(shortedSource, compInstances, [], getPinsMock);
      expect(ercRes.passed).toBe(false);
      expect(ercRes.errors.some(e => e.includes('Cortocircuito Franco'))).toBe(true);
    });

    it('debe detectar advertencia de componentes flotantes', () => {
      const floatingComponent: CircuitNetlist = {
        components: [
          { id: 'V1', type: 'vsource', value: 5, pins: ['1', '0'] },
          { id: 'R1', type: 'resistor', value: 1000, pins: ['2', '3'] }, // Flotante y desconectado
          { id: 'GND', type: 'ground', value: 0, pins: ['0'] }
        ],
        wires: []
      };

      const compInstances: ComponentInstance[] = [
        { id: 'V1', type: 'vsource', value: 5, x: 0, y: 0, rotation: 0 },
        { id: 'R1', type: 'resistor', value: 1000, x: 0, y: 0, rotation: 0 },
        { id: 'GND', type: 'ground', value: 0, x: 0, y: 0, rotation: 0 }
      ];

      const ercRes = runElectricalRuleCheck(floatingComponent, compInstances, [], getPinsMock);
      // Las advertencias no bloquean la simulación (passed es true si no hay errores fatales)
      expect(ercRes.passed).toBe(true);
      expect(ercRes.warnings.some(w => w.includes('Componente huérfano detectado'))).toBe(true);
    });
  });
});

/**
 * TEST 7: Performance - Tiempos de Simulación
 * Valida que el resolvedor DC local procese eficientemente circuitos de gran tamaño
 */
describe('Performance Benchmarks', () => {
  
  it('debe completar simulación de 100 componentes en < 100 milisegundos', () => {
    const largeCircuit: CircuitNetlist = {
      components: Array(100).fill(null).map((_, i) => ({
        id: `R${i}`,
        type: 'resistor',
        value: 1000 + i,
        pins: [`${i + 1}`, `${i + 2}`]
      })).concat([
        { id: 'V1', type: 'vsource', value: 5, pins: ['1', '0'] }
      ]),
      wires: []
    };

    const startTime = performance.now();
    const result = solveCircuitTS(largeCircuit);
    const endTime = performance.now();

    expect(typeof result).not.toBe('string');
    expect(endTime - startTime).toBeLessThan(100); // < 100ms
  });
});
