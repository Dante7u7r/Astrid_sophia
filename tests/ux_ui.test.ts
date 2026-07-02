// @vitest-environment happy-dom
/**
 * Suite de Pruebas de Integración de UX/UI y Simulación de Circuitos
 * Valida de forma rigurosa la lógica de layout interactivo, dibujo CAD en lienzo y solvencia en CC.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PanelLayoutManager } from '../src/ui/panel_layout_manager';
import { drawComponentSymbol } from '../src/canvas/component_renderer';
import { solveCircuitTS } from '../src/simulation/fallback_solver';
import { type CircuitNetlist } from '../src/simulation/netlist_extractor';

describe('Pruebas de UX/UI - PanelLayoutManager', () => {
  beforeEach(() => {
    // Inicializar el DOM virtual simulado
    document.body.innerHTML = `
      <div id="app-viewport" style="width: 1024px; height: 768px;">
        <div id="sidebar-left"></div>
        <div id="sidebar-right"></div>
        <div id="bottom-dock"></div>
      </div>
    `;
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('debe inicializar el gestor de layout con los valores por defecto y aplicar variables CSS', () => {
    const root = document.getElementById('app-viewport');
    expect(root).not.toBeNull();

    const manager = new PanelLayoutManager(root!);
    expect(manager).toBeDefined();

    // Comprobar que las clases iniciales se aplican (dock colapsado por defecto)
    const bottomDock = document.getElementById('bottom-dock');
    expect(bottomDock?.classList.contains('collapsed')).toBe(true);

    // Comprobar que se inyectaron las variables CSS en el elemento raíz
    const rootEl = document.documentElement;
    expect(rootEl.style.getPropertyValue('--left-panel-width')).toBe('200px');
    expect(rootEl.style.getPropertyValue('--right-panel-width')).toBe('220px');
    expect(rootEl.style.getPropertyValue('--osc-panel-height')).toBe('210px');
  });

  it('debe conmutar (toggle) los paneles laterales y el dock correctamente', () => {
    const root = document.getElementById('app-viewport')!;
    const manager = new PanelLayoutManager(root);

    const sidebarLeft = document.getElementById('sidebar-left');
    const bottomDock = document.getElementById('bottom-dock');

    // Inicialmente el sidebar izquierdo no está colapsado y el dock sí
    expect(sidebarLeft?.classList.contains('collapsed')).toBe(false);
    expect(bottomDock?.classList.contains('collapsed')).toBe(true);

    // Colapsar sidebar izquierdo y abrir el dock
    manager.togglePanel('left');
    manager.togglePanel('dock');

    expect(sidebarLeft?.classList.contains('collapsed')).toBe(true);
    expect(bottomDock?.classList.contains('collapsed')).toBe(false);
  });

  it('debe resetear y versionar el layout guardado en localStorage', () => {
    const root = document.getElementById('app-viewport')!;
    const manager = new PanelLayoutManager(root);

    // Guardar un layout modificado
    manager.togglePanel('left');
    manager.togglePanel('right');
    manager.resetAllPanels();

    const saved = localStorage.getItem('astryd_panel_layout');
    expect(saved).not.toBeNull();

    const parsed = JSON.parse(saved!);
    expect(parsed.version).toBe(3); // Verifica el versionado del fix
    expect(parsed.leftCollapsed).toBe(false);
    expect(parsed.rightCollapsed).toBe(false);
  });
});

describe('Pruebas de Renderizado CAD - ComponentRenderer', () => {
  it('debe dibujar los símbolos vectoriales sin arrojar excepciones de canvas', () => {
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
      fillStyle: "",
      shadowColor: "",
      shadowBlur: 0
    } as unknown as CanvasRenderingContext2D;

    const dummyResistor = {
      id: 'R1',
      type: 'resistor',
      value: 1000,
      x: 200,
      y: 200,
      rotation: 0,
      mirror: false
    };

    const dummyGnd = {
      id: 'GND1',
      type: 'ground',
      value: 0,
      x: 100,
      y: 100,
      rotation: 90,
      mirror: false
    };

    const dummyNpn = {
      id: 'Q1',
      type: 'npn',
      value: 0,
      x: 150,
      y: 150,
      rotation: 180,
      mirror: true
    };

    // Asegurar que drawComponentSymbol corre en todas las ramas lógicas (normal, seleccionado, hovered)
    expect(() => drawComponentSymbol(mockCtx, dummyResistor, false, false)).not.toThrow();
    expect(() => drawComponentSymbol(mockCtx, dummyResistor, true, false)).not.toThrow();
    expect(() => drawComponentSymbol(mockCtx, dummyResistor, false, true)).not.toThrow();
    
    // Probar otros componentes
    expect(() => drawComponentSymbol(mockCtx, dummyGnd, false, false)).not.toThrow();
    expect(() => drawComponentSymbol(mockCtx, dummyNpn, false, false)).not.toThrow();
  });
});

describe('Pruebas de Simulación de Circuitos en TS (Circuit Solvers)', () => {
  it('debe resolver un divisor de tensión resistivo de tres resistencias', () => {
    const tripleDivider: CircuitNetlist = {
      components: [
        { id: 'V1', type: 'vsource', value: 9, pins: ['1', '0'] },
        { id: 'R1', type: 'resistor', value: 1000, pins: ['1', '2'] },
        { id: 'R2', type: 'resistor', value: 1000, pins: ['2', '3'] },
        { id: 'R3', type: 'resistor', value: 1000, pins: ['3', '0'] },
        { id: 'GND', type: 'ground', value: 0, pins: ['0'] }
      ],
      wires: []
    };

    const res = solveCircuitTS(tripleDivider);
    expect(typeof res).not.toBe('string');
    
    const voltages = (res as any).nodeVoltages;
    // 9V distribuidos simétricamente en 3 resistencias iguales (1k c/u)
    expect(voltages['1']).toBeCloseTo(9, 2);
    expect(voltages['2']).toBeCloseTo(6, 2);
    expect(voltages['3']).toBeCloseTo(3, 2);
    expect(voltages['0']).toBe(0);
  });

  it('debe simular y resolver correctamente un circuito con diodo rectificador linealizado', () => {
    const diodeCircuit: CircuitNetlist = {
      components: [
        { id: 'V1', type: 'vsource', value: 5, pins: ['1', '0'] },
        { id: 'R1', type: 'resistor', value: 50, pins: ['1', '2'] },
        { id: 'D1', type: 'diode', value: 0.7, pins: ['2', '0'] }, // Diode a GND (Rdiodo = 50 ohm en fallback)
        { id: 'GND', type: 'ground', value: 0, pins: ['0'] }
      ],
      wires: []
    };

    const res = solveCircuitTS(diodeCircuit);
    expect(typeof res).not.toBe('string');
    
    const voltages = (res as any).nodeVoltages;
    // El divisor resistivo se forma por R1 (50 ohm) y Rdiodo (50 ohm) -> Vdiodo = 5V * (50/(50+50)) = 2.5V
    expect(voltages['1']).toBeCloseTo(5, 2);
    expect(voltages['2']).toBeCloseTo(2.5, 2);
  });
});
