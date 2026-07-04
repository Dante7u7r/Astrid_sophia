use std::collections::HashMap;

#[allow(unused_imports)]
use super::lexer::*;
#[allow(unused_imports)]
use super::devices::*;
#[allow(unused_imports)]
use super::subcircuits::*;

#[derive(Clone, Debug)]
pub enum VaExpr {
    Val(f64),
    Var(String),
    Add(Box<VaExpr>, Box<VaExpr>),
    Sub(Box<VaExpr>, Box<VaExpr>),
    Mul(Box<VaExpr>, Box<VaExpr>),
    Div(Box<VaExpr>, Box<VaExpr>),
    Neg(Box<VaExpr>),
    Exp(Box<VaExpr>),
    Ln(Box<VaExpr>),
    Sqrt(Box<VaExpr>),
    Pow(Box<VaExpr>, f64),
    Tanh(Box<VaExpr>),
}

impl VaExpr {
    pub fn evaluate(&self, params: &HashMap<String, f64>, ports: &[crate::dual3::Dual3; 3]) -> Result<crate::dual3::Dual3, String> {
        match self {
            VaExpr::Val(v) => Ok(crate::dual3::Dual3::constant(*v)),
            VaExpr::Var(name) => {
                let name_lower = name.to_lowercase();
                if name_lower == "v1" || name_lower == "vgs" {
                    Ok(ports[0])
                } else if name_lower == "v2" || name_lower == "vds" {
                    Ok(ports[1])
                } else if name_lower == "v3" || name_lower == "vbs" {
                    Ok(ports[2])
                } else if let Some(&val) = params.get(&name_lower) {
                    Ok(crate::dual3::Dual3::constant(val))
                } else {
                    Err(format!("Variable o parámetro no encontrado en el contexto de Verilog-A: {}", name))
                }
            }
            VaExpr::Add(lhs, rhs) => {
                let l = lhs.evaluate(params, ports)?;
                let r = rhs.evaluate(params, ports)?;
                Ok(l + r)
            }
            VaExpr::Sub(lhs, rhs) => {
                let l = lhs.evaluate(params, ports)?;
                let r = rhs.evaluate(params, ports)?;
                Ok(l - r)
            }
            VaExpr::Mul(lhs, rhs) => {
                let l = lhs.evaluate(params, ports)?;
                let r = rhs.evaluate(params, ports)?;
                Ok(l * r)
            }
            VaExpr::Div(lhs, rhs) => {
                let l = lhs.evaluate(params, ports)?;
                let r = rhs.evaluate(params, ports)?;
                Ok(l / r)
            }
            VaExpr::Neg(inner) => {
                let val = inner.evaluate(params, ports)?;
                Ok(-val)
            }
            VaExpr::Exp(inner) => {
                let val = inner.evaluate(params, ports)?;
                Ok(val.exp())
            }
            VaExpr::Ln(inner) => {
                let val = inner.evaluate(params, ports)?;
                Ok(val.ln())
            }
            VaExpr::Sqrt(inner) => {
                let val = inner.evaluate(params, ports)?;
                Ok(val.sqrt())
            }
            VaExpr::Pow(inner, n) => {
                let val = inner.evaluate(params, ports)?;
                Ok(val.powf(*n))
            }
            VaExpr::Tanh(inner) => {
                let val = inner.evaluate(params, ports)?;
                Ok(val.tanh())
            }
        }
    }
}

