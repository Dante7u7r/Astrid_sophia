use crate::solver::{ComponentData, CircuitNetlist, MutualInductance};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Resuelve recursivamente las directivas globales de inclusión (.include y .lib)
/// anidadas de forma jerárquica hasta un límite máximo de 8 niveles para evitar bucles.
pub fn resolve_includes(netlist_str: &str, depth: usize) -> Result<String, String> {
    resolve_includes_with_section(netlist_str, None, depth)
}

/// Resuelve inclusiones aplicando opcionalmente un filtro de sección de biblioteca (.lib sección)
pub fn resolve_includes_with_section(
    netlist_str: &str,
    target_section: Option<&str>,
    depth: usize,
) -> Result<String, String> {
    if depth > 8 {
        return Err("Límite máximo de recursividad de inclusión alcanzado (.include/.lib anidados más de 8 veces). Verifica que no existan bucles infinitos.".to_string());
    }

    let mut result = String::new();
    let mut processed_lines = Vec::new();
    let mut accum_line = String::new();

    // Manejar continuación de línea con '+' e ignorar preventivamente bloques protegidos encriptados
    let mut is_protected = false;
    for raw_line in netlist_str.lines() {
        let clean = raw_line.trim();
        let clean_lower = clean.to_lowercase();
        if clean_lower.starts_with(".protected") {
            is_protected = true;
            continue;
        }
        if clean_lower.starts_with(".unprotected") {
            is_protected = false;
            continue;
        }
        if is_protected {
            continue; // Ignorar código de control o encriptado propietario
        }

        if clean.starts_with('+') {
            accum_line.push(' ');
            accum_line.push_str(&clean[1..]);
        } else {
            if !accum_line.is_empty() {
                processed_lines.push(accum_line.clone());
            }
            accum_line = raw_line.to_string();
        }
    }
    if !accum_line.is_empty() {
        processed_lines.push(accum_line);
    }

    // Si estamos buscando una sección específica en este archivo .lib, filtramos las líneas correspondientes
    let mut lines_to_process = Vec::new();
    if let Some(sec) = target_section {
        let mut in_section = false;
        let sec_lower = sec.to_lowercase();
        for line in processed_lines {
            let clean = line.trim();
            let tokens: Vec<String> = clean.split_whitespace().map(|s| s.to_string()).collect();
            if tokens.is_empty() {
                continue;
            }
            let first = tokens[0].to_lowercase();

            if first == ".lib" && tokens.len() >= 2 && tokens[1].to_lowercase() == sec_lower {
                in_section = true;
                continue;
            }
            if first == ".endl" && in_section {
                in_section = false;
                continue;
            }
            if in_section {
                lines_to_process.push(line);
            }
        }
    } else {
        // Si no hay sección objetivo, procesamos de forma normal pero descartamos las directivas internas de sección (.lib / .endl)
        for line in processed_lines {
            let clean = line.trim();
            let tokens: Vec<String> = clean.split_whitespace().map(|s| s.to_string()).collect();
            if tokens.is_empty() {
                continue;
            }
            let first = tokens[0].to_lowercase();
            if first == ".endl" {
                continue;
            }
            // Si es una definición de sección interna, la ignoramos (pero no su contenido, que se procesará cuando sea incluida selectivamente)
            if first == ".lib" && tokens.len() >= 2 && !tokens[1].contains('.') && !tokens[1].contains('/') {
                continue;
            }
            lines_to_process.push(line);
        }
    }

    for line in lines_to_process {
        let clean = line.trim();
        if clean.is_empty() || clean.starts_with('*') {
            result.push_str(&line);
            result.push('\n');
            continue;
        }

        let tokens: Vec<String> = clean.split_whitespace().map(|s| s.to_string()).collect();
        let first = tokens[0].to_lowercase();

        if first == ".include" || first == ".lib" {
            if tokens.len() < 2 {
                return Err(format!("Directiva de inclusión inválida: {}", line));
            }
            let raw_path = tokens[1].trim_matches(|c| c == '\'' || c == '\"');
            let file_path = Path::new(raw_path);

            if !file_path.exists() {
                return Err(format!("No se pudo encontrar el archivo de inclusión: {}", raw_path));
            }

            let include_content = fs::read_to_string(file_path)
                .map_err(|e| format!("No se pudo leer el archivo de inclusión {}: {}", raw_path, e))?;

            // Si es .lib y especifica una sección (tokens[2]), la resolvemos selectivamente
            let section = if first == ".lib" && tokens.len() >= 3 {
                Some(tokens[2].trim_matches(|c| c == '\'' || c == '\"'))
            } else {
                None
            };

            let resolved_content = resolve_includes_with_section(&include_content, section, depth + 1)?;
            result.push_str(&resolved_content);
            result.push('\n');
        } else {
            // Ignorar preventivamente directivas no soportadas de fabricantes analógicos comerciales
            if first == ".options" || first == ".plot" || first == ".probe" || first == ".save" {
                result.push_str(&format!("* Omitida directiva comercial no soportada: {}\n", clean));
            } else {
                result.push_str(&line);
                result.push('\n');
            }
        }
    }

    Ok(result)
}


