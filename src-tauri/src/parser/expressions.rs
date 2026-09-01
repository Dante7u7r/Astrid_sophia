use std::collections::HashMap;

#[allow(unused_imports)]
use super::devices::*;
#[allow(unused_imports)]
use super::lexer::*;
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
    pub fn evaluate(
        &self,
        params: &HashMap<String, f64>,
        ports: &[crate::dual3::Dual3; 3],
    ) -> Result<crate::dual3::Dual3, String> {
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
                    Err(format!(
                        "Variable o parámetro no encontrado en el contexto de Verilog-A: {}",
                        name
                    ))
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
        if c == ')' {
            depth += 1;
        } else if c == '(' {
            depth -= 1;
        } else if depth == 0 && i > 0 {
            if c == '+' && chars[i - 1] != 'e' && chars[i - 1] != 'E' {
                let lhs = parse_va_expression(&clean[..i])?;
                let rhs = parse_va_expression(&clean[i + 1..])?;
                return Ok(VaExpr::Add(Box::new(lhs), Box::new(rhs)));
            }
            if c == '-' && chars[i - 1] != 'e' && chars[i - 1] != 'E' {
                let prefix = clean[..i].trim();
                if !prefix.is_empty()
                    && !prefix.ends_with('+')
                    && !prefix.ends_with('-')
                    && !prefix.ends_with('*')
                    && !prefix.ends_with('/')
                {
                    let lhs = parse_va_expression(&clean[..i])?;
                    let rhs = parse_va_expression(&clean[i + 1..])?;
                    return Ok(VaExpr::Sub(Box::new(lhs), Box::new(rhs)));
                }
            }
        }
    }

    // Nivel 2: Multiplicación y División (fuera de paréntesis)
    depth = 0;
    for i in (0..chars.len()).rev() {
        let c = chars[i];
        if c == ')' {
            depth += 1;
        } else if c == '(' {
            depth -= 1;
        } else if depth == 0 {
            if c == '*' {
                let lhs = parse_va_expression(&clean[..i])?;
                let rhs = parse_va_expression(&clean[i + 1..])?;
                return Ok(VaExpr::Mul(Box::new(lhs), Box::new(rhs)));
            }
            if c == '/' {
                let lhs = parse_va_expression(&clean[..i])?;
                let rhs = parse_va_expression(&clean[i + 1..])?;
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
            if ch == '(' {
                d += 1;
            } else if ch == ')' {
                d -= 1;
            }
            if d == 0 && i < chars.len() - 1 {
                matching = false;
                break;
            }
        }
        if matching {
            return parse_va_expression(&clean[1..clean.len() - 1]);
        }
    }

    // Nivel 5: Funciones matemáticas
    let clean_lower = clean.to_lowercase();
    if clean_lower.starts_with("exp(") && clean.ends_with(')') {
        let inner = parse_va_expression(&clean[4..clean.len() - 1])?;
        return Ok(VaExpr::Exp(Box::new(inner)));
    }
    if clean_lower.starts_with("ln(") && clean.ends_with(')') {
        let inner = parse_va_expression(&clean[3..clean.len() - 1])?;
        return Ok(VaExpr::Ln(Box::new(inner)));
    }
    if clean_lower.starts_with("sqrt(") && clean.ends_with(')') {
        let inner = parse_va_expression(&clean[5..clean.len() - 1])?;
        return Ok(VaExpr::Sqrt(Box::new(inner)));
    }
    if clean_lower.starts_with("tanh(") && clean.ends_with(')') {
        let inner = parse_va_expression(&clean[5..clean.len() - 1])?;
        return Ok(VaExpr::Tanh(Box::new(inner)));
    }
    if clean_lower.starts_with("pow(") && clean.ends_with(')') {
        let inner_str = &clean[4..clean.len() - 1];
        let mut d = 0;
        let mut comma_idx = None;
        let inner_chars: Vec<char> = inner_str.chars().collect();
        for (idx, &ch) in inner_chars.iter().enumerate() {
            if ch == '(' {
                d += 1;
            } else if ch == ')' {
                d -= 1;
            } else if ch == ',' && d == 0 {
                comma_idx = Some(idx);
                break;
            }
        }
        if let Some(idx) = comma_idx {
            let base_str = &inner_str[..idx];
            let exp_str = &inner_str[idx + 1..].trim();
            let base_expr = parse_va_expression(base_str)?;
            let exp_val = exp_str
                .parse::<f64>()
                .map_err(|e| format!("Exponente pow inválido: {}", e))?;
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

/// Evaluador completo de expresiones matemáticas y paramétricas estilo SPICE para subcircuitos
/// y directivas .PARAM. Soporta +, -, *, /, ^, paréntesis anidados, funciones matemáticas
/// (sqrt, exp, ln, log10, pow, abs, min, max, sin, cos, tan, sinh, cosh, tanh, floor, ceil, round),
/// constantes físicas (pi, e, vt, boltz, q) y sufijos de ingeniería estándar (k, meg, u, n, p, f, m, etc.).
pub fn evaluate_expression(expr: &str, param_env: &HashMap<String, f64>) -> Result<f64, String> {
    let clean = expr
        .trim()
        .trim_start_matches('{')
        .trim_end_matches('}')
        .trim();
    if clean.is_empty() {
        return Err("Expresión vacía".to_string());
    }

    let tokens = tokenize_param_expr(clean)?;
    let mut parser = ParamExprParser::new(tokens, param_env);
    let result = parser.parse_expression()?;
    if parser.has_remaining() {
        return Err(format!(
            "Tokens no consumidos al final de la expresión: {:?}",
            parser.peek()
        ));
    }
    Ok(result)
}

#[derive(Debug, Clone, PartialEq)]
enum ParamToken {
    Num(f64),
    Ident(String),
    Plus,
    Minus,
    Mul,
    Div,
    Caret,
    LParen,
    RParen,
    Comma,
}

fn tokenize_param_expr(s: &str) -> Result<Vec<ParamToken>, String> {
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();
    let mut tokens = Vec::new();
    let mut i = 0;

    while i < len {
        let ch = chars[i];
        if ch.is_whitespace() {
            i += 1;
            continue;
        }

        match ch {
            '+' => {
                tokens.push(ParamToken::Plus);
                i += 1;
            }
            '-' => {
                tokens.push(ParamToken::Minus);
                i += 1;
            }
            '*' => {
                tokens.push(ParamToken::Mul);
                i += 1;
            }
            '/' => {
                tokens.push(ParamToken::Div);
                i += 1;
            }
            '^' => {
                tokens.push(ParamToken::Caret);
                i += 1;
            }
            '(' => {
                tokens.push(ParamToken::LParen);
                i += 1;
            }
            ')' => {
                tokens.push(ParamToken::RParen);
                i += 1;
            }
            ',' => {
                tokens.push(ParamToken::Comma);
                i += 1;
            }
            '0'..='9' | '.' => {
                let start = i;
                // Escanear número con posible sufijo SPICE (ej. 10k, 1.5Meg, 100u, 1e-3, 25mil)
                while i < len {
                    let c = chars[i];
                    if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '%' {
                        // Manejar signos en notación científica como 1e-6
                        if (c == '+' || c == '-') && i > start {
                            let prev = chars[i - 1];
                            if prev == 'e' || prev == 'E' {
                                i += 1;
                                continue;
                            }
                            break;
                        }
                        i += 1;
                    } else if (c == '+' || c == '-')
                        && i > start
                        && (chars[i - 1] == 'e' || chars[i - 1] == 'E')
                    {
                        i += 1;
                    } else {
                        break;
                    }
                }
                let raw_token: String = chars[start..i].iter().collect();
                if let Ok(val) = parse_spice_value(&raw_token) {
                    tokens.push(ParamToken::Num(val));
                } else if let Ok(val) = raw_token.parse::<f64>() {
                    tokens.push(ParamToken::Num(val));
                } else {
                    return Err(format!(
                        "Número o sufijo SPICE inválido en expresión: '{}'",
                        raw_token
                    ));
                }
            }
            c if c.is_ascii_alphabetic() || c == '_' => {
                let start = i;
                while i < len && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                    i += 1;
                }
                let ident: String = chars[start..i].iter().collect();
                tokens.push(ParamToken::Ident(ident));
            }
            _ => {
                return Err(format!("Carácter inesperado '{}' en expresión SPICE", ch));
            }
        }
    }

    Ok(tokens)
}

struct ParamExprParser<'a> {
    tokens: Vec<ParamToken>,
    pos: usize,
    param_env: &'a HashMap<String, f64>,
}

impl<'a> ParamExprParser<'a> {
    fn new(tokens: Vec<ParamToken>, param_env: &'a HashMap<String, f64>) -> Self {
        ParamExprParser {
            tokens,
            pos: 0,
            param_env,
        }
    }

    fn peek(&self) -> Option<&ParamToken> {
        self.tokens.get(self.pos)
    }

    fn has_remaining(&self) -> bool {
        self.pos < self.tokens.len()
    }

    fn next_token(&mut self) -> Option<ParamToken> {
        if self.pos < self.tokens.len() {
            let t = self.tokens[self.pos].clone();
            self.pos += 1;
            Some(t)
        } else {
            None
        }
    }

    fn parse_expression(&mut self) -> Result<f64, String> {
        self.parse_additive()
    }

    fn parse_additive(&mut self) -> Result<f64, String> {
        let mut left = self.parse_multiplicative()?;
        while let Some(tok) = self.peek() {
            match tok {
                ParamToken::Plus => {
                    self.next_token();
                    let right = self.parse_multiplicative()?;
                    left += right;
                }
                ParamToken::Minus => {
                    self.next_token();
                    let right = self.parse_multiplicative()?;
                    left -= right;
                }
                _ => break,
            }
        }
        Ok(left)
    }

    fn parse_multiplicative(&mut self) -> Result<f64, String> {
        let mut left = self.parse_power()?;
        while let Some(tok) = self.peek() {
            match tok {
                ParamToken::Mul => {
                    self.next_token();
                    let right = self.parse_power()?;
                    left *= right;
                }
                ParamToken::Div => {
                    self.next_token();
                    let right = self.parse_power()?;
                    if right.abs() < 1e-30 {
                        left = 0.0;
                    } else {
                        left /= right;
                    }
                }
                _ => break,
            }
        }
        Ok(left)
    }

    fn parse_power(&mut self) -> Result<f64, String> {
        let base = self.parse_unary()?;
        if let Some(ParamToken::Caret) = self.peek() {
            self.next_token();
            let exponent = self.parse_power()?; // asociatividad por la derecha
            Ok(base.powf(exponent))
        } else {
            Ok(base)
        }
    }

    fn parse_unary(&mut self) -> Result<f64, String> {
        match self.peek() {
            Some(ParamToken::Plus) => {
                self.next_token();
                self.parse_unary()
            }
            Some(ParamToken::Minus) => {
                self.next_token();
                let val = self.parse_unary()?;
                Ok(-val)
            }
            _ => self.parse_primary(),
        }
    }

    fn parse_primary(&mut self) -> Result<f64, String> {
        match self.next_token() {
            Some(ParamToken::Num(v)) => Ok(v),
            Some(ParamToken::LParen) => {
                let inner = self.parse_expression()?;
                match self.next_token() {
                    Some(ParamToken::RParen) => Ok(inner),
                    other => Err(format!(
                        "Se esperaba ')' en expresión, encontrado: {:?}",
                        other
                    )),
                }
            }
            Some(ParamToken::Ident(name)) => {
                let name_lower = name.to_lowercase();

                // Verificar si es una llamada a función: func(...)
                if let Some(ParamToken::LParen) = self.peek() {
                    self.next_token(); // consumir '('
                    let mut args = Vec::new();
                    if let Some(ParamToken::RParen) = self.peek() {
                        self.next_token(); // consumir ')'
                    } else {
                        loop {
                            let arg = self.parse_expression()?;
                            args.push(arg);
                            match self.peek() {
                                Some(ParamToken::Comma) => {
                                    self.next_token(); // consumir ','
                                }
                                Some(ParamToken::RParen) => {
                                    self.next_token(); // consumir ')'
                                    break;
                                }
                                other => {
                                    return Err(format!(
                                        "Se esperaba ',' o ')' en llamada a función '{}', encontrado: {:?}",
                                        name, other
                                    ));
                                }
                            }
                        }
                    }

                    return self.eval_function(&name_lower, &args);
                }

                // Constantes científicas predefinidas
                match name_lower.as_str() {
                    "pi" => Ok(std::f64::consts::PI),
                    "e" => Ok(std::f64::consts::E),
                    "vt" => Ok(0.02585),
                    "boltz" | "k_b" => Ok(1.380649e-23),
                    "echarge" | "q" => Ok(1.602176634e-19),
                    _ => {
                        // Buscar en el entorno de parámetros
                        if let Some(&val) = self.param_env.get(&name_lower) {
                            Ok(val)
                        } else if let Some(&val) = self.param_env.get(&name) {
                            Ok(val)
                        } else if let Ok(val) = parse_spice_value(&name) {
                            Ok(val)
                        } else {
                            Err(format!(
                                "Parámetro o variable no definido en el entorno: '{}'",
                                name
                            ))
                        }
                    }
                }
            }
            other => Err(format!(
                "Token inesperado en expresión matemática: {:?}",
                other
            )),
        }
    }

    fn eval_function(&self, name: &str, args: &[f64]) -> Result<f64, String> {
        match name {
            "sqrt" => {
                let x = args.first().copied().ok_or("sqrt requiere 1 argumento")?;
                if x < 0.0 {
                    Err(format!("Argumento negativo para sqrt: {}", x))
                } else {
                    Ok(x.sqrt())
                }
            }
            "exp" => {
                let x = args.first().copied().ok_or("exp requiere 1 argumento")?;
                Ok(x.exp())
            }
            "ln" => {
                let x = args.first().copied().ok_or("ln requiere 1 argumento")?;
                if x <= 0.0 {
                    Err(format!("Argumento no positivo para ln: {}", x))
                } else {
                    Ok(x.ln())
                }
            }
            "log" | "log10" => {
                let x = args.first().copied().ok_or("log10 requiere 1 argumento")?;
                if x <= 0.0 {
                    Err(format!("Argumento no positivo para log10: {}", x))
                } else {
                    Ok(x.log10())
                }
            }
            "pow" => {
                if args.len() < 2 {
                    return Err("pow requiere 2 argumentos: pow(base, exp)".to_string());
                }
                Ok(args[0].powf(args[1]))
            }
            "abs" => {
                let x = args.first().copied().ok_or("abs requiere 1 argumento")?;
                Ok(x.abs())
            }
            "min" => {
                if args.len() < 2 {
                    return Err("min requiere al menos 2 argumentos".to_string());
                }
                Ok(args[0].min(args[1]))
            }
            "max" => {
                if args.len() < 2 {
                    return Err("max requiere al menos 2 argumentos".to_string());
                }
                Ok(args[0].max(args[1]))
            }
            "sin" => {
                let x = args.first().copied().ok_or("sin requiere 1 argumento")?;
                Ok(x.sin())
            }
            "cos" => {
                let x = args.first().copied().ok_or("cos requiere 1 argumento")?;
                Ok(x.cos())
            }
            "tan" => {
                let x = args.first().copied().ok_or("tan requiere 1 argumento")?;
                Ok(x.tan())
            }
            "sinh" => {
                let x = args.first().copied().ok_or("sinh requiere 1 argumento")?;
                Ok(x.sinh())
            }
            "cosh" => {
                let x = args.first().copied().ok_or("cosh requiere 1 argumento")?;
                Ok(x.cosh())
            }
            "tanh" => {
                let x = args.first().copied().ok_or("tanh requiere 1 argumento")?;
                Ok(x.tanh())
            }
            "floor" => {
                let x = args.first().copied().ok_or("floor requiere 1 argumento")?;
                Ok(x.floor())
            }
            "ceil" => {
                let x = args.first().copied().ok_or("ceil requiere 1 argumento")?;
                Ok(x.ceil())
            }
            "round" => {
                let x = args.first().copied().ok_or("round requiere 1 argumento")?;
                Ok(x.round())
            }
            _ => Err(format!(
                "Función matemática no reconocida en expresión SPICE: '{}'",
                name
            )),
        }
    }
}
