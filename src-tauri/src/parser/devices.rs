use super::resolve_includes;
use crate::solver::{CircuitNetlist, ComponentData, MutualInductance, ThermalConfig};
use std::collections::HashMap;

#[allow(unused_imports)]
use super::expressions::*;
#[allow(unused_imports)]
use super::lexer::*;
#[allow(unused_imports)]
use super::subcircuits::*;

#[derive(Clone, Debug)]
pub struct DeviceModel {
    pub name: String,
    pub model_type: String, // "d", "npn", "pnp", "verilog_a", etc.
    pub params: HashMap<String, f64>,
    pub param_expressions: HashMap<String, String>, // toxe -> "1.8e-9 + dtoxe"
    pub va_ports: Option<Vec<String>>,
    pub va_equations: Option<Vec<(String, String, VaExpr)>>, // (from_port, to_port, AST)
}

// Parser de directiva .model
pub fn parse_model_directive(line: &str) -> Option<DeviceModel> {
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

    let mut clean_params = params_str.trim();
    if clean_params.starts_with('(') && clean_params.ends_with(')') {
        clean_params = &clean_params[1..clean_params.len() - 1];
    } else if clean_params.ends_with(')') {
        clean_params = &clean_params[..clean_params.len() - 1];
    }
    let params_str = clean_params.to_string();

    let mut params = HashMap::new();
    let mut param_expressions = HashMap::new();

    // Parsear parejas clave=valor de forma consciente de bloques de llaves {...}
    let mut param_tokens = Vec::new();
    let mut current_token = String::new();
    let mut brace_level = 0;

    for c in params_str.chars() {
        match c {
            '{' => {
                brace_level += 1;
                current_token.push(c);
            }
            '}' => {
                if brace_level > 0 {
                    brace_level -= 1;
                }
                current_token.push(c);
            }
            '=' if brace_level == 0 => {
                let trimmed = current_token.trim().to_string();
                if !trimmed.is_empty() {
                    param_tokens.push(trimmed);
                }
                current_token.clear();
                param_tokens.push("=".to_string());
            }
            ' ' | '\t' | ',' if brace_level == 0 => {
                if c == ',' && type_raw.eq_ignore_ascii_case("verilog_a") {
                    current_token.push(c);
                } else {
                    let trimmed = current_token.trim().to_string();
                    if !trimmed.is_empty() {
                        param_tokens.push(trimmed);
                    }
                    current_token.clear();
                }
            }
            _ => {
                current_token.push(c);
            }
        }
    }
    let trimmed = current_token.trim().to_string();
    if !trimmed.is_empty() {
        param_tokens.push(trimmed);
    }

    let mut va_ports = None;
    let mut va_equations = None;

    if type_raw.eq_ignore_ascii_case("verilog_a") {
        let mut ports = Vec::new();
        let mut equations = Vec::new();

        let mut iter = param_tokens.into_iter().peekable();
        while let Some(key) = iter.next() {
            if key == "=" {
                continue;
            }
            if iter.peek() == Some(&"=".to_string()) {
                iter.next(); // consumir '='
                if let Some(val_str) = iter.next() {
                    let key_lower = key.to_lowercase();
                    if key_lower == "ports" {
                        let mut ports_clean =
                            val_str.trim_matches(|c| c == '\'' || c == '\"').trim();
                        if ports_clean.starts_with('(') && ports_clean.ends_with(')') {
                            ports_clean = &ports_clean[1..ports_clean.len() - 1];
                        }
                        ports = ports_clean
                            .split(',')
                            .map(|s| s.trim().to_string())
                            .collect();
                    } else if key_lower == "equation" {
                        let mut eq_clean = val_str.trim_matches(|c| c == '\'' || c == '\"').trim();
                        if eq_clean.starts_with('(') && eq_clean.ends_with(')') {
                            eq_clean = &eq_clean[1..eq_clean.len() - 1];
                        }
                        if let Some(arrow_idx) = eq_clean.find("<+") {
                            let target = &eq_clean[..arrow_idx].trim();
                            let expr_str = &eq_clean[arrow_idx + 2..].trim();

                            if target.starts_with("I(") && target.ends_with(')') {
                                let ports_part = &target[2..target.len() - 1];
                                let ports_split: Vec<&str> =
                                    ports_part.split(',').map(|s| s.trim()).collect();
                                if ports_split.len() == 2 {
                                    if let Ok(expr) = parse_va_expression(expr_str) {
                                        equations.push((
                                            ports_split[0].to_string(),
                                            ports_split[1].to_string(),
                                            expr,
                                        ));
                                    }
                                }
                            }
                        }
                    } else if let Ok(val) = parse_spice_value(&val_str) {
                        params.insert(key_lower, val);
                    } else {
                        param_expressions.insert(key_lower, val_str);
                    }
                }
            }
        }
        va_ports = Some(ports);
        va_equations = Some(equations);
    } else {
        let mut iter = param_tokens.into_iter().peekable();
        while let Some(key) = iter.next() {
            if key == "=" {
                continue;
            }
            if iter.peek() == Some(&"=".to_string()) {
                iter.next(); // consumir '='
                if let Some(val_str) = iter.next() {
                    if val_str.starts_with('{') && val_str.ends_with('}') {
                        let expr = val_str[1..val_str.len() - 1].to_string();
                        param_expressions.insert(key.to_lowercase(), expr);
                    } else if let Ok(val) = parse_spice_value(&val_str) {
                        params.insert(key.to_lowercase(), val);
                    } else {
                        param_expressions.insert(key.to_lowercase(), val_str);
                    }
                }
            }
        }
    }

    Some(DeviceModel {
        name: model_name,
        model_type: type_raw,
        params,
        param_expressions,
        va_ports,
        va_equations,
    })
}