#[derive(Clone, Debug)]
pub struct SubcktTemplate {
    pub name: String,
    pub pins: Vec<String>,
    pub lines: Vec<String>,
    pub default_params: HashMap<String, f64>,
}

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
    if clean.starts_with('-') {
        let inner = parse_va_expression(&clean[1..])?;
        return Ok(VaExpr::Neg(Box::new(inner)));
    }
    if clean.starts_with('+') {
        return parse_va_expression(&clean[1..]);
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

#[derive(Clone, Debug)]
pub struct DeviceModel {
    pub name: String,
    pub model_type: String, // "d", "npn", "pnp", "verilog_a", etc.
    pub params: HashMap<String, f64>,
    pub param_expressions: HashMap<String, String>, // toxe -> "1.8e-9 + dtoxe"
    pub va_ports: Option<Vec<String>>,
    pub va_equations: Option<Vec<(String, String, VaExpr)>>, // (from_port, to_port, AST)
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
                        let mut ports_clean = val_str.trim_matches(|c| c == '\'' || c == '\"').trim();
                        if ports_clean.starts_with('(') && ports_clean.ends_with(')') {
                            ports_clean = &ports_clean[1..ports_clean.len()-1];
                        }
                        ports = ports_clean.split(',').map(|s| s.trim().to_string()).collect();
                    } else if key_lower == "equation" {
                        let mut eq_clean = val_str.trim_matches(|c| c == '\'' || c == '\"').trim();
                        if eq_clean.starts_with('(') && eq_clean.ends_with(')') {
                            eq_clean = &eq_clean[1..eq_clean.len()-1];
                        }
                        if let Some(arrow_idx) = eq_clean.find("<+") {
                            let target = &eq_clean[..arrow_idx].trim();
                            let expr_str = &eq_clean[arrow_idx+2..].trim();
                            
                            if target.starts_with("I(") && target.ends_with(')') {
                                let ports_part = &target[2..target.len()-1];
                                let ports_split: Vec<&str> = ports_part.split(',').map(|s| s.trim()).collect();
                                if ports_split.len() == 2 {
                                    if let Ok(expr) = parse_va_expression(expr_str) {
                                        equations.push((ports_split[0].to_string(), ports_split[1].to_string(), expr));
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


/// Evaluador simple de expresiones matemáticas estilo Pratt para interpolación de parámetros
/// en subcircuitos. Soporta +, -, *, / y valores SPICE (ej: 10k, 1meg).
fn evaluate_expression(expr: &str, param_env: &HashMap<String, f64>) -> Result<f64, String> {
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
        } else if let Ok(_) = parse_spice_value(t) {
            t.clone()
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

/// Evalúa dinámicamente un parámetro de modelo buscando primero su valor literal o su expresión
fn get_evaluated_model_param(
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

// Aplanar de forma recursiva una instancia de subcircuito
fn flatten_subcircuit(
    instance_id: &str,
    subckt_template: &SubcktTemplate,
    instantiation_pins: &[String],
    override_params: &HashMap<String, f64>,
    templates: &HashMap<String, SubcktTemplate>,
    models: &HashMap<String, DeviceModel>,
    components: &mut Vec<ComponentData>,
    global_params: &HashMap<String, f64>,
) -> Result<(), String> {
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
            'e' | 'g' => (4, false, false), // VCVS, VCCS
            'f' | 'h' => (2, false, false), // CCCS, CCVS
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

            if let Some(tpl) = templates.get(&subckt_name) {
                flatten_subcircuit(&child_global_id, tpl, &sub_pins_mapped, &child_override_params, templates, models, components, global_params)?;
            } else {
                return Err(format!("Subcircuito '{}' no encontrado", subckt_name));
            }
        } else {
            // Componente estándar
            let actual_pins_count = if is_gate {
                num_pins
            } else if first_char == 'o' || tokens.len() >= 7 {
                5
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
                    // Nodo interno
                    comp_pins_mapped.push(format!("{}.{}", instance_id, p));
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
                    'd' => "diode".to_string(),
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
                    'e' => "vcvs".to_string(),
                    'g' => "vccs".to_string(),
                    'f' => "cccs".to_string(),
                    'h' => "ccvs".to_string(),
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

            if comp_type == "cccs" || comp_type == "ccvs" {
                if tokens.len() >= 5 {
                    comp.controlling_source = Some(format!("{}.{}", instance_id, tokens[3]));
                    if let Ok(val) = parse_spice_value(&tokens[4]) {
                        comp.value = val;
                    }
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
                if comp.comp_type == "diode" || comp.comp_type == "npn" || comp.comp_type == "pnp" || comp.comp_type == "nmos" || comp.comp_type == "pmos" || comp.comp_type == "njf" || comp.comp_type == "pjf" || comp.comp_type == "verilog_a" {
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
                        if comp.comp_type == "diode" {
                            comp.diode_is = get_evaluated_model_param(m, "is", &param_env);
                            comp.diode_rs = get_evaluated_model_param(m, "rs", &param_env);
                            comp.diode_n = get_evaluated_model_param(m, "n", &param_env);
                            comp.diode_tt = get_evaluated_model_param(m, "tt", &param_env);
                            comp.diode_cjo = get_evaluated_model_param(m, "cjo", &param_env);
                            comp.diode_vj = get_evaluated_model_param(m, "vj", &param_env);
                            comp.diode_m = get_evaluated_model_param(m, "m", &param_env);
                            comp.diode_bv = get_evaluated_model_param(m, "bv", &param_env);
                            comp.diode_ibv = get_evaluated_model_param(m, "ibv", &param_env);
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

            // Parsear tolerancia opcional (ej: tol=1%)
            for tok in &tokens[actual_pins_count + 2..] {
                if tok.to_lowercase().starts_with("tol=") {
                    let tol_str = &tok[4..].replace("%", "");
                    if let Ok(tol_val) = tol_str.parse::<f64>() {
                        comp.tolerance = Some(tol_val / 100.0);
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
pub fn parse_spice_netlist_to_native(netlist_str: &str) -> Result<CircuitNetlist, String> {
    let resolved_netlist = resolve_includes(netlist_str, 0)?;
    let mut templates = HashMap::new();
    let mut models = HashMap::new();
    let mut root_lines = Vec::new();
    let mut global_params = HashMap::new();
    let mut ic_list = Vec::new();       // Para guardar condición inicial: (nodo, valor)
    let mut nodeset_list = Vec::new();  // Para guardar estimación: (nodo, valor)
    let mut global_temp: Option<f64> = None;

    // Fase 1: Leer y catalogar subcircuitos (.subckt / .ends), modelos (.model) y líneas raíz
    let mut current_subckt: Option<SubcktTemplate> = None;
    
    // Manejar continuación de línea con '+'
    let mut processed_lines = Vec::new();
    let mut accum_line = String::new();

    for raw_line in resolved_netlist.lines() {
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

        if first == ".param" {
            let param_line = tokens[1..].join(" ");
            let clean_param = param_line.replace(" =", "=").replace("= ", "=");
            let sub_tokens: Vec<String> = clean_param.split_whitespace().map(|s| s.to_string()).collect();
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
            let sub_tokens: Vec<String> = clean_ic.split_whitespace().map(|s| s.to_string()).collect();
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
            let sub_tokens: Vec<String> = clean_nodeset.split_whitespace().map(|s| s.to_string()).collect();
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
        }

        if first == ".subckt" {
            if tokens.len() < 3 {
                return Err("Declaración de .subckt inválida. Formato: .subckt nombre pin1 pin2 ...".to_string());
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
    let mut components = Vec::new();
    let mut mutual_inductances = Vec::new();

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
            'e' | 'g' => (4, false, false), // VCVS, VCCS
            'f' | 'h' => (2, false, false), // CCCS, CCVS
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
                } else if line_lower.contains("and_gate") || line_lower.contains("or_gate") || line_lower.contains("nand_gate") || line_lower.contains("nor_gate") || line_lower.contains("xor_gate") {
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
            let _line_lower_joined = tokens.iter().map(|t| t.to_lowercase()).collect::<Vec<_>>().join(" ");
            let params_keyword_pos = tokens.iter().position(|t| t.to_lowercase() == "params:");

            let (subckt_name, sub_pins, override_params) = if let Some(pk_pos) = params_keyword_pos {
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
            if let Some(tpl) = templates.get(&subckt_name) {
                flatten_subcircuit(&id, tpl, &sub_pins, &override_params, &templates, &models, &mut components, &global_params)?;
            } else {
                return Err(format!("Subcircuito '{}' no encontrado", subckt_name));
            }
        } else {
            let pins_count = if is_gate {
                num_pins
            } else if first_char == 'o' || tokens.len() >= 7 {
                5
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
                    'd' => "diode".to_string(),
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
                    'e' => "vcvs".to_string(),
                    'g' => "vccs".to_string(),
                    'f' => "cccs".to_string(),
                    'h' => "ccvs".to_string(),
                    _ => "opamp".to_string(),
                }
            };

            let mut comp = ComponentData {
                id: id.clone(),
                comp_type: comp_type.clone(),
                pins,
                ..Default::default()
            };

            if comp_type == "cccs" || comp_type == "ccvs" {
                if tokens.len() >= 5 {
                    comp.controlling_source = Some(tokens[3].clone());
                    if let Ok(val) = parse_spice_value(&tokens[4]) {
                        comp.value = val;
                    }
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
                let expr = &value_or_model[1..value_or_model.len()-1];
                if let Ok(val) = evaluate_expression(expr, &global_params) {
                    comp.value = val;
                }
            } else {
                // Comprobar si hay llaves reconstruyendo los tokens
                let joined_rest = tokens[pins_count + 1..].join(" ");
                let mut expr_success = false;
                if let Some(open) = joined_rest.find('{') {
                    if let Some(close) = joined_rest.find('}') {
                        let expr = &joined_rest[open+1..close];
                        if let Ok(val) = evaluate_expression(expr, &global_params) {
                            comp.value = val;
                            expr_success = true;
                        }
                    }
                }
                if !expr_success {
                    // Modelo
                    if comp.comp_type == "diode" || comp.comp_type == "npn" || comp.comp_type == "pnp" || comp.comp_type == "nmos" || comp.comp_type == "pmos" || comp.comp_type == "njf" || comp.comp_type == "pjf" || comp.comp_type == "verilog_a" {
                        if let Some(m) = models.get(value_or_model) {
                            if let Some(bf) = get_evaluated_model_param(m, "bf", &global_params) {
                                comp.value = bf;
                            } else if let Some(vto) = get_evaluated_model_param(m, "vto", &global_params) {
                                comp.value = vto;
                            } else {
                                comp.value = 1.0;
                            }
                            if comp.comp_type == "diode" {
                                comp.diode_is = get_evaluated_model_param(m, "is", &global_params);
                                comp.diode_rs = get_evaluated_model_param(m, "rs", &global_params);
                                comp.diode_n = get_evaluated_model_param(m, "n", &global_params);
                                comp.diode_tt = get_evaluated_model_param(m, "tt", &global_params);
                                comp.diode_cjo = get_evaluated_model_param(m, "cjo", &global_params);
                                comp.diode_vj = get_evaluated_model_param(m, "vj", &global_params);
                                comp.diode_m = get_evaluated_model_param(m, "m", &global_params);
                                comp.diode_bv = get_evaluated_model_param(m, "bv", &global_params);
                                comp.diode_ibv = get_evaluated_model_param(m, "ibv", &global_params);
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
                                comp.jfet_beta = get_evaluated_model_param(m, "beta", &global_params);
                                comp.jfet_lambda = get_evaluated_model_param(m, "lambda", &global_params);
                                comp.jfet_cgs = get_evaluated_model_param(m, "cgs", &global_params);
                                comp.jfet_cgd = get_evaluated_model_param(m, "cgd", &global_params);
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

    #[test]
    fn test_logic_gate_delay_parsing() {
        let netlist_str = "
        * Logic gates with configurable delays test netlist
        U1 1 2 3 and_gate delay=10n rise_delay=15n fall_delay=25n
        U2 3 4 not_gate td=5n trise=8n tfall=12n
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        assert_eq!(parsed.components.len(), 2);

        let u1 = parsed.components.iter().find(|c| c.id == "U1").unwrap();
        assert_eq!(u1.comp_type, "and_gate");
        assert_eq!(u1.pins, vec!["1".to_string(), "2".to_string(), "3".to_string()]);
        assert!((u1.delay.unwrap() - 10e-9).abs() < 1e-15);
        assert!((u1.rise_delay.unwrap() - 15e-9).abs() < 1e-15);
        assert!((u1.fall_delay.unwrap() - 25e-9).abs() < 1e-15);

        let u2 = parsed.components.iter().find(|c| c.id == "U2").unwrap();
        assert_eq!(u2.comp_type, "not_gate");
        assert_eq!(u2.pins, vec!["3".to_string(), "4".to_string()]);
        assert!((u2.delay.unwrap() - 5e-9).abs() < 1e-15);
        assert!((u2.rise_delay.unwrap() - 8e-9).abs() < 1e-15);
        assert!((u2.fall_delay.unwrap() - 12e-9).abs() < 1e-15);
    }

    #[test]
    fn test_recursive_library_include() {
        use std::fs;
        use std::env;

        let temp_dir = env::temp_dir();
        
        // Crear un archivo de modelo en sub_model.lib
        let mut model_path = temp_dir.clone();
        model_path.push("sub_model.lib");
        let model_content = "
        * Infineon Diode Model
        .model DInfineon D(IS=1e-14 RS=0.1 N=1.0)
        ";
        fs::write(&model_path, model_content).unwrap();

        // Crear una librería intermedia diode_lib.include que incluya a sub_model.lib
        let mut lib_path = temp_dir.clone();
        lib_path.push("diode_lib.include");
        let lib_content = format!("
        * Library including the other model
        .include \"{}\"
        .subckt my_diode_sub anode cathode
        D1 anode cathode DInfineon
        .ends
        ", model_path.to_str().unwrap());
        fs::write(&lib_path, lib_content).unwrap();

        // Netlist raíz que incluye a diode_lib.include
        let netlist_str = format!("
        * Root circuit
        .include \"{}\"
        V1 1 0 5.0
        X1 1 0 my_diode_sub
        ", lib_path.to_str().unwrap());

        let parsed = parse_spice_netlist_to_native(&netlist_str).unwrap();

        // Limpiar archivos temporales
        let _ = fs::remove_file(model_path);
        let _ = fs::remove_file(lib_path);

        // Validaciones del aplanamiento jerárquico
        // Debe tener V1 y X1.D1
        assert_eq!(parsed.components.len(), 2);
        let d1 = parsed.components.iter().find(|c| c.id == "X1.D1").unwrap();
        assert_eq!(d1.comp_type, "diode");
        assert_eq!(d1.pins, vec!["1".to_string(), "0".to_string()]);
    }

    #[test]
    fn test_foundry_pdk_selective_lib_include() {
        use std::fs;
        use std::env;

        let temp_dir = env::temp_dir();
        let mut pdk_path = temp_dir.clone();
        pdk_path.push("mock_pdk.lib");

        let pdk_content = "
        * Mock PDK Commercial File
        .lib tt
        .protected
        * Encriptacion y firmas de fundicion que deben ser omitidas
        .unprotected
        .model my_diode D(IS=2e-14 RS=0.5 N=1.0)
        .endl

        .lib ss
        .model my_diode D(IS=1e-15 RS=1.2 N=1.1)
        .endl
        ";

        fs::write(&pdk_path, pdk_content).unwrap();

        // 1. Probar la inclusion de la seccion 'tt'
        let netlist_tt = format!("
        * Root Circuit with TT corner
        .lib \"{}\" tt
        D1 1 0 my_diode
        ", pdk_path.to_str().unwrap());

        let parsed_tt = parse_spice_netlist_to_native(&netlist_tt).unwrap();
        assert_eq!(parsed_tt.components.len(), 1);
        let d1_tt = parsed_tt.components.iter().find(|c| c.id == "D1").unwrap();
        assert_eq!(d1_tt.comp_type, "diode");
        assert_eq!(d1_tt.diode_is, Some(2e-14));
        assert_eq!(d1_tt.diode_rs, Some(0.5));

        // 2. Probar la inclusion de la seccion 'ss'
        let netlist_ss = format!("
        * Root Circuit with SS corner
        .lib \"{}\" ss
        D1 1 0 my_diode
        ", pdk_path.to_str().unwrap());

        let parsed_ss = parse_spice_netlist_to_native(&netlist_ss).unwrap();
        assert_eq!(parsed_ss.components.len(), 1);
        let d1_ss = parsed_ss.components.iter().find(|c| c.id == "D1").unwrap();
        assert_eq!(d1_ss.comp_type, "diode");
        assert_eq!(d1_ss.diode_is, Some(1e-15));
        assert_eq!(d1_ss.diode_rs, Some(1.2));

        // Limpieza
        let _ = fs::remove_file(pdk_path);
    }

    #[test]
    fn test_foundry_model_parameter_expressions() {
        // Test de evaluacion dinamica de expresiones en parametros de modelos
        let netlist_str = "
        * Circuit with expression in model parameters
        .param dvto = 0.1
        .param double_rs = 2.0
        
        .model my_jfet NJF(VTO={-1.5 + dvto} beta=1.0e-3 rs={0.5 * double_rs})
        
        J1 1 2 0 my_jfet
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        assert_eq!(parsed.components.len(), 1);
        
        let j1 = parsed.components.iter().find(|c| c.id == "J1").unwrap();
        assert_eq!(j1.comp_type, "njf");
        
        // VTO = -1.5 + 0.1 = -1.4
        assert!((j1.jfet_vto.unwrap() - (-1.4)).abs() < 1e-12, "VTO incorrecto, obtenido: {}", j1.jfet_vto.unwrap());
        
        let netlist_diode = "
        * Diode parameter expressions
        .param my_is = 5e-14
        .param rs_factor = 3.0
        .model fast_diode D(IS={my_is} RS={0.2 * rs_factor})
        D2 1 0 fast_diode
        ";
        let parsed_diode = parse_spice_netlist_to_native(netlist_diode).unwrap();
        let d2 = parsed_diode.components.iter().find(|c| c.id == "D2").unwrap();
        assert_eq!(d2.diode_is, Some(5e-14));
        assert!((d2.diode_rs.unwrap() - 0.6).abs() < 1e-12);
    }

    #[test]
    fn test_verilog_a_dual_number_ad() {
        use crate::dual3::Dual3;
        
        // f(x, y) = exp(x * y)
        // en x=2.0, y=3.0
        let x = Dual3::new(2.0, 0);
        let y = Dual3::new(3.0, 1);
        
        let f = (x * y).exp();
        
        assert!((f.val - 403.4287934927351).abs() < 1e-9);
        // df/dx = y * exp(x * y) = 3 * exp(6) = 1210.2863804782054
        assert!((f.deriv[0] - 1210.2863804782054).abs() < 1e-9);
        // df/dy = x * exp(x * y) = 2 * exp(6) = 806.8575869854702
        assert!((f.deriv[1] - 806.8575869854702).abs() < 1e-9);
        assert_eq!(f.deriv[2], 0.0);
    }

    #[test]
    fn test_verilog_a_dynamic_nmos_device() {
        let netlist_str = "
        * Circuit with dynamic Verilog-A NMOS
        .model my_va verilog_a (ports=d,g,s params=vth0=0.35,beta=0.02 equation=I(d,s)<+beta*pow(vgs-vth0,2))
        
        Vg 1 0 1.0
        Vd 2 0 2.0
        Y1 2 1 0 my_va
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        assert_eq!(parsed.components.len(), 3);
        
        let y1 = parsed.components.iter().find(|c| c.id == "Y1").unwrap();
        assert_eq!(y1.comp_type, "verilog_a");
        assert_eq!(y1.va_model_name, Some("my_va".to_string()));
        
        let res = crate::solver::solve_dc_circuit(&parsed).unwrap();
        
        // La corriente fluye a través de la rama de Vd
        // I(Vd) = -Ids = -8.45 mA = -0.00845 A
        let i_vd = res.branch_currents.get("Vd").unwrap();
        assert!((i_vd + 0.00845).abs() < 1e-5, "Corriente de Vd incorrecta, obtenida: {}", i_vd);
    }
}
