use crate::solver::{ComponentData, CircuitNetlist};
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct SubcktTemplate {
    pub name: String,
    pub pins: Vec<String>,
    pub lines: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct DeviceModel {
    pub name: String,
    pub model_type: String, // "d", "npn", "pnp", etc.
    pub params: HashMap<String, f64>,
}

// Mapea sufijos de SPICE a multiplicadores decimales
pub fn parse_spice_value(s: &str) -> Result<f64, String> {
    let clean = s.trim().to_lowercase();
    if clean.is_empty() {
        return Err("Valor de SPICE vacío".to_string());
    }

    // Encontrar el primer caracter no numérico (excluyendo signo, punto y e/e- para notación científica)
    let mut num_end = clean.len();
    let chars: Vec<char> = clean.chars().collect();
    
    for (i, &c) in chars.iter().enumerate() {
        if c.is_alphabetic() {
            // Verificar si es parte de notación científica (ej: 1e-3)
            if c == 'e' && i + 1 < chars.len() && (chars[i+1].is_numeric() || chars[i+1] == '-' || chars[i+1] == '+') {
                continue;
            }
            num_end = i;
            break;
        }
    }

    let num_str = &clean[..num_end];
    let mut val = num_str.parse::<f64>().map_err(|e| format!("No se pudo parsear número '{}': {}", num_str, e))?;

    let suffix_str = &clean[num_end..];
    if !suffix_str.is_empty() {
        if suffix_str.starts_with("meg") {
            val *= 1e6;
        } else if suffix_str.starts_with("mil") {
            val *= 25.4e-6; // 1 mil en metros (típico en PCB, pero en SPICE a veces es 1e-3, usemos 25.4e-6 o 1e-3. ngspice mapea mil a 25.4e-6)
        } else {
            match suffix_str.chars().next().unwrap() {
                't' => val *= 1e12,
                'g' => val *= 1e9,
                'k' => val *= 1e3,
                'm' => val *= 1e-3, // milis
                'u' => val *= 1e-6,
                'n' => val *= 1e-9,
                'p' => val *= 1e-12,
                'f' => val *= 1e-15,
                _ => {} // Otros caracteres son ignorados por SPICE (ej: 10kOhm -> 10k)
            }
        }
    }

    Ok(val)
}

// Analiza los parámetros de una función como sine(0 5 10k) o pulse(0 5 10k 0.5)
fn parse_waveform(wave_str: &str) -> Option<(String, Vec<f64>)> {
    let clean = wave_str.trim();
    let open_idx = clean.find('(')?;
    let close_idx = clean.find(')')?;
    if close_idx <= open_idx {
        return None;
    }
    
    let wave_type = clean[..open_idx].trim().to_lowercase();
    let params_str = &clean[open_idx + 1..close_idx];
    
    let mut params = Vec::new();
    // Separar por espacios o comas
    for token in params_str.split(|c| c == ' ' || c == ',' || c == '\t') {
        let t = token.trim();
        if !t.is_empty() {
            if let Ok(val) = parse_spice_value(t) {
                params.push(val);
            }
        }
    }
    
    Some((wave_type, params))
}

// Parser de directiva .model
fn parse_model_directive(line: &str) -> Option<DeviceModel> {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() < 3 || !tokens[0].eq_ignore_ascii_case(".model") {
        return None;
    }

    let model_name = tokens[1].to_string();
    
    // El tipo puede estar entre paréntesis o directo, ej: npn o npn(...)
    let mut type_raw = tokens[2].to_lowercase();
    let params_start_idx = 3;
    let mut params_str = String::new();

    if let Some(open_idx) = type_raw.find('(') {
        let type_clean = type_raw[..open_idx].to_string();
        params_str.push_str(&type_raw[open_idx + 1..]);
        type_raw = type_clean;
    }

    for &tok in &tokens[params_start_idx..] {
        params_str.push(' ');
        params_str.push_str(tok);
    }

    if let Some(close_idx) = params_str.find(')') {
        params_str = params_str[..close_idx].to_string();
    }

    let mut params = HashMap::new();
    // Parsear parejas clave=valor (ej: bf=150 is=1e-14)
    let clean_params = params_str.replace("=", " = ").replace(",", " ");
    let mut param_tokens = clean_params.split_whitespace().peekable();
    
    while let Some(key) = param_tokens.next() {
        if key == "=" {
            continue;
        }
        if param_tokens.peek() == Some(&"=") {
            param_tokens.next(); // consumir '='
            if let Some(val_str) = param_tokens.next() {
                if let Ok(val) = parse_spice_value(val_str) {
                    params.insert(key.to_lowercase(), val);
                }
            }
        } else {
            // En algunos modelos SPICE se puede especificar clave=valor sin espacios, ya lo manejamos con replace
        }
    }

    Some(DeviceModel {
        name: model_name,
        model_type: type_raw,
        params,
    })
}

// Aplanar de forma recursiva una instancia de subcircuito
fn flatten_subcircuit(
    instance_id: &str,
    subckt_template: &SubcktTemplate,
    instantiation_pins: &[String],
    templates: &HashMap<String, SubcktTemplate>,
    models: &HashMap<String, DeviceModel>,
    components: &mut Vec<ComponentData>,
) -> Result<(), String> {
    if instantiation_pins.len() != subckt_template.pins.len() {
        return Err(format!(
            "Error de pines en instancia {}: se esperaban {} pines, se proveyeron {}",
            instance_id,
            subckt_template.pins.len(),
            instantiation_pins.len()
        ));
    }

    // Crear mapa de mapeo de pines: del template del subcircuito a los pines reales provistos
    let mut pin_map = HashMap::new();
    for (tpl_pin, real_pin) in subckt_template.pins.iter().zip(instantiation_pins.iter()) {
        pin_map.insert(tpl_pin.clone(), real_pin.clone());
    }

    // Procesar cada línea interna del subcircuito
    for line in &subckt_template.lines {
        let clean = line.trim();
        if clean.is_empty() || clean.starts_with('*') {
            continue;
        }

        let tokens: Vec<String> = clean.split_whitespace().map(|s| s.to_string()).collect();
        if tokens.is_empty() {
            continue;
        }

        let child_local_id = &tokens[0];
        let child_global_id = format!("{}.{}", instance_id, child_local_id);

        if child_local_id.starts_with('.') {
            // Directivas locales en subcircuitos no se procesan o se ignoran
            continue;
        }

        // Mapear los pines del componente hijo
        let first_char = child_local_id.chars().next().unwrap().to_ascii_lowercase();
        
        let (num_pins, is_subckt) = match first_char {
            'r' | 'c' | 'l' => (2, false),
            'd' => (2, false),
            'q' => (3, false), // BJT
            'm' => (3, false), // MOSFET (simplificado a 3 pines en este simulador: G D S)
            'v' | 'i' => (2, false),
            'x' => (0, true), // Instancia de subcircuito
            _ => {
                // Opamp o componente desconocido
                if first_char == 'x' {
                    (0, true)
                } else {
                    // Mapear opamp que tiene 5 pines en este simulador
                    (5, false)
                }
            }
        };

        if is_subckt {
            // Instancia interna de otro subcircuito
            // Sintaxis: Xhijo pin1 pin2 ... pinN nombre_subcircuito
            if tokens.len() < 3 {
                return Err(format!("Línea de subcircuito inválida en {}: {}", instance_id, line));
            }
            let subckt_name = tokens.last().unwrap().clone();
            let sub_pins_raw = &tokens[1..tokens.len() - 1];

            // Mapear pines locales del subcircuito usando el pin_map actual
            let mut sub_pins_mapped = Vec::new();
            for p in sub_pins_raw {
                if let Some(mapped) = pin_map.get(p) {
                    sub_pins_mapped.push(mapped.clone());
                } else {
                    // Si no está en el mapa, es un nodo interno del subcircuito padre
                    sub_pins_mapped.push(format!("{}.{}", instance_id, p));
                }
            }

            if let Some(tpl) = templates.get(&subckt_name) {
                flatten_subcircuit(&child_global_id, tpl, &sub_pins_mapped, templates, models, components)?;
            } else {
                return Err(format!("Subcircuito '{}' no encontrado", subckt_name));
            }
        } else {
            // Componente estándar
            if tokens.len() < num_pins + 2 {
                // Puede ser un opamp
                let actual_pins = if first_char == 'o' || tokens.len() >= 7 { 5 } else { num_pins };
                if tokens.len() < actual_pins + 2 {
                    continue;
                }
            }

            let actual_pins_count = if first_char == 'o' { 5 } else { num_pins };
            let comp_pins_raw = &tokens[1..=actual_pins_count];
            let mut comp_pins_mapped = Vec::new();

            for p in comp_pins_raw {
                if p == "0" || p == "gnd" {
                    comp_pins_mapped.push("0".to_string());
                } else if let Some(mapped) = pin_map.get(p) {
                    comp_pins_mapped.push(mapped.clone());
                } else {
                    // Nodo interno
                    comp_pins_mapped.push(format!("{}.{}", instance_id, p));
                }
            }

            let value_or_model = &tokens[actual_pins_count + 1];
            
            // Construir ComponentData
            let mut comp = ComponentData {
                id: child_global_id,
                comp_type: match first_char {
                    'r' => "resistor".to_string(),
                    'c' => "capacitor".to_string(),
                    'l' => "inductor".to_string(),
                    'd' => "diode".to_string(),
                    'q' => {
                        // Determinar si es npn o pnp según el modelo
                        if let Some(m) = models.get(value_or_model) {
                            m.model_type.clone()
                        } else {
                            "npn".to_string() // valor por defecto
                        }
                    },
                    'm' => {
                        if let Some(m) = models.get(value_or_model) {
                            m.model_type.clone()
                        } else {
                            "nmos".to_string()
                        }
                    },
                    'v' => "vsource".to_string(),
                    'i' => "isource".to_string(),
                    _ => "opamp".to_string(),
                },
                pins: comp_pins_mapped,
                ..Default::default()
            };

            // Intentar parsear el valor numérico
            if let Ok(val) = parse_spice_value(value_or_model) {
                comp.value = val;
            } else {
                // Es un modelo o subcircuito (ej: D1 1 2 1N4148)
                if comp.comp_type == "diode" || comp.comp_type == "npn" || comp.comp_type == "pnp" || comp.comp_type == "nmos" || comp.comp_type == "pmos" {
                    // Inyectar el valor por defecto o del modelo
                    if let Some(m) = models.get(value_or_model) {
                        // Para transistores, guardamos el beta o valor de modulación en .value
                        if let Some(&bf) = m.params.get("bf") {
                            comp.value = bf;
                        } else if let Some(&vto) = m.params.get("vto") {
                            comp.value = vto; // Vth para MOSFETs
                        } else {
                            comp.value = 1.0;
                        }
                    } else {
                        comp.value = 1.0;
                    }
                }
            }

            // Parsear tolerancia opcional (ej: tol=1%)
            for tok in &tokens[actual_pins_count + 2..] {
                if tok.to_lowercase().starts_with("tol=") {
                    let tol_str = &tok[4..].replace("%", "");
                    if let Ok(tol_val) = tol_str.parse::<f64>() {
                        comp.tolerance = Some(tol_val / 100.0);
                    }
                }
            }

            // Si es vsource, comprobar si tiene funciones senoidales o de pulso
            if comp.comp_type == "vsource" && tokens.len() > 3 {
                // Unir los tokens restantes por si hay espacios
                let remaining = tokens[3..].join(" ");
                if let Some((wave_type, params)) = parse_waveform(&remaining) {
                    comp.wave_type = Some(wave_type.clone());
                    if wave_type == "sine" && params.len() >= 3 {
                        comp.offset = Some(params[0]);
                        comp.amplitude = Some(params[1]);
                        comp.frequency = Some(params[2]);
                    } else if wave_type == "pulse" && params.len() >= 4 {
                        comp.offset = Some(params[0]);
                        comp.amplitude = Some(params[1]);
                        comp.frequency = Some(params[2]);
                        comp.duty_cycle = Some(params[3]);
                    }
                }
            }

            components.push(comp);
        }
    }

    Ok(())
}

// Función principal del Parser SPICE
pub fn parse_spice_netlist_to_native(netlist_str: &str) -> Result<CircuitNetlist, String> {
    let mut templates = HashMap::new();
    let mut models = HashMap::new();
    let mut root_lines = Vec::new();

    // Fase 1: Leer y catalogar subcircuitos (.subckt / .ends), modelos (.model) y líneas raíz
    let mut current_subckt: Option<SubcktTemplate> = None;
    
    // Manejar continuación de línea con '+'
    let mut processed_lines = Vec::new();
    let mut accum_line = String::new();

    for raw_line in netlist_str.lines() {
        let clean = raw_line.trim();
        if clean.is_empty() || clean.starts_with('*') {
            continue;
        }

        if clean.starts_with('+') {
            // Línea de continuación
            accum_line.push(' ');
            accum_line.push_str(&clean[1..]);
        } else {
            if !accum_line.is_empty() {
                processed_lines.push(accum_line.clone());
            }
            accum_line = clean.to_string();
        }
    }
    if !accum_line.is_empty() {
        processed_lines.push(accum_line);
    }

    for line in processed_lines {
        let clean = line.trim();
        let tokens: Vec<String> = clean.split_whitespace().map(|s| s.to_string()).collect();
        if tokens.is_empty() {
            continue;
        }

        let first = tokens[0].to_lowercase();

        if first == ".subckt" {
            if tokens.len() < 3 {
                return Err("Declaración de .subckt inválida. Formato: .subckt nombre pin1 pin2 ...".to_string());
            }
            let name = tokens[1].clone();
            let pins = tokens[2..].to_vec();
            current_subckt = Some(SubcktTemplate {
                name,
                pins,
                lines: Vec::new(),
            });
        } else if first == ".ends" {
            if let Some(subckt) = current_subckt.take() {
                templates.insert(subckt.name.clone(), subckt);
            } else {
                return Err("Directiva .ends huérfana sin un .subckt correspondiente".to_string());
            }
        } else if first == ".model" {
            if let Some(model) = parse_model_directive(&line) {
                models.insert(model.name.clone(), model);
            }
        } else {
            // Si estamos dentro de un subcircuito, añadir línea al template
            if let Some(ref mut subckt) = current_subckt {
                subckt.lines.push(line);
            } else {
                // De lo contrario, es línea de nivel raíz del circuito
                root_lines.push(line);
            }
        }
    }

    // Fase 2: Procesar componentes raíz y aplanar subcircuitos
    let mut components = Vec::new();

    for line in root_lines {
        let tokens: Vec<String> = line.split_whitespace().map(|s| s.to_string()).collect();
        if tokens.is_empty() {
            continue;
        }

        let id = tokens[0].clone();
        let first_char = id.chars().next().unwrap().to_ascii_lowercase();

        if id.starts_with('.') {
            // Directivas globales (.dc, .tran, .ac) - Se pueden ignorar para el netlist estático
            continue;
        }

        let (num_pins, is_subckt) = match first_char {
            'r' | 'c' | 'l' => (2, false),
            'd' => (2, false),
            'q' => (3, false),
            'm' => (3, false),
            'v' | 'i' => (2, false),
            'x' => (0, true),
            _ => {
                if first_char == 'x' {
                    (0, true)
                } else {
                    // Opamp
                    (5, false)
                }
            }
        };

        if is_subckt {
            if tokens.len() < 3 {
                return Err(format!("Línea de subcircuito inválida: {}", line));
            }
            let subckt_name = tokens.last().unwrap().clone();
            let sub_pins = &tokens[1..tokens.len() - 1];

            // Aplanar subcircuito
            if let Some(tpl) = templates.get(&subckt_name) {
                flatten_subcircuit(&id, tpl, sub_pins, &templates, &models, &mut components)?;
            } else {
                return Err(format!("Subcircuito '{}' no encontrado", subckt_name));
            }
        } else {
            let pins_count = if first_char == 'o' || tokens.len() >= 7 { 5 } else { num_pins };
            if tokens.len() < pins_count + 2 {
                continue;
            }

            let comp_pins = &tokens[1..=pins_count];
            let mut pins = Vec::new();
            for p in comp_pins {
                if p == "0" || p == "gnd" {
                    pins.push("0".to_string());
                } else {
                    pins.push(p.clone());
                }
            }

            let value_or_model = &tokens[pins_count + 1];

            let mut comp = ComponentData {
                id: id.clone(),
                comp_type: match first_char {
                    'r' => "resistor".to_string(),
                    'c' => "capacitor".to_string(),
                    'l' => "inductor".to_string(),
                    'd' => "diode".to_string(),
                    'q' => {
                        if let Some(m) = models.get(value_or_model) {
                            m.model_type.clone()
                        } else {
                            "npn".to_string()
                        }
                    },
                    'm' => {
                        if let Some(m) = models.get(value_or_model) {
                            m.model_type.clone()
                        } else {
                            "nmos".to_string()
                        }
                    },
                    'v' => "vsource".to_string(),
                    'i' => "isource".to_string(),
                    _ => "opamp".to_string(),
                },
                pins,
                ..Default::default()
            };

            if let Ok(val) = parse_spice_value(value_or_model) {
                comp.value = val;
            } else {
                // Modelo
                if comp.comp_type == "diode" || comp.comp_type == "npn" || comp.comp_type == "pnp" || comp.comp_type == "nmos" || comp.comp_type == "pmos" {
                    if let Some(m) = models.get(value_or_model) {
                        if let Some(&bf) = m.params.get("bf") {
                            comp.value = bf;
                        } else if let Some(&vto) = m.params.get("vto") {
                            comp.value = vto;
                        } else {
                            comp.value = 1.0;
                        }
                    } else {
                        comp.value = 1.0;
                    }
                }
            }

            // Tol=
            for tok in &tokens[pins_count + 2..] {
                if tok.to_lowercase().starts_with("tol=") {
                    let tol_str = &tok[4..].replace("%", "");
                    if let Ok(tol_val) = tol_str.parse::<f64>() {
                        comp.tolerance = Some(tol_val / 100.0);
                    }
                }
            }

            // Waveform
            if comp.comp_type == "vsource" && tokens.len() > 3 {
                let remaining = tokens[3..].join(" ");
                if let Some((wave_type, params)) = parse_waveform(&remaining) {
                    comp.wave_type = Some(wave_type.clone());
                    if wave_type == "sine" && params.len() >= 3 {
                        comp.offset = Some(params[0]);
                        comp.amplitude = Some(params[1]);
                        comp.frequency = Some(params[2]);
                    } else if wave_type == "pulse" && params.len() >= 4 {
                        comp.offset = Some(params[0]);
                        comp.amplitude = Some(params[1]);
                        comp.frequency = Some(params[2]);
                        comp.duty_cycle = Some(params[3]);
                    }
                }
            }

            components.push(comp);
        }
    }

    Ok(CircuitNetlist {
        components,
        wires: Vec::new(), // En netlists SPICE, los cables se infieren directamente de los pines
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spice_value_parser() {
        assert_eq!(parse_spice_value("10k").unwrap(), 10000.0);
        assert_eq!(parse_spice_value("1.5Meg").unwrap(), 1.5e6);
        assert_eq!(parse_spice_value("2.2u").unwrap(), 2.2e-6);
        assert_eq!(parse_spice_value("100").unwrap(), 100.0);
        assert_eq!(parse_spice_value("10nF").unwrap(), 10e-9);
    }

    #[test]
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
}
