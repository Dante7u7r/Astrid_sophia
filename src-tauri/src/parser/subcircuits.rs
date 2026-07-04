use std::collections::HashMap;
use crate::solver::{ComponentData, CircuitNetlist};

#[allow(unused_imports)]
use super::lexer::*;
#[allow(unused_imports)]
use super::expressions::*;
#[allow(unused_imports)]
use super::devices::*;

#[derive(Clone, Debug)]
pub struct SubcktTemplate {
    pub name: String,
    pub pins: Vec<String>,
    pub lines: Vec<String>,
    pub default_params: HashMap<String, f64>,
}

// Crear template virtual para SCR (Silicon Controlled Rectifier)
// Modelo de 2 BJTs regenerativos: PNP (superior) + NPN (inferior)
// Conexiones en orden [Base, Collector, Emitter] de Astrid_sophia
pub fn create_scr_template() -> SubcktTemplate {
    SubcktTemplate {
        name: "SCR_VIRTUAL".to_string(),
        pins: vec!["anode".to_string(), "cathode".to_string(), "gate".to_string()],
        lines: vec![
            "Qpnp N1 gate anode pnp_scr".to_string(),
            "Qnpn gate N1 cathode npn_scr".to_string(),
            "Rgk gate cathode 1k".to_string(),
        ],
        default_params: HashMap::new(),
    }
}

// Crear template virtual para TRIAC (Triode for Alternating Current)
// Modelo de 2 SCRs en antiparalelo con gate común
pub fn create_triac_template() -> SubcktTemplate {
    SubcktTemplate {
        name: "TRIAC_VIRTUAL".to_string(),
        pins: vec!["mt1".to_string(), "mt2".to_string(), "gate".to_string()],
        lines: vec![
            "Qpnp1 N1 gate mt1 pnp_triac".to_string(),
            "Qnpn1 gate N1 mt2 npn_triac".to_string(),
            "Qpnp2 N3 gate mt2 pnp_triac".to_string(),
            "Qnpn2 gate N3 mt1 npn_triac".to_string(),
            "Rgk1 gate mt1 1k".to_string(),
            "Rgk2 gate mt2 1k".to_string(),
        ],
        default_params: HashMap::new(),
    }
}

