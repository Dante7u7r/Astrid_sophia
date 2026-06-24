# Astrid_sophia [desktop_app] — simulador de circuitos SPICE MNA solver DC transitorio AC

## AI CODING SAFEGUARDS
- STRUCTURAL THINKING: Before outputting any code, you MUST generate a '<thinking>' block analyzing: (a) Structural constraints and helper function isolation, (b) Exact mathematical formulas, signs, and types, (c) Array indexing mappings and bounds.
- SCOPE PINNING (RUST): Do NOT rewrite entire files (especially large files like 'solver.rs'). Isolate changes by editing strictly within specified line ranges or writing standalone helper functions/closures.
- TYPE SAFETY (RUST): Rust is extremely strict on type signatures (e.g., DVector, BTreeMap, HashMap, Complex). Explicitly map variable types and check memory borrowing/ownership rules before coding.


## CRITICAL
### src-tauri/src/lib.rs::parse_spice_netlist
```rs
async fn parse_spice_netlist(netlist_str: String) -> Result<solver::CircuitNetlist, String> {
    parser::parse_spice_netlist_to_native(&netlist_str)
}
```

### src/simulation/mcu-spice-bridge.ts::syncMcSpice
```ts
export function syncMcSpice(
  bridge: McuSpiceBridge,
  spiceNodeVoltages: Map<string, number>
): void {
  bridge.config.spiceNodeVoltages = new Map(spiceNodeVoltages);
  bridge.cycleCount++;

  if (bridge.cycleCount - bridge.lastUpdateCycle >= bridge.config.updateIntervalCycles) {
    updateGpioInputs(bridge);
    bridge.lastUpdateCycle = bridge.cycleCount;
  }
}
```

### src-tauri/src/parser.rs::test_spice_value_parser
```rs
    fn test_spice_value_parser() {
        assert_eq!(parse_spice_value("10k").unwrap(), 10000.0);
        assert_eq!(parse_spice_value("1.5Meg").unwrap(), 1.5e6);
        assert_eq!(parse_spice_value("2.2u").unwrap(), 2.2e-6);
        assert_eq!(parse_spice_value("100").unwrap(), 100.0);
        assert_eq!(parse_spice_value("10nF").unwrap(), 10e-9);
    }
```

### src/simulation/mcu-spice-bridge.ts::createMcuSpiceBridge
```ts
export function createMcuSpiceBridge(
  mcu: McuRuntime,
  gpioCount: number = 8
): McuSpiceBridge {
  const gpioPins: GpioPin[] = [];

  for (let port = 0; port < 1; port++) {
    for (let bit = 0; bit < 8; bit++) {
      if (gpioPins.length >= gpioCount) break;
      gpioPins.push({
        port,
        // ... [omitted 7 lines] ...

  return {
    config: {
      mcu,
      gpioPins,
      spiceNodeVoltages: new Map(),
      voltageThresholdHigh: 2.5,
      voltageThresholdLow: 0.8,
      updateIntervalCycles: 1
    },
    events: [],
    cycleCount: 0,
    lastUpdateCycle: 0
  };
}
```

### src-tauri/src/solver.rs::test_sparse_lu_real_solver
```rs
    fn test_sparse_lu_real_solver() {
        let matrix = DMatrix::from_row_slice(3, 3, &[
            2.0, -1.0,  0.0,
           -1.0,  2.0, -1.0,
            0.0, -1.0,  2.0,
        ]);
        let b = DVector::from_row_slice(&[1.0, 0.0, 1.0]);
        let decomp_dense = matrix.clone().lu();
        let expected_x = decomp_dense.solve(&b).unwrap();
        let x = solve_sparse(&matrix, &b).unwrap();
        for i in 0..3 {
            assert!((x[i] - expected_x[i]).abs() < 1e-12, "x[{}] = {} debería ser {}", i, x[i], expected_x[i]);
        }
    }
```