pub fn parse_va_expression(expr_str: &str) -> Result<VaExpr, String> {
    let clean = expr_str.trim();
    if clean.is_empty() {
        return Err("Expresión Verilog-A vacía".to_string());
    }

    // Nivel 1: Suma y Resta (fuera de paréntesis y evitando notación científica)
    let chars: Vec<char> = clean.chars().collect();
    let mut depth = 0;
    for i in (0..chars.len()).rev() {
        let c = chars[i];
        if c == ')' { depth += 1; }
        else if c == '(' { depth -= 1; }
        else if depth == 0 && i > 0 {
            if c == '+' && chars[i-1] != 'e' && chars[i-1] != 'E' {
                let lhs = parse_va_expression(&clean[..i])?;
                let rhs = parse_va_expression(&clean[i+1..])?;
                return Ok(VaExpr::Add(Box::new(lhs), Box::new(rhs)));
            }
            if c == '-' && chars[i-1] != 'e' && chars[i-1] != 'E' {
                let prefix = clean[..i].trim();
                if !prefix.is_empty() && !prefix.ends_with('+') && !prefix.ends_with('-') && !prefix.ends_with('*') && !prefix.ends_with('/') {
                    let lhs = parse_va_expression(&clean[..i])?;
                    let rhs = parse_va_expression(&clean[i+1..])?;
                    return Ok(VaExpr::Sub(Box::new(lhs), Box::new(rhs)));
                }
            }
        }
    }

    // Nivel 2: Multiplicación y División (fuera de paréntesis)
    depth = 0;
    for i in (0..chars.len()).rev() {
        let c = chars[i];
        if c == ')' { depth += 1; }
        else if c == '(' { depth -= 1; }
        else if depth == 0 {
            if c == '*' {
                let lhs = parse_va_expression(&clean[..i])?;
                let rhs = parse_va_expression(&clean[i+1..])?;
                return Ok(VaExpr::Mul(Box::new(lhs), Box::new(rhs)));
            }
            if c == '/' {
                let lhs = parse_va_expression(&clean[..i])?;
                let rhs = parse_va_expression(&clean[i+1..])?;
                return Ok(VaExpr::Div(Box::new(lhs), Box::new(rhs)));
            }
        }
    }

    // Nivel 3: Unario Negativo y Positivo
    if let Some(stripped) = clean.strip_prefix('-') {
        let inner = parse_va_expression(stripped)?;
        return Ok(VaExpr::Neg(Box::new(inner)));
    }
    if let Some(stripped) = clean.strip_prefix('+') {
        return parse_va_expression(stripped);
    }

    // Nivel 4: Paréntesis Externos
    if clean.starts_with('(') && clean.ends_with(')') {
        let mut matching = true;
        let mut d = 0;
        for (i, &ch) in chars.iter().enumerate() {
            if ch == '(' { d += 1; }
            else if ch == ')' { d -= 1; }
            if d == 0 && i < chars.len() - 1 {
                matching = false;
                break;
            }
        }
        if matching {
            return parse_va_expression(&clean[1..clean.len()-1]);
        }
    }

    // Nivel 5: Funciones matemáticas
    let clean_lower = clean.to_lowercase();
    if clean_lower.starts_with("exp(") && clean.ends_with(')') {
        let inner = parse_va_expression(&clean[4..clean.len()-1])?;
        return Ok(VaExpr::Exp(Box::new(inner)));
    }
    if clean_lower.starts_with("ln(") && clean.ends_with(')') {
        let inner = parse_va_expression(&clean[3..clean.len()-1])?;
        return Ok(VaExpr::Ln(Box::new(inner)));
    }
    if clean_lower.starts_with("sqrt(") && clean.ends_with(')') {
        let inner = parse_va_expression(&clean[5..clean.len()-1])?;
        return Ok(VaExpr::Sqrt(Box::new(inner)));
    }
    if clean_lower.starts_with("tanh(") && clean.ends_with(')') {
        let inner = parse_va_expression(&clean[5..clean.len()-1])?;
        return Ok(VaExpr::Tanh(Box::new(inner)));
    }
    if clean_lower.starts_with("pow(") && clean.ends_with(')') {
        let inner_str = &clean[4..clean.len()-1];
        let mut d = 0;
        let mut comma_idx = None;
        let inner_chars: Vec<char> = inner_str.chars().collect();
        for (idx, &ch) in inner_chars.iter().enumerate() {
            if ch == '(' { d += 1; }
            else if ch == ')' { d -= 1; }
            else if ch == ',' && d == 0 {
                comma_idx = Some(idx);
                break;
            }
        }
        if let Some(idx) = comma_idx {
            let base_str = &inner_str[..idx];
            let exp_str = &inner_str[idx+1..].trim();
            let base_expr = parse_va_expression(base_str)?;
            let exp_val = exp_str.parse::<f64>().map_err(|e| format!("Exponente pow inválido: {}", e))?;
            return Ok(VaExpr::Pow(Box::new(base_expr), exp_val));
        }
    }

    // Nivel 6: Átomos
    if let Ok(val) = parse_spice_value(clean) {
        Ok(VaExpr::Val(val))
    } else {
        Ok(VaExpr::Var(clean.to_string()))
    }
}

