use crate::parser::expressions::{evaluate_expression, parse_va_expression, VaExpr};
use crate::parser::lexer::parse_spice_value;
use std::collections::HashMap;

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