// Obtener el template de subcircuito y el mapa de modelos local (para SCR/TRIAC virtuales)
pub fn get_subckt_template_and_models(
    subckt_name: &str,
    first_char: char,
    templates: &HashMap<String, SubcktTemplate>,
    models: &HashMap<String, DeviceModel>,
    global_params: &HashMap<String, f64>,
) -> Option<(SubcktTemplate, HashMap<String, DeviceModel>)> {
    let is_scr_or_triac = if first_char == 's' || first_char == 't' {
        if let Some(m) = models.get(subckt_name) {
            m.model_type == "scr" || m.model_type == "triac"
        } else {
            false
        }
    } else {
        false
    };

    if is_scr_or_triac {
        let m = models.get(subckt_name).unwrap();
        let _vgt = get_evaluated_model_param(m, "vgt", global_params).unwrap_or(crate::solver::SCR_DEFAULT_VGT);
        let ih = get_evaluated_model_param(m, "ih", global_params).unwrap_or(crate::solver::SCR_DEFAULT_IH);

        let tpl = if first_char == 's' {
            create_scr_template()
        } else {
            create_triac_template()
        };

        let mut local_models = models.clone();
        let beta = (50.0 * (5e-3 / ih)).clamp(10.0, crate::solver::SCR_MAX_BETA);

        if first_char == 's' {
            local_models.insert("pnp_scr".to_string(), DeviceModel {
                name: "pnp_scr".to_string(),
                model_type: "pnp".to_string(),
                params: [
                    ("is".to_string(), crate::solver::SCR_DEFAULT_IS),
                    ("bf".to_string(), beta),
                    ("vaf".to_string(), 100.0),
                    ("rb".to_string(), 1.0),   // Resistencia interna de base baja
                    ("rc".to_string(), 0.1),   // Resistencia interna de colector baja
                    ("cje".to_string(), 100e-12),
                    ("cjc".to_string(), 50e-12),
                ].into_iter().collect(),
                param_expressions: HashMap::new(),
                va_ports: None,
                va_equations: None,
            });
            local_models.insert("npn_scr".to_string(), DeviceModel {
                name: "npn_scr".to_string(),
                model_type: "npn".to_string(),
                params: [
                    ("is".to_string(), crate::solver::SCR_DEFAULT_IS),
                    ("bf".to_string(), beta),
                    ("vaf".to_string(), 100.0),
                    ("rb".to_string(), 1.0),   // Resistencia interna de base baja
                    ("rc".to_string(), 0.1),   // Resistencia interna de colector baja
                    ("cje".to_string(), 100e-12),
                    ("cjc".to_string(), 50e-12),
                ].into_iter().collect(),
                param_expressions: HashMap::new(),
                va_ports: None,
                va_equations: None,
            });
        } else {
            local_models.insert("pnp_triac".to_string(), DeviceModel {
                name: "pnp_triac".to_string(),
                model_type: "pnp".to_string(),
                params: [
                    ("is".to_string(), crate::solver::SCR_DEFAULT_IS),
                    ("bf".to_string(), beta),
                    ("vaf".to_string(), 100.0),
                    ("rb".to_string(), 1.0),   // Resistencia interna de base baja
                    ("rc".to_string(), 0.1),   // Resistencia interna de colector baja
                    ("cje".to_string(), 100e-12),
                    ("cjc".to_string(), 50e-12),
                ].into_iter().collect(),
                param_expressions: HashMap::new(),
                va_ports: None,
                va_equations: None,
            });
            local_models.insert("npn_triac".to_string(), DeviceModel {
                name: "npn_triac".to_string(),
                model_type: "npn".to_string(),
                params: [
                    ("is".to_string(), crate::solver::SCR_DEFAULT_IS),
                    ("bf".to_string(), beta),
                    ("vaf".to_string(), 100.0),
                    ("rb".to_string(), 1.0),   // Resistencia interna de base baja
                    ("rc".to_string(), 0.1),   // Resistencia interna de colector baja
                    ("cje".to_string(), 100e-12),
                    ("cjc".to_string(), 50e-12),
                ].into_iter().collect(),
                param_expressions: HashMap::new(),
                va_ports: None,
                va_equations: None,
            });
        }

        Some((tpl, local_models))
    } else {
        templates.get(subckt_name).map(|tpl| (tpl.clone(), models.clone()))
    }
}