pub fn format_va_expr(expr: &VaExpr) -> String {
    match expr {
        VaExpr::Val(v) => format!("{}", v),
        VaExpr::Var(name) => name.clone(),
        VaExpr::Add(lhs, rhs) => format!("({} + {})", format_va_expr(lhs), format_va_expr(rhs)),
        VaExpr::Sub(lhs, rhs) => format!("({} - {})", format_va_expr(lhs), format_va_expr(rhs)),
        VaExpr::Mul(lhs, rhs) => format!("({} * {})", format_va_expr(lhs), format_va_expr(rhs)),
        VaExpr::Div(lhs, rhs) => format!("({} / {})", format_va_expr(lhs), format_va_expr(rhs)),
        VaExpr::Neg(inner) => format!("(-{})", format_va_expr(inner)),
        VaExpr::Exp(inner) => format!("exp({})", format_va_expr(inner)),
        VaExpr::Ln(inner) => format!("ln({})", format_va_expr(inner)),
        VaExpr::Sqrt(inner) => format!("sqrt({})", format_va_expr(inner)),
        VaExpr::Pow(inner, n) => format!("pow({}, {})", format_va_expr(inner), n),
        VaExpr::Tanh(inner) => format!("tanh({})", format_va_expr(inner)),
    }
}

/// Evaluador simple de expresiones matemáticas estilo Pratt para interpolación de parámetros
/// en subcircuitos. Soporta +, -, *, / y valores SPICE (ej: 10k, 1meg).
pub fn evaluate_expression(expr: &str, param_env: &HashMap<String, f64>) -> Result<f64, String> {
    let expr_clean = expr.trim();
    if expr_clean.is_empty() {
        return Err("Expresión vacía".to_string());
    }

    // Tokenizar la expresión
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = expr_clean.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        match c {
            '+' | '-' if !current.is_empty() => {
                tokens.push(current.clone());
                current.clear();
                tokens.push(c.to_string());
            }
            '+' | '-' if current.is_empty() => {
                // Signo unario: incluir en el token actual
                current.push(c);
            }
            '*' | '/' => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
                tokens.push(c.to_string());
            }
            '(' | ')' => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
                tokens.push(c.to_string());
            }
            ' ' | '\t' => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            _ => {
                current.push(c);
            }
        }
        i += 1;
    }
    if !current.is_empty() {
        tokens.push(current);
    }

    // Resolver variables por sus valores del entorno de parámetros
    let resolved: Vec<String> = tokens.iter().map(|t| {
        if t == "+" || t == "-" || t == "*" || t == "/" || t == "(" || t == ")" {
            t.clone()
        } else if let Some(&val) = param_env.get(&t.to_lowercase()) {
            format!("{}", val)
        } else {
            t.clone()
        }
    }).collect();

    // Evaluar con precedencia: primero * y /, luego + y -
    // Paso 1: Convertir tokens a valores numéricos y operadores
    let mut values: Vec<f64> = Vec::new();
    let mut ops: Vec<char> = Vec::new();

    let mut idx = 0;
    while idx < resolved.len() {
        let t = &resolved[idx];
        if t == "+" || t == "-" || t == "*" || t == "/" {
            ops.push(t.chars().next().unwrap());
        } else {
            let val = parse_spice_value(t).map_err(|_| format!("No se pudo evaluar '{}' en expresión", t))?;
            values.push(val);
        }
        idx += 1;
    }

    if values.is_empty() {
        return Err("Expresión sin valores numéricos".to_string());
    }

    // Paso 2: Evaluar * y / de izquierda a derecha
    let mut vals2: Vec<f64> = vec![values[0]];
    let mut ops2: Vec<char> = Vec::new();

    for i in 0..ops.len() {
        if ops[i] == '*' {
            let last = vals2.pop().unwrap();
            vals2.push(last * values[i + 1]);
        } else if ops[i] == '/' {
            let last = vals2.pop().unwrap();
            if values[i + 1].abs() < 1e-30 {
                vals2.push(0.0);
            } else {
                vals2.push(last / values[i + 1]);
            }
        } else {
            ops2.push(ops[i]);
            vals2.push(values[i + 1]);
        }
    }

    // Paso 3: Evaluar + y -
    let mut result = vals2[0];
    for i in 0..ops2.len() {
        match ops2[i] {
            '+' => result += vals2[i + 1],
            '-' => result -= vals2[i + 1],
            _ => {}
        }
    }

    Ok(result)
}