/// Evalúa dinámicamente un parámetro de modelo buscando primero su valor literal o su expresión
pub fn get_evaluated_model_param(
    model: &DeviceModel,
    key: &str,
    param_env: &HashMap<String, f64>,
) -> Option<f64> {
    if let Some(&val) = model.params.get(key) {
        return Some(val);
    }
    if let Some(expr) = model.param_expressions.get(key) {
        if let Ok(val) = evaluate_expression(expr, param_env) {
            return Some(val);
        }
    }
    None
}

pub fn parse_spice_netlist_to_native(netlist_str: &str) -> Result<CircuitNetlist, String> {
    let resolved_netlist = resolve_includes(netlist_str, 0)?;
    let mut templates = HashMap::new();
    let mut models = HashMap::new();
    let mut root_lines = Vec::new();
    let mut global_params = HashMap::new();
    let mut ic_list = Vec::new(); // Para guardar condición inicial: (nodo, valor)
    let mut nodeset_list = Vec::new(); // Para guardar estimación: (nodo, valor)
    let mut global_temp: Option<f64> = None;
    // Parámetros de simulación electro-térmica
    let mut thermal_tamb: Option<f64> = None;
    let mut thermal_maxiter: usize = 10;
    let mut thermal_tol: f64 = 0.1;
    let mut thermal_coupling: Vec<(String, String, f64)> = Vec::new();
    let mut has_thermal_directive = false;

    // Fase 1: Leer y catalogar subcircuitos (.subckt / .ends), modelos (.model) y líneas raíz
    let mut current_subckt: Option<SubcktTemplate> = None;

    // Manejar continuación de línea con '+'
    let mut processed_lines = Vec::new();
    let mut accum_line = String::new();

    for raw_line in resolved_netlist.lines() {
        // Eliminar comentarios inline $ (estándar SPICE)
        let line_no_comment = raw_line.split('$').next().unwrap_or(raw_line);
        let clean = line_no_comment.trim();
        if clean.is_empty() || clean.starts_with('*') {
            continue;
        }

        if let Some(stripped) = clean.strip_prefix('+') {
            // Línea de continuación
            accum_line.push(' ');
            accum_line.push_str(stripped);
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

        if first == ".param" {
            let param_line = tokens[1..].join(" ");
            let clean_param = param_line.replace(" =", "=").replace("= ", "=");
            let sub_tokens: Vec<String> = clean_param
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            for token in sub_tokens {
                if let Some(eq_idx) = token.find('=') {
                    let key = token[..eq_idx].trim().to_lowercase();
                    let val_str = token[eq_idx + 1..].trim();
                    if let Ok(val) = parse_spice_value(val_str) {
                        global_params.insert(key, val);
                    }
                }
            }
            continue;
        } else if first == ".temp" {
            if tokens.len() >= 2 {
                if let Ok(val) = parse_spice_value(&tokens[1]) {
                    global_temp = Some(val);
                }
            }
            continue;
        } else if first == ".ic" {
            let ic_line = tokens[1..].join(" ");
            let clean_ic = ic_line.replace(" =", "=").replace("= ", "=");
            let sub_tokens: Vec<String> =
                clean_ic.split_whitespace().map(|s| s.to_string()).collect();
            for token in sub_tokens {
                if let Some(eq_idx) = token.find('=') {
                    let node_part = token[..eq_idx].trim().to_lowercase();
                    let val_str = token[eq_idx + 1..].trim();
                    if let Ok(val) = parse_spice_value(val_str) {
                        let node_name = if node_part.starts_with("v(") && node_part.ends_with(')') {
                            node_part[2..node_part.len() - 1].trim().to_string()
                        } else {
                            node_part.clone()
                        };
                        ic_list.push((node_name, val));
                    }
                }
            }
            continue;
        } else if first == ".nodeset" {
            let nodeset_line = tokens[1..].join(" ");
            let clean_nodeset = nodeset_line.replace(" =", "=").replace("= ", "=");
            let sub_tokens: Vec<String> = clean_nodeset
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            for token in sub_tokens {
                if let Some(eq_idx) = token.find('=') {
                    let node_part = token[..eq_idx].trim().to_lowercase();
                    let val_str = token[eq_idx + 1..].trim();
                    if let Ok(val) = parse_spice_value(val_str) {
                        let node_name = if node_part.starts_with("v(") && node_part.ends_with(')') {
                            node_part[2..node_part.len() - 1].trim().to_string()
                        } else {
                            node_part.clone()
                        };
                        nodeset_list.push((node_name, val));
                    }
                }
            }
            continue;
        } else if first == ".thermal" {
            // Directiva .THERMAL: configurar simulación electro-térmica
            // Formato: .THERMAL TAMB=300.15 MAXITER=10 TOL=0.1 COUPLE=M1,M2,50.0
            has_thermal_directive = true;
            let thermal_line = tokens[1..].join(" ");
            let clean_thermal = thermal_line.replace(" =", "=").replace("= ", "=");
            let sub_tokens: Vec<String> = clean_thermal
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            for token in sub_tokens {
                if let Some(eq_idx) = token.find('=') {
                    let key = token[..eq_idx].trim().to_lowercase();
                    let val_str = token[eq_idx + 1..].trim();
                    match key.as_str() {
                        "tamb" => {
                            if let Ok(val) = parse_spice_value(val_str) {
                                thermal_tamb = Some(val);
                            }
                        }
                        "maxiter" => {
                            if let Ok(val) = parse_spice_value(val_str) {
                                thermal_maxiter = val as usize;
                            }
                        }
                        "tol" => {
                            if let Ok(val) = parse_spice_value(val_str) {
                                thermal_tol = val;
                            }
                        }
                        "couple" => {
                            // Formato: COUPLE=id1,id2,Rth_mutuo
                            let parts: Vec<&str> = val_str.split(',').collect();
                            if parts.len() == 3 {
                                if let Ok(rth_val) = parse_spice_value(parts[2]) {
                                    thermal_coupling.push((
                                        parts[0].to_string(),
                                        parts[1].to_string(),
                                        rth_val,
                                    ));
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            continue;
        }

        if first == ".subckt" {
            if tokens.len() < 3 {
                return Err(
                    "Declaración de .subckt inválida. Formato: .subckt nombre pin1 pin2 ..."
                        .to_string(),
                );
            }
            let name = tokens[1].clone();
            // Buscar PARAMS: en la línea para separar pines de parámetros por defecto
            let mut pins = Vec::new();
            let mut default_params = HashMap::new();
            let mut in_params_section = false;
            for tok in &tokens[2..] {
                if tok.to_lowercase() == "params:" {
                    in_params_section = true;
                    continue;
                }
                if in_params_section {
                    // Parsear key=value
                    if let Some(eq_idx) = tok.find('=') {
                        let key = tok[..eq_idx].trim().to_lowercase();
                        let val_str = tok[eq_idx + 1..].trim();
                        if let Ok(val) = parse_spice_value(val_str) {
                            default_params.insert(key, val);
                        }
                    }
                } else {
                    pins.push(tok.clone());
                }
            }
            current_subckt = Some(SubcktTemplate {
                name,
                pins,
                lines: Vec::new(),
                default_params,
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
    let mut max_root_node = 0;
    for line in &root_lines {
        let tokens: Vec<String> = line.split_whitespace().map(|s| s.to_string()).collect();
        if tokens.is_empty() || tokens[0].starts_with('.') {
            continue;
        }
        for token in &tokens[1..] {
            if let Ok(node_idx) = token.parse::<usize>() {
                if node_idx > max_root_node {
                    max_root_node = node_idx;
                }
            }
        }
    }

    let mut components = Vec::new();
    let mut mutual_inductances = Vec::new();
    let mut next_internal_node = max_root_node + 1;

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

        if first_char == 'k' {
            if tokens.len() >= 4 {
                let id = tokens[0].clone();
                let l1_id = tokens[1].clone();
                let l2_id = tokens[2].clone();
                if let Ok(k_coeff) = parse_spice_value(&tokens[3]) {
                    mutual_inductances.push(MutualInductance {
                        id,
                        l1_id,
                        l2_id,
                        k_coeff,
                    });
                }
            }
            continue;
        }

        let (num_pins, is_gate, is_subckt) = match first_char {
            'r' | 'c' | 'l' => (2, false, false),
            'd' => (2, false, false),
            'q' => (3, false, false),
            'j' => (3, false, false), // JFET (Drain, Gate, Source)
            'm' => (3, false, false),
            'v' | 'i' => (2, false, false),
            'b' => (2, false, false),       // B-source
            'e' | 'g' => (4, false, false), // VCVS, VCCS
            'f' | 'h' => (2, false, false), // CCCS, CCVS
            'o' => {
                // Optoacoplador (4 pines) vs Opamp (5 pines).
                let model_name = tokens.last().unwrap();
                if let Some(m) = models.get(model_name) {
                    if m.model_type == "opto" {
                        (4, false, false)
                    } else {
                        (5, false, false)
                    }
                } else {
                    (if tokens.len() >= 7 { 5 } else { 4 }, false, false)
                }
            }
            's' => {
                // SCR: 3 pines (anode, cathode, gate)
                let model_name = tokens.last().unwrap();
                if let Some(m) = models.get(model_name) {
                    if m.model_type == "scr" {
                        (3, false, true)
                    } else {
                        (2, false, false)
                    }
                } else {
                    (3, false, false)
                }
            }
            't' => {
                // TRIAC: 3 pines (mt1, mt2, gate)
                let model_name = tokens.last().unwrap();
                if let Some(m) = models.get(model_name) {
                    if m.model_type == "triac" {
                        (3, false, true)
                    } else {
                        (2, false, false)
                    }
                } else {
                    (3, false, false)
                }
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
            'x' => (0, false, true),
            'u' | 'a' => {
                let line_lower = line.to_lowercase();
                if line_lower.contains("not_gate") {
                    (2, true, false)
                } else if line_lower.contains("and_gate")
                    || line_lower.contains("or_gate")
                    || line_lower.contains("nand_gate")
                    || line_lower.contains("nor_gate")
                    || line_lower.contains("xor_gate")
                {
                    (3, true, false)
                } else {
                    (5, false, false)
                }
            }
            _ => {
                if first_char == 'x' {
                    (0, false, true)
                } else {
                    // Opamp
                    (5, false, false)
                }
            }
        };

        if is_subckt {
            if tokens.len() < 3 {
                return Err(format!("Línea de subcircuito inválida: {}", line));
            }

            // Detectar si hay PARAMS: en la línea de instanciación X
            let _line_lower_joined = tokens
                .iter()
                .map(|t| t.to_lowercase())
                .collect::<Vec<_>>()
                .join(" ");
            let params_keyword_pos = tokens.iter().position(|t| t.to_lowercase() == "params:");

            let (subckt_name, sub_pins, override_params) = if let Some(pk_pos) = params_keyword_pos
            {
                // El nombre del subcircuito es el token justo antes de PARAMS:
                let name = tokens[pk_pos - 1].clone();
                let pins = &tokens[1..pk_pos - 1];
                let mut params = HashMap::new();
                for tok in &tokens[pk_pos + 1..] {
                    if let Some(eq_idx) = tok.find('=') {
                        let key = tok[..eq_idx].trim().to_lowercase();
                        let val_str = tok[eq_idx + 1..].trim();
                        if let Ok(val) = parse_spice_value(val_str) {
                            params.insert(key, val);
                        }
                    }
                }
                (name, pins.to_vec(), params)
            } else {
                let name = tokens.last().unwrap().clone();
                let pins = tokens[1..tokens.len() - 1].to_vec();
                (name, pins, HashMap::new())
            };

            // Aplanar subcircuito
            if let Some((tpl, local_models)) = get_subckt_template_and_models(
                &subckt_name,
                first_char,
                &templates,
                &models,
                &global_params,
            ) {
                flatten_subcircuit(
                    &id,
                    &tpl,
                    &sub_pins,
                    &override_params,
                    &templates,
                    &local_models,
                    &mut components,
                    &global_params,
                    &mut next_internal_node,
                )?;
            } else {
                return Err(format!(
                    "Subcircuito o modelo '{}' no encontrado",
                    subckt_name
                ));
            }
        } else {
            let pins_count = if is_gate {
                num_pins
            } else if first_char == 'o' {
                // Optoacoplador (4 pines) vs Opamp (5 pines) — distinción por modelo o tokens
                let model_name = tokens.last().unwrap();
                if let Some(m) = models.get(model_name) {
                    if m.model_type == "opto" {
                        4
                    } else {
                        5
                    }
                } else {
                    if tokens.len() >= 7 {
                        5
                    } else {
                        4
                    }
                }
            } else if first_char == 'u' || first_char == 'a' {
                if tokens.len() >= 7 {
                    5
                } else {
                    num_pins
                }
            } else {
                num_pins
            };

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

            let comp_type = if is_gate {
                value_or_model.clone()
            } else {
                match first_char {
                    'r' => "resistor".to_string(),
                    'c' => "capacitor".to_string(),
                    'l' => "inductor".to_string(),
                    'd' => {
                        if let Some(m) = models.get(value_or_model) {
                            if m.model_type == "led" {
                                "led".to_string()
                            } else {
                                "diode".to_string()
                            }
                        } else {
                            "diode".to_string()
                        }
                    }
                    'q' => {
                        if let Some(m) = models.get(value_or_model) {
                            m.model_type.clone()
                        } else {
                            "npn".to_string()
                        }
                    }
                    'j' => {
                        if let Some(m) = models.get(value_or_model) {
                            m.model_type.clone()
                        } else {
                            "njf".to_string()
                        }
                    }
                    'm' => {
                        if let Some(m) = models.get(value_or_model) {
                            m.model_type.clone()
                        } else {
                            "nmos".to_string()
                        }
                    }
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
                    }
                    'e' => "vcvs".to_string(),
                    'g' => "vccs".to_string(),
                    'f' => "cccs".to_string(),
                    'h' => "ccvs".to_string(),
                    'o' => {
                        if let Some(m) = models.get(value_or_model) {
                            if m.model_type == "opto" {
                                "opto".to_string()
                            } else {
                                "opamp".to_string()
                            }
                        } else if tokens.len() == 6 {
                            "opto".to_string()
                        } else {
                            "opamp".to_string()
                        }
                    }
                    's' => {
                        if let Some(m) = models.get(value_or_model) {
                            if m.model_type == "scr" {
                                "scr".to_string()
                            } else {
                                "resistor".to_string()
                            }
                        } else {
                            "scr".to_string()
                        }
                    }
                    't' => {
                        if let Some(m) = models.get(value_or_model) {
                            if m.model_type == "triac" {
                                "triac".to_string()
                            } else {
                                "resistor".to_string()
                            }
                        } else {
                            "triac".to_string()
                        }
                    }
                    _ => "opamp".to_string(),
                }
            };

            let mut comp = ComponentData {
                id: id.clone(),
                comp_type: comp_type.clone(),
                pins,
                ..Default::default()
            };

            if comp_type == "bvoltage" || comp_type == "bcurrent" {
                let joined_rest = tokens[3..].join(" ");
                let clean_rest = joined_rest.trim();
                let lower_clean_rest = clean_rest.to_lowercase();
                let expr_part =
                    if lower_clean_rest.starts_with("v=") || lower_clean_rest.starts_with("i=") {
                        clean_rest[2..].trim()
                    } else {
                        clean_rest
                    };
                let mut expression = expr_part.to_string();
                if expression.starts_with('{') && expression.ends_with('}') {
                    expression = expression[1..expression.len() - 1].trim().to_string();
                }
                comp.expression = Some(expression);
            }

            if (comp_type == "cccs" || comp_type == "ccvs") && tokens.len() >= 5 {
                comp.controlling_source = Some(tokens[3].clone());
                if let Ok(val) = parse_spice_value(&tokens[4]) {
                    comp.value = val;
                }
            }

            // Parsear parámetros de compuertas lógicas si es compuerta
            if is_gate {
                for token in &tokens[(pins_count + 2)..] {
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

            if let Ok(val) = parse_spice_value(value_or_model) {
                comp.value = val;
            } else if value_or_model.starts_with('{') && value_or_model.ends_with('}') {
                let expr = &value_or_model[1..value_or_model.len() - 1];
                if let Ok(val) = evaluate_expression(expr, &global_params) {
                    comp.value = val;
                }
            } else {
                // Comprobar si hay llaves reconstruyendo los tokens
                let joined_rest = tokens[pins_count + 1..].join(" ");
                let mut expr_success = false;
                if let Some(open) = joined_rest.find('{') {
                    if let Some(close) = joined_rest.find('}') {
                        let expr = &joined_rest[open + 1..close];
                        if let Ok(val) = evaluate_expression(expr, &global_params) {
                            comp.value = val;
                            expr_success = true;
                        }
                    }
                }
                if !expr_success {
                    // Modelo
                    if comp.comp_type == "diode"
                        || comp.comp_type == "led"
                        || comp.comp_type == "opto"
                        || comp.comp_type == "scr"
                        || comp.comp_type == "triac"
                        || comp.comp_type == "npn"
                        || comp.comp_type == "pnp"
                        || comp.comp_type == "nmos"
                        || comp.comp_type == "pmos"
                        || comp.comp_type == "njf"
                        || comp.comp_type == "pjf"
                        || comp.comp_type == "verilog_a"
                    {
                        if let Some(m) = models.get(value_or_model) {
                            if let Some(bf) = get_evaluated_model_param(m, "bf", &global_params) {
                                comp.value = bf;
                            } else if let Some(vto) =
                                get_evaluated_model_param(m, "vto", &global_params)
                            {
                                comp.value = vto;
                            } else {
                                comp.value = 1.0;
                            }
                            if comp.comp_type == "diode" || comp.comp_type == "led" {
                                comp.diode_is = get_evaluated_model_param(m, "is", &global_params);
                                comp.diode_rs = get_evaluated_model_param(m, "rs", &global_params);
                                comp.diode_n = get_evaluated_model_param(m, "n", &global_params);
                                comp.diode_tt = get_evaluated_model_param(m, "tt", &global_params);
                                comp.diode_cjo =
                                    get_evaluated_model_param(m, "cjo", &global_params);
                                comp.diode_vj = get_evaluated_model_param(m, "vj", &global_params);
                                comp.diode_m = get_evaluated_model_param(m, "m", &global_params);
                                comp.diode_bv = get_evaluated_model_param(m, "bv", &global_params);
                                comp.diode_ibv =
                                    get_evaluated_model_param(m, "ibv", &global_params);
                            } else if comp.comp_type == "opto" {
                                comp.opto_ctr = get_evaluated_model_param(m, "ctr", &global_params);
                                comp.opto_is = get_evaluated_model_param(m, "is", &global_params);
                                comp.opto_n = get_evaluated_model_param(m, "n", &global_params);
                                comp.opto_vsat =
                                    get_evaluated_model_param(m, "vsat", &global_params);
                                comp.diode_is = comp.opto_is;
                                comp.diode_n = comp.opto_n;
                            } else if comp.comp_type == "npn" || comp.comp_type == "pnp" {
                                comp.bjt_is = get_evaluated_model_param(m, "is", &global_params);
                                comp.bjt_bf = get_evaluated_model_param(m, "bf", &global_params);
                                comp.bjt_vaf = get_evaluated_model_param(m, "vaf", &global_params);
                                comp.bjt_rb = get_evaluated_model_param(m, "rb", &global_params);
                                comp.bjt_rc = get_evaluated_model_param(m, "rc", &global_params);
                                comp.bjt_cje = get_evaluated_model_param(m, "cje", &global_params);
                                comp.bjt_cjc = get_evaluated_model_param(m, "cjc", &global_params);
                                comp.bjt_tf = get_evaluated_model_param(m, "tf", &global_params);
                                comp.bjt_tr = get_evaluated_model_param(m, "tr", &global_params);
                            } else if comp.comp_type == "njf" || comp.comp_type == "pjf" {
                                comp.jfet_vto = get_evaluated_model_param(m, "vto", &global_params);
                                comp.jfet_beta =
                                    get_evaluated_model_param(m, "beta", &global_params);
                                comp.jfet_lambda =
                                    get_evaluated_model_param(m, "lambda", &global_params);
                                comp.jfet_cgs = get_evaluated_model_param(m, "cgs", &global_params);
                                comp.jfet_cgd = get_evaluated_model_param(m, "cgd", &global_params);
                            } else if comp.comp_type == "verilog_a" {
                                comp.va_model_name = Some(m.name.clone());
                                comp.va_ports = m.va_ports.clone();
                                if let Some(ref eqs) = m.va_equations {
                                    let mut serialized_eqs = Vec::new();
                                    for (from, to, expr) in eqs {
                                        serialized_eqs.push((
                                            from.clone(),
                                            to.clone(),
                                            format_va_expr(expr),
                                        ));
                                    }
                                    comp.va_equations = Some(serialized_eqs);
                                }
                            }
                        } else {
                            comp.value = 1.0;
                        }
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
            if (comp.comp_type == "vsource" || comp.comp_type == "isource") && tokens.len() > 3 {
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

    // Inyectar condiciones iniciales .ic como componentes virtuales
    for (node, val) in ic_list {
        components.push(ComponentData {
            id: format!(".ic_{}", components.len()),
            comp_type: "ic_directive".to_string(),
            pins: vec![node],
            value: val,
            ..Default::default()
        });
    }

    // Inyectar sugerencias .nodeset como componentes virtuales
    for (node, val) in nodeset_list {
        components.push(ComponentData {
            id: format!(".nodeset_{}", components.len()),
            comp_type: "nodeset_directive".to_string(),
            pins: vec![node],
            value: val,
            ..Default::default()
        });
    }

    Ok(CircuitNetlist {
        components,
        wires: Vec::new(), // En netlists SPICE, los cables se infieren directamente de los pines
        temperature: global_temp,
        fixed_step: None,
        mutual_inductances: Some(mutual_inductances),
        thermal_config: if has_thermal_directive {
            Some(ThermalConfig {
                t_amb: thermal_tamb.unwrap_or(300.15),
                max_thermal_iters: thermal_maxiter,
                thermal_tol,
                thermal_coupling,
            })
        } else {
            None
        },
        subcircuit_definitions: None,
        triggers: None,
    })
}