// Aplanar de forma recursiva una instancia de subcircuito
#[allow(clippy::too_many_arguments)]
pub fn flatten_subcircuit(
    instance_id: &str,
    subckt_template: &SubcktTemplate,
    instantiation_pins: &[String],
    override_params: &HashMap<String, f64>,
    templates: &HashMap<String, SubcktTemplate>,
    models: &HashMap<String, DeviceModel>,
    components: &mut Vec<ComponentData>,
    global_params: &HashMap<String, f64>,
    next_internal_node: &mut usize,
) -> Result<(), String> {
    let mut local_node_map = HashMap::new();
    if instantiation_pins.len() != subckt_template.pins.len() {
        return Err(format!(
            "Error de pines en instancia {}: se esperaban {} pines, se proveyeron {}",
            instance_id,
            subckt_template.pins.len(),
            instantiation_pins.len()
        ));
    }

    // Construir el entorno de parámetros: global_params + defaults del template + overrides de instanciación
    let mut param_env = global_params.clone();
    for (k, v) in &subckt_template.default_params {
        param_env.insert(k.clone(), *v);
    }
    for (k, v) in override_params {
        param_env.insert(k.clone(), *v);
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
        
        let (num_pins, is_gate, is_subckt) = match first_char {
            'r' | 'c' | 'l' => (2, false, false),
            'd' => (2, false, false),
            'q' => (3, false, false), // BJT
            'j' => (3, false, false), // JFET (Drain, Gate, Source)
            'm' => (3, false, false), // MOSFET (simplificado a 3 pines en este simulador: G D S)
            'v' | 'i' => (2, false, false),
            'b' => (2, false, false), // B-source
            'e' | 'g' => (4, false, false), // VCVS, VCCS
            'f' | 'h' => (2, false, false), // CCCS, CCVS
            'o' => {
                // Optoacoplador (4 pines) vs Opamp (5 pines).
                // Híbrido: primero mirar el modelo .model; si no hay modelo, fallback por tokens.len().
                let model_name = tokens.last().unwrap();
                if let Some(m) = models.get(model_name) {
                    if m.model_type == "opto" { (4, false, false) } else { (5, false, false) }
                } else {
                    (if tokens.len() >= 7 { 5 } else { 4 }, false, false)
                }
            }
            's' => {
                // SCR: 3 pines (anode, cathode, gate)
                let model_name = tokens.last().unwrap();
                if let Some(m) = models.get(model_name) {
                    if m.model_type == "scr" { (3, false, true) } else { (2, false, false) }
                } else { (3, false, false) }
            }
            't' => {
                // TRIAC: 3 pines (mt1, mt2, gate)
                let model_name = tokens.last().unwrap();
                if let Some(m) = models.get(model_name) {
                    if m.model_type == "triac" { (3, false, true) } else { (2, false, false) }
                } else { (3, false, false) }
            }
            'y' => {
                let model_name = tokens.last().unwrap();
                if let Some(m) = models.get(model_name) {
                    if let Some(ref ports) = m.va_ports {
                        (ports.len(), false, false)
                    } else {
                        (3, false, false)
                    }
                } else {
                    (3, false, false)
                }
            }
            'x' => (0, false, true), // Instancia de subcircuito
            'u' | 'a' => {
                let line_lower = line.to_lowercase();
                if line_lower.contains("not_gate") {
                    (2, true, false)
                } else if line_lower.contains("and_gate") || line_lower.contains("or_gate") || line_lower.contains("nand_gate") || line_lower.contains("nor_gate") || line_lower.contains("xor_gate") {
                    (3, true, false)
                } else {
                    (5, false, false)
                }
            }
            _ => {
                // Opamp o componente desconocido
                if first_char == 'x' {
                    (0, false, true)
                } else {
                    // Mapear opamp que tiene 5 pines en este simulador
                    (5, false, false)
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

            // Extraer parámetros PARAMS: de la línea de instanciación interna del subcircuito
            let mut child_override_params = HashMap::new();
            let line_joined = tokens.join(" ");
            if let Some(params_idx) = line_joined.to_lowercase().find("params:") {
                let params_section = &line_joined[params_idx + 7..];
                for pair in params_section.split_whitespace() {
                    if let Some(eq_idx) = pair.find('=') {
                        let key = pair[..eq_idx].trim().to_lowercase();
                        let val_str = pair[eq_idx + 1..].trim();
                        if let Ok(val) = parse_spice_value(val_str) {
                            child_override_params.insert(key, val);
                        }
                    }
                }
            }

            if let Some((tpl, local_models)) = get_subckt_template_and_models(&subckt_name, first_char, templates, models, global_params) {
                flatten_subcircuit(&child_global_id, &tpl, &sub_pins_mapped, &child_override_params, templates, &local_models, components, global_params, next_internal_node)?;
            } else {
                return Err(format!("Subcircuito o modelo '{}' no encontrado", subckt_name));
            }
        } else {
            // Componente estándar
            let actual_pins_count = if is_gate {
                num_pins
            } else if first_char == 'o' {
                // Optoacoplador (4 pines) vs Opamp (5 pines) — distinción por modelo o tokens
                let model_name = tokens.last().unwrap();
                if let Some(m) = models.get(model_name) {
                    if m.model_type == "opto" { 4 } else { 5 }
                } else {
                    if tokens.len() >= 7 { 5 } else { 4 }
                }
            } else if first_char == 'u' || first_char == 'a' {
                if tokens.len() >= 7 { 5 } else { num_pins }
            } else {
                num_pins
            };

            if tokens.len() < actual_pins_count + 2 {
                continue;
            }

            let comp_pins_raw = &tokens[1..=actual_pins_count];
            let mut comp_pins_mapped = Vec::new();

            for p in comp_pins_raw {
                if p == "0" || p == "gnd" {
                    comp_pins_mapped.push("0".to_string());
                } else if let Some(mapped) = pin_map.get(p) {
                    comp_pins_mapped.push(mapped.clone());
                } else {
                    // Nodo interno del subcircuito
                    // Si el nombre del nodo no es un entero, le asignamos un identificador numérico único
                    if p.parse::<usize>().is_ok() {
                        comp_pins_mapped.push(p.clone());
                    } else {
                        let mapped_node = local_node_map.entry(p.clone()).or_insert_with(|| {
                            let node = *next_internal_node;
                            *next_internal_node += 1;
                            node.to_string()
                        });
                        comp_pins_mapped.push(mapped_node.clone());
                    }
                }
            }

            let value_or_model = &tokens[actual_pins_count + 1];
            
            let comp_type = if is_gate {
                value_or_model.clone()
            } else {
                match first_char {
                    'r' => "resistor".to_string(),
                    'c' => "capacitor".to_string(),
                    'l' => "inductor".to_string(),
                    'd' => {
                        if let Some(m) = models.get(value_or_model) {
                            if m.model_type == "led" { "led".to_string() } else { "diode".to_string() }
                        } else { "diode".to_string() }
                    },
                    'q' => {
                        if let Some(m) = models.get(value_or_model) {
                            m.model_type.clone()
                        } else {
                            "npn".to_string()
                        }
                    },
                    'j' => {
                        if let Some(m) = models.get(value_or_model) {
                            m.model_type.clone()
                        } else {
                            "njf".to_string()
                        }
                    },
                    'm' => {
                        if let Some(m) = models.get(value_or_model) {
                            m.model_type.clone()
                        } else {
                            "nmos".to_string()
                        }
                    },
                    'y' => "verilog_a".to_string(),
                    'v' => "vsource".to_string(),
                    'i' => "isource".to_string(),
                    'b' => {
                        let joined_rest = tokens[3..].join(" ");
                        let clean_rest = joined_rest.trim();
                        if clean_rest.to_lowercase().starts_with("i=") {
                            "bcurrent".to_string()
                        } else {
                            "bvoltage".to_string()
                        }
                    },
                    'e' => "vcvs".to_string(),
                    'g' => "vccs".to_string(),
                    'f' => "cccs".to_string(),
                    'h' => "ccvs".to_string(),
                    'o' => {
                        if let Some(m) = models.get(value_or_model) {
                            if m.model_type == "opto" { "opto".to_string() } else { "opamp".to_string() }
                        } else if tokens.len() == 6 {
                            "opto".to_string()
                        } else {
                            "opamp".to_string()
                        }
                    },
                    's' => {
                        if let Some(m) = models.get(value_or_model) {
                            if m.model_type == "scr" { "scr".to_string() } else { "resistor".to_string() }
                        } else { "scr".to_string() }
                    },
                    't' => {
                        if let Some(m) = models.get(value_or_model) {
                            if m.model_type == "triac" { "triac".to_string() } else { "resistor".to_string() }
                        } else { "triac".to_string() }
                    },
                    _ => "opamp".to_string(),
                }
            };

            // Construir ComponentData
            let mut comp = ComponentData {
                id: child_global_id,
                comp_type: comp_type.clone(),
                pins: comp_pins_mapped,
                ..Default::default()
            };

            if comp_type == "bvoltage" || comp_type == "bcurrent" {
                let joined_rest = tokens[3..].join(" ");
                let clean_rest = joined_rest.trim();
                let lower_clean_rest = clean_rest.to_lowercase();
                let expr_part = if lower_clean_rest.starts_with("v=") || lower_clean_rest.starts_with("i=") {
                    clean_rest[2..].trim()
                } else {
                    clean_rest
                };
                let mut expression = expr_part.to_string();
                if expression.starts_with('{') && expression.ends_with('}') {
                    expression = expression[1..expression.len()-1].trim().to_string();
                }
                comp.expression = Some(expression);
            }

            if (comp_type == "cccs" || comp_type == "ccvs")
                && tokens.len() >= 5 {
                    comp.controlling_source = Some(format!("{}.{}", instance_id, tokens[3]));
                    if let Ok(val) = parse_spice_value(&tokens[4]) {
                        comp.value = val;
                    }
                }

            // Parsear parámetros de compuertas lógicas si es compuerta
            if is_gate {
                for token in &tokens[(actual_pins_count + 2)..] {
                    let parts: Vec<&str> = token.split('=').collect();
                    if parts.len() == 2 {
                        let param_name = parts[0].trim().to_lowercase();
                        let param_val_str = parts[1].trim();
                        if let Ok(val) = parse_spice_value(param_val_str) {
                            if param_name == "delay" || param_name == "td" {
                                comp.delay = Some(val);
                            } else if param_name == "rise_delay" || param_name == "trise" {
                                comp.rise_delay = Some(val);
                            } else if param_name == "fall_delay" || param_name == "tfall" {
                                comp.fall_delay = Some(val);
                            } else if param_name == "vhigh" {
                                comp.gate_vhigh = Some(val);
                            } else if param_name == "vlow" {
                                comp.gate_vlow = Some(val);
                            }
                        }
                    }
                }
            }

            // Intentar parsear el valor numérico
            if let Ok(val) = parse_spice_value(value_or_model) {
                comp.value = val;
            } else {
                // Verificar si es una expresión entre llaves {expr}
                if value_or_model.starts_with('{') && value_or_model.ends_with('}') {
                    let expr = &value_or_model[1..value_or_model.len()-1];
                    if let Ok(val) = evaluate_expression(expr, &param_env) {
                        comp.value = val;
                    }
                } else if let Some(_full_val_token) = tokens.get(actual_pins_count + 1) {
                    // El valor podría estar en un token con llaves que contiene espacios,
                    // reconstruir de tokens si es necesario
                    let joined_rest = tokens[actual_pins_count + 1..].join(" ");
                    if let Some(open) = joined_rest.find('{') {
                        if let Some(close) = joined_rest.find('}') {
                            let expr = &joined_rest[open+1..close];
                            if let Ok(val) = evaluate_expression(expr, &param_env) {
                                comp.value = val;
                            }
                        }
                    }
                }
                if comp.comp_type == "diode" || comp.comp_type == "led" || comp.comp_type == "opto" || comp.comp_type == "scr" || comp.comp_type == "triac" || comp.comp_type == "npn" || comp.comp_type == "pnp" || comp.comp_type == "nmos" || comp.comp_type == "pmos" || comp.comp_type == "njf" || comp.comp_type == "pjf" || comp.comp_type == "verilog_a" {
                    // Inyectar el valor por defecto o del modelo
                    if let Some(m) = models.get(value_or_model) {
                        // Para transistores, guardamos el beta o valor de modulación en .value
                        if let Some(bf) = get_evaluated_model_param(m, "bf", &param_env) {
                            comp.value = bf;
                        } else if let Some(vto) = get_evaluated_model_param(m, "vto", &param_env) {
                            comp.value = vto; // Vth para MOSFETs
                        } else {
                            comp.value = 1.0;
                        }
                        if comp.comp_type == "diode" || comp.comp_type == "led" {
                            comp.diode_is = get_evaluated_model_param(m, "is", &param_env);
                            comp.diode_rs = get_evaluated_model_param(m, "rs", &param_env);
                            comp.diode_n = get_evaluated_model_param(m, "n", &param_env);
                            comp.diode_tt = get_evaluated_model_param(m, "tt", &param_env);
                            comp.diode_cjo = get_evaluated_model_param(m, "cjo", &param_env);
                            comp.diode_vj = get_evaluated_model_param(m, "vj", &param_env);
                            comp.diode_m = get_evaluated_model_param(m, "m", &param_env);
                            comp.diode_bv = get_evaluated_model_param(m, "bv", &param_env);
                            comp.diode_ibv = get_evaluated_model_param(m, "ibv", &param_env);
                        } else if comp.comp_type == "opto" {
                            // Parámetros del optoacoplador: CTR, Is, N, Vsat
                            comp.opto_ctr  = get_evaluated_model_param(m, "ctr",  &param_env);
                            comp.opto_is   = get_evaluated_model_param(m, "is",   &param_env);
                            comp.opto_n    = get_evaluated_model_param(m, "n",    &param_env);
                            comp.opto_vsat = get_evaluated_model_param(m, "vsat", &param_env);
                            // El LED interno usa diode_is/diode_n como fallback en el solver
                            comp.diode_is = comp.opto_is;
                            comp.diode_n  = comp.opto_n;
                        } else if comp.comp_type == "scr" || comp.comp_type == "triac" {
                            // Parámetros del tiristor/TRIAC: Vgt (voltaje de disparo) e Ih (corriente de mantenimiento)
                            comp.scr_vgt = get_evaluated_model_param(m, "vgt", &param_env);
                            comp.scr_ih  = get_evaluated_model_param(m, "ih",  &param_env);
                        } else if comp.comp_type == "npn" || comp.comp_type == "pnp" {
                            comp.bjt_is = get_evaluated_model_param(m, "is", &param_env);
                            comp.bjt_bf = get_evaluated_model_param(m, "bf", &param_env);
                            comp.bjt_vaf = get_evaluated_model_param(m, "vaf", &param_env);
                            comp.bjt_rb = get_evaluated_model_param(m, "rb", &param_env);
                            comp.bjt_rc = get_evaluated_model_param(m, "rc", &param_env);
                            comp.bjt_cje = get_evaluated_model_param(m, "cje", &param_env);
                            comp.bjt_cjc = get_evaluated_model_param(m, "cjc", &param_env);
                            comp.bjt_tf = get_evaluated_model_param(m, "tf", &param_env);
                            comp.bjt_tr = get_evaluated_model_param(m, "tr", &param_env);
                        } else if comp.comp_type == "njf" || comp.comp_type == "pjf" {
                            comp.jfet_vto = get_evaluated_model_param(m, "vto", &param_env);
                            comp.jfet_beta = get_evaluated_model_param(m, "beta", &param_env);
                            comp.jfet_lambda = get_evaluated_model_param(m, "lambda", &param_env);
                            comp.jfet_cgs = get_evaluated_model_param(m, "cgs", &param_env);
                            comp.jfet_cgd = get_evaluated_model_param(m, "cgd", &param_env);
                        } else if comp.comp_type == "nmos" || comp.comp_type == "pmos" || comp.comp_type == "bsim3nmos" || comp.comp_type == "bsim3pmos" || comp.comp_type == "bsim4nmos" || comp.comp_type == "bsim4pmos" {
                            comp.bsim_vmax = get_evaluated_model_param(m, "vmax", &param_env);
                            comp.bsim_u0 = get_evaluated_model_param(m, "u0", &param_env);
                            comp.bsim_tox = get_evaluated_model_param(m, "tox", &param_env);
                            comp.bsim_eta0 = get_evaluated_model_param(m, "eta0", &param_env);
                            comp.bsim_theta = get_evaluated_model_param(m, "theta", &param_env);
                        } else if comp.comp_type == "verilog_a" {
                            comp.va_model_name = Some(m.name.clone());
                            comp.va_ports = m.va_ports.clone();
                            if let Some(ref eqs) = m.va_equations {
                                let mut serialized_eqs = Vec::new();
                                for (from, to, expr) in eqs {
                                    serialized_eqs.push((from.clone(), to.clone(), format_va_expr(expr)));
                                }
                                comp.va_equations = Some(serialized_eqs);
                            }
                        }
                    } else {
                        comp.value = 1.0;
                    }
                }
            }

            // Parsear tolerancia opcional (ej: tol=1%) y parámetros térmicos (rth=, cth=)
            for tok in &tokens[actual_pins_count + 2..] {
                let tok_lower = tok.to_lowercase();
                if tok_lower.starts_with("tol=") {
                    let tol_str = &tok[4..].replace("%", "");
                    if let Ok(tol_val) = tol_str.parse::<f64>() {
                        comp.tolerance = Some(tol_val / 100.0);
                    }
                } else if tok_lower.starts_with("rth=") {
                    if let Ok(val) = parse_spice_value(&tok[4..]) {
                        comp.rth = Some(val);
                    }
                } else if tok_lower.starts_with("cth=") {
                    if let Ok(val) = parse_spice_value(&tok[4..]) {
                        comp.cth = Some(val);
                    }
                }
            }

            // Si es vsource o isource, comprobar si tiene funciones senoidales o de pulso
            if (comp.comp_type == "vsource" || comp.comp_type == "isource") && tokens.len() > 3 {
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
/// Expande los componentes tipo 'x' de un CircuitNetlist utilizando las
/// definiciones de subcircuito proporcionadas en `subcircuit_definitions`.
/// Construye un netlist de texto plano (definiciones + líneas X) y lo
/// re‑parsea para que el aplanador jerárquico convierta cada X en sus
/// componentes primitivos. Los componentes no‑X se conservan intactos.
pub fn expand_netlist_subcircuits(netlist: &CircuitNetlist) -> Result<CircuitNetlist, String> {
    let defs = match &netlist.subcircuit_definitions {
        Some(d) if !d.trim().is_empty() => d.clone(),
        _ => return Ok(netlist.clone()),
    };

    // Separar componentes tipo 'x' del resto
    let mut x_lines = String::new();
    let mut regular_comps: Vec<ComponentData> = Vec::new();

    for comp in &netlist.components {
        if comp.comp_type == "x" {
            // Generar línea SPICE de instanciación: X<nombre> <pin0> <pin1> ... <subckt_name>
            x_lines.push_str(&comp.id);
            for pin in &comp.pins {
                x_lines.push(' ');
                x_lines.push_str(pin);
            }
            // El nombre del subcircuito se toma del campo subcircuit_name,
            // o del valor numérico como fallback
            let fallback_name = comp.value.to_string();
            let name = comp
                .subcircuit_name
                .as_deref()
                .unwrap_or(&fallback_name);
            x_lines.push(' ');
            x_lines.push_str(name);
            x_lines.push('\n');
        } else {
            regular_comps.push(comp.clone());
        }
    }

    if x_lines.is_empty() {
        return Ok(netlist.clone());
    }

    // Combinar definiciones + líneas X y parsear
    let combined_text = format!("{}{}", defs, x_lines);
    let expanded = parse_spice_netlist_to_native(&combined_text)?;

    // Fusionar: componentes regulares originales + componentes expandidos
    let mut all_components = regular_comps;
    all_components.extend(expanded.components);

    Ok(CircuitNetlist {
        components: all_components,
        wires: netlist.wires.clone(),
        temperature: netlist.temperature,
        fixed_step: netlist.fixed_step,
        mutual_inductances: netlist.mutual_inductances.clone(),
        thermal_config: netlist.thermal_config.clone(),
        subcircuit_definitions: None,
        triggers: None,
    })
}

