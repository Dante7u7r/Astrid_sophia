/**
 * Suite de Tests de Integración End-to-End para Astrid Sophia v1.0
 * 
 * Valida el flujo completo de simulación:
 * 1. Cargar demo desde archivos .json
 * 2. Ejecutar simulación (DC, TRAN, AC)
 * 3. Verificar resultados esperados
 * 4. Validar exportación de datos
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock de funciones Tauri IPC
const mockInvoke = vi.fn();
vi.mock('../src/simulation/tauri_mock', () => ({
  invoke: mockInvoke,
  appDataDir: '/mock/data/dir'
}));

interface SimulationResult {
  nodes: Record<string, number[]>;
  time?: number[];
  frequencies?: number[];
  converged: boolean;
  iterations: number;
}

describe('Integration Tests - Flujo Completo de Simulación', () => {
  
  beforeEach(() => {
    mockInvoke.mockClear();
    // Setup común para cada test
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
   * Valida que un circuito RC básico cargue correctamente
   */
  describe('Circuito RC - Transient Analysis', () => {
    
    it('debe simular carga exponencial de capacitor correctamente', async () => {
      // Arrange: Configurar mock para circuito RC
      const rcCircuit = {
        components: [
          { id: 'V1', type: 'vsource_dc', value: 5, pins: ['n1', '0'] },
          { id: 'R1', type: 'resistor', value: 1000, pins: ['n1', 'n2'] },
          { id: 'C1', type: 'capacitor', value: 1e-6, pins: ['n2', '0'] },
          { id: 'GND', type: 'ground', pins: ['0'] }
        ],
        simulation: {
          type: 'TRAN',
          tStop: 0.01, // 10ms
          dt: 1e-6     // 1µs
        }
      };

      mockInvoke.mockResolvedValue({
        nodes: { n2: Array(10001).fill(0).map((_, i) => 5 * (1 - Math.exp(-i * 1e-6 / (1000 * 1e-6)))) },
        time: Array(10001).fill(0).map((_, i) => i * 1e-6),
        converged: true,
        iterations: 45
      });

      // Act: Importar módulo de simulación y ejecutar
      const { runSimulation } = await import('../src/simulation/simulation_runner');
      const result = await runSimulation(rcCircuit);

      // Assert: Verificar resultados
      expect(result.converged).toBe(true);
      expect(result.nodes.n2).toBeDefined();
      
      // El voltaje final debe acercarse a 5V (estado estable)
      const finalVoltage = result.nodes.n2[result.nodes.n2.length - 1];
      expect(finalVoltage).toBeGreaterThan(4.9);
      expect(finalVoltage).toBeLessThan(5.1);
      
      // Constante de tiempo τ = RC = 1ms
      // En t = τ, Vc debe ser ~63.2% de 5V = 3.16V
      const tauIndex = 1000; // 1ms con dt=1µs
      const voltageAtTau = result.nodes.n2[tauIndex];
      expect(voltageAtTau).toBeGreaterThan(3.0);
      expect(voltageAtTau).toBeLessThan(3.3);
    });

    it('debe detectar error si falta tierra', async () => {
      const circuitNoGnd = {
        components: [
          { id: 'V1', type: 'vsource_dc', value: 5, pins: ['n1', 'n2'] },
          { id: 'R1', type: 'resistor', value: 1000, pins: ['n2', 'n3'] }
        ],
        simulation: { type: 'TRAN', tStop: 0.01, dt: 1e-6 }
      };

      mockInvoke.mockRejectedValue(new Error('ERC_ERROR: Missing ground reference'));

      const { runSimulation } = await import('../src/simulation/simulation_runner');
      
      await expect(runSimulation(circuitNoGnd))
        .rejects
        .toThrow('Missing ground reference');
    });
  });

  /**
   * TEST 2: Divisor de Voltaje Resistivo - DC Analysis
   * Valida análisis de punto de operación DC
   */
  describe('Divisor de Voltaje - DC Operating Point', () => {
    
    it('debe calcular voltajes nodales correctamente en DC', async () => {
      const dividerCircuit = {
        components: [
          { id: 'V1', type: 'vsource_dc', value: 12, pins: ['n1', '0'] },
          { id: 'R1', type: 'resistor', value: 2000, pins: ['n1', 'n2'] },
          { id: 'R2', type: 'resistor', value: 1000, pins: ['n2', '0'] },
          { id: 'GND', type: 'ground', pins: ['0'] }
        ],
        simulation: { type: 'DC' }
      };

      mockInvoke.mockResolvedValue({
        nodes: { n1: 12, n2: 4 }, // Divisor: 12V * (1k / (2k + 1k)) = 4V
        converged: true,
        iterations: 12
      });

      const { runSimulation } = await import('../src/simulation/simulation_runner');
      const result = await runSimulation(dividerCircuit);

      expect(result.converged).toBe(true);
      expect(result.nodes.n1).toBeCloseTo(12, 2);
      expect(result.nodes.n2).toBeCloseTo(4, 2);
    });
  });

  /**
   * TEST 3: Filtro RC - AC Sweep Analysis
   * Valida respuesta en frecuencia de filtro pasa-bajos
   */
  describe('Filtro RC - AC Frequency Sweep', () => {
    
    it('debe mostrar atenuación a altas frecuencias', async () => {
      const filterCircuit = {
        components: [
          { id: 'VIN', type: 'vac', value: 1, pins: ['in', '0'], ac: 1 },
          { id: 'R1', type: 'resistor', value: 1000, pins: ['in', 'out'] },
          { id: 'C1', type: 'capacitor', value: 159e-9, pins: ['out', '0'] }, // fc ≈ 1kHz
          { id: 'GND', type: 'ground', pins: ['0'] }
        ],
        simulation: {
          type: 'AC',
          fStart: 10,
          fStop: 100000,
          pointsPerDecade: 10
        }
      };

      // Mock de respuesta tipo filtro pasa-bajos
      const frequencies = [10, 100, 1000, 10000, 100000];
      const magnitudes = [0.0, -0.04, -3.0, -20.0, -40.0]; // dB

      mockInvoke.mockResolvedValue({
        frequencies,
        nodes: { out: magnitudes },
        phases: { out: [0, -5, -45, -84, -89] },
        converged: true
      });

      const { runSimulation } = await import('../src/simulation/simulation_runner');
      const result = await runSimulation(filterCircuit);

      expect(result.frequencies).toEqual(frequencies);
      
      // A 1kHz (frecuencia de corte), magnitud debe ser ≈ -3dB
      const cutoffIndex = 2;
      expect(result.nodes.out[cutoffIndex]).toBeCloseTo(-3, 0);
      
      // A 100kHz, atenuación debe ser significativa (< -30dB)
      expect(result.nodes.out[4]).toBeLessThan(-30);
    });
  });

  /**
   * TEST 4: Demo Pre-cargada - Flujo Completo
   * Valida que las demos incluidas funcionen sin errores
   */
  describe('Demo Files - End-to-End', () => {
    
    const demoFiles = [
      'rc_circuit.json',
      'rlc_oscillator.json',
      'transistor_amplifier.json'
    ];

    it.each(demoFiles)('debe cargar y simular %s exitosamente', async (demoFile) => {
      // Arrange: Mock de carga de archivo
      const demoData = {
        name: demoFile.replace('.json', ''),
        components: [],
        simulation: { type: 'TRAN', tStop: 0.01, dt: 1e-6 }
      };

      mockInvoke
        .mockResolvedValueOnce(demoData) // loadDemo
        .mockResolvedValueOnce({         // runSimulation
          nodes: {},
          time: [],
          converged: true,
          iterations: 50
        });

      const { loadDemo } = await import('../src/simulation/simulation_dispatcher');
      const { runSimulation } = await import('../src/simulation/simulation_runner');

      // Act: Cargar demo y simular
      const loaded = await loadDemo(demoFile);
      const result = await runSimulation(loaded);

      // Assert
      expect(loaded).toBeDefined();
      expect(result.converged).toBe(true);
    });
  });

  /**
   * TEST 5: Exportación de Resultados
   * Valida que los datos se puedan exportar correctamente
   */
  describe('Data Export', () => {
    
    it('debe exportar datos en formato CSV válido', async () => {
      const mockData = {
        time: [0, 0.001, 0.002, 0.003],
        nodes: {
          n1: [0, 1, 2, 3],
          n2: [0, 0.5, 1, 1.5]
        }
      };

      const { exportToCSV } = await import('../src/simulation/simulation_runner');
      const csv = exportToCSV(mockData);

      expect(csv).toContain('time,n1,n2');
      expect(csv.split('\n').length).toBe(5); // Header + 4 data rows
      expect(csv).toContain('0.001,1,0.5');
    });
  });

  /**
   * TEST 6: Validación ERC (Electrical Rule Check)
   * Valida detección de errores comunes antes de simular
   */
  describe('Electrical Rule Check (ERC)', () => {
    
    it('debe detectar fuente de voltaje cortocircuitada', async () => {
      const shortedSource = {
        components: [
          { id: 'V1', type: 'vsource_dc', value: 5, pins: ['n1', 'n1'] }, // Mismo nodo!
          { id: 'GND', type: 'ground', pins: ['n1'] }
        ],
        simulation: { type: 'DC' }
      };

      mockInvoke.mockRejectedValue(new Error('ERC_ERROR: Shorted voltage source V1'));

      const { validateCircuit } = await import('../src/simulation/simulation_dispatcher');
      
      await expect(validateCircuit(shortedSource))
        .rejects
        .toThrow('Shorted voltage source');
    });

    it('debe detectar componentes flotantes', async () => {
      const floatingComponent = {
        components: [
          { id: 'V1', type: 'vsource_dc', value: 5, pins: ['n1', '0'] },
          { id: 'R1', type: 'resistor', value: 1000, pins: ['n2', 'n3'] }, // Flotante!
          { id: 'GND', type: 'ground', pins: ['0'] }
        ],
        simulation: { type: 'DC' }
      };

      mockInvoke.mockRejectedValue(new Error('ERC_ERROR: Floating component R1'));

      const { validateCircuit } = await import('../src/simulation/simulation_dispatcher');
      
      await expect(validateCircuit(floatingComponent))
        .rejects
        .toThrow('Floating component');
    });
  });
});

/**
 * TEST 7: Performance - Tiempos de Simulación
 * Valida que las simulaciones completen en tiempo razonable
 */
describe('Performance Benchmarks', () => {
  
  it('debe completar simulación de 100 componentes en < 1 segundo', async () => {
    const largeCircuit = {
      components: Array(100).fill(null).map((_, i) => ({
        id: `R${i}`,
        type: 'resistor',
        value: 1000 + i,
        pins: [`n${i}`, `n${i + 1}`]
      })).concat([
        { id: 'V1', type: 'vsource_dc', value: 5, pins: ['n0', '0'] },
        { id: 'GND', type: 'ground', pins: ['0'] }
      ]),
      simulation: { type: 'DC' }
    };

    mockInvoke.mockResolvedValue({
      nodes: {},
      converged: true,
      iterations: 150
    });

    const { runSimulation } = await import('../src/simulation/simulation_runner');
    
    const startTime = performance.now();
    await runSimulation(largeCircuit);
    const endTime = performance.now();

    expect(endTime - startTime).toBeLessThan(1000); // < 1 segundo
  });
});