### src-tauri/src/parser.rs::parse_spice_value
```rs
pub fn parse_spice_value(s: &str) -> Result<f64, String> { let clean = s.trim().to_lowercase(); if clean.is_empty() { return Err("Valor de SPICE vacío".to_string()); } // Encontrar el primer caracter no numérico (excluyendo signo, punto y e/e- para notación científica) let mut num_end = clean.len(); let chars: Vec<char> = clean.chars().collect(); for (i, &c) in chars.iter().enumerate() { if c.is_alphabetic() { // Verificar si es parte de notación científica (ej: 1e-3) if c == 'e' && i + 1 < chars.len() && (chars[i+1].is_numeric() || chars[i+1] == '-' || chars[i+1] == '+') { continue; } num_end = i; break; } } let num_str = &clean[..num_end]; let mut val = num_str.parse::<f64>().map_err(|e| format!("No se pudo parsear número '{}': {}", num_str, e))?; let suffix_str = &clean[num_end..]; if !suffix_str.is_empty() { if suffix_str.starts_with("meg") { val *= 1e6; } else if suffix_str.starts_with("mil") { val *= 25.4e-6; // 1 mil en metros (típico en PCB, pero en SPICE a veces es 1e-3, usemos 25.4e-6
    ...
```

### src-tauri/src/parser.rs::test_spice_netlist_flattening
```rs
    fn test_spice_netlist_flattening() {
        let netlist_str = "
        * Test circuit with subcircuit
        .subckt lowpass in out gnd
        R1 in out 1k tol=1%
        C1 out gnd 10u
        .ends
        
        V1 1 0 10
        X1 1 2 0 lowpass
        Rload 2 0 10k
        ";
        
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        assert_eq!(parsed.components.len(), 4); // V1, Rload, X1.R1, X1.C1
        
        // Find X1.R1
        let r1 = parsed.components.iter().find(|c| c.id == "X1.R1").unwrap();
        assert_eq!(r1.comp_type, "resistor");
        assert_eq!(r1.value, 1000.0);
        assert_eq!(r1.pins, vec!["1".to_string(), "2".to_string()]);
        assert_eq!(r1.tolerance, Some(0.01));

        let c1 = parsed.components.iter().find(|c| c.id == "X1.C1").unwrap();
        assert_eq!(c1.comp_type, "capacitor");
        assert!((c1.value - 10e-6).abs() < 1e-12, "El valor del capacitor debería ser aproximadamente 10u, obtenido: {}", c1.value);
        assert_eq!(c1.pins, vec!["2".to_string(), "0".to_string()]);
    }
```

### src-tauri/src/solver.rs::test_sparse_lu_complex_solver
```rs
    fn test_sparse_lu_complex_solver() {
        let matrix = DMatrix::from_row_slice(3, 3, &[
            Complex::new(2.0, 1.0), Complex::new(-1.0, 0.0), Complex::new(0.0, 0.0),
            Complex::new(-1.0, 0.0), Complex::new(2.0, -1.0), Complex::new(-1.0, 0.0),
            Complex::new(0.0, 0.0), Complex::new(-1.0, 0.0), Complex::new(2.0, 2.0),
        ]);
        let b = DVector::from_row_slice(&[
            Complex::new(1.0, 0.0),
            Complex::new(0.0, 0.0),
            Complex::new(1.0, 0.0),
        ]);
        let decomp_dense = matrix.clone().lu();
        let expected_x = decomp_dense.solve(&b).unwrap();
        let x = solve_complex_sparse(&matrix, &b).unwrap();
        for i in 0..3 {
            assert!((x[i] - expected_x[i]).norm() < 1e-12, "x[{}] = {:?} debería ser {:?}", i, x[i], expected_x[i]);
        }
    }
```


## SUPPORT
- src/main.ts::CircuitNetlist: `interface CircuitNetlist {`

- src/simulation/mcu-spice-bridge.ts::McuSpiceBridge: `export type McuSpiceBridge = {`

- src-tauri/src/sparse_parallel.rs::Some: `Some(x) => x,`
