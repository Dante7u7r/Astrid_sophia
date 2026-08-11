//! subcircuit_expander.rs
//! Referencia: Parser SPICE + Expansión Jerárquica + Resolución PARAMS
//! para el motor MNA de Astryd Sophia.
//!
//! Pipeline:
//!   String SPICE → Tokenizer → AST (SubcktDef, ModelDef) → Expander → Vec<ComponentData>

use std::collections::HashMap;

// ─────────────────────────────────────────────
// Tipos de Salida para el Solver MNA
// ─────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum ComponentData {
    Resistor  { id: String, n_pos: String, n_neg: String, value: f64 },
    Capacitor { id: String, n_pos: String, n_neg: String, value: f64 },
    Inductor  { id: String, n_pos: String, n_neg: String, value: f64 },
    VSource   { id: String, n_pos: String, n_neg: String, dc: f64    },
    ISource   { id: String, n_pos: String, n_neg: String, dc: f64    },
    Vcvs {
        id: String,
        n_out_pos: String, n_out_neg: String,
        n_in_pos:  String, n_in_neg:  String,
        gain: f64,
    },
    Vccs {
        id: String,
        n_out_pos: String, n_out_neg: String,
        n_in_pos:  String, n_in_neg:  String,
        gm: f64,
    },
}

// ─────────────────────────────────────────────
// AST Intermedio
// ─────────────────────────────────────────────

#[derive(Debug, Clone)]
struct SubcktDef {
    name:     String,
    ports:    Vec<String>,
    params:   HashMap<String, f64>, // valores por defecto
    elements: Vec<RawElement>,
}

/// Elemento sin resolver (nodos y valores aún como strings)
#[derive(Debug, Clone)]
enum RawElement {
    Primitive {
        kind:   char,       // R, C, L, V, I, E, G
        id:     String,
        nodes:  Vec<String>,
        value:  String,     // puede ser "{PARAM}" o literal
        extra:  Vec<String>, // para E/G: nodos de control
    },
    Instance {
        id:        String,
        ext_nodes: Vec<String>,
        subckt:    String,
        params:    HashMap<String, String>, // sin resolver aún
    },
}

// ─────────────────────────────────────────────
// Parser de Valores SPICE (sufijos)
// ─────────────────────────────────────────────

fn parse_spice_value(s: &str) -> f64 {
    // Normalizar: quitar espacios, lowercase
    let s = s.trim().to_lowercase();

    // Separar dígitos de sufijo
    let (num_part, suffix) = split_num_suffix(&s);
    let base: f64 = num_part.parse().unwrap_or(0.0);

    let multiplier = match suffix.as_str() {
        "t"         => 1e12,
        "g"         => 1e9,
        "meg"       => 1e6,
        "k"         => 1e3,
        "m"         => 1e-3,  // SPICE: 'm' = mili, NO mega
        "u" | "µ"   => 1e-6,
        "n"         => 1e-9,
        "p"         => 1e-12,
        "f"         => 1e-15,
        _           => 1.0,
    };
    base * multiplier
}

fn split_num_suffix(s: &str) -> (String, String) {
    // Encontrar donde terminan los dígitos (incluyendo punto y 'e' para notación científica)
    let mut end = s.len();
    for (i, c) in s.char_indices().rev() {
        if c.is_ascii_digit() || c == '.' || c == '-' || c == '+' {
            end = i + c.len_utf8();
            break;
        }
    }
    // Caso especial: 'meg' puede seguir a dígitos directamente
    let num  = s[..end].to_string();
    let suf  = s[end..].trim_start().to_string();
    (num, suf)
}

// ─────────────────────────────────────────────
// Tokenizer SPICE
// ─────────────────────────────────────────────

pub struct SpiceTokenizer {
    subckt_defs: HashMap<String, SubcktDef>,
    top_elements: Vec<RawElement>,
}

impl SpiceTokenizer {
    pub fn new() -> Self {
        Self {
            subckt_defs:  HashMap::new(),
            top_elements: Vec::new(),
        }
    }

    /// Procesa un String con contenido SPICE completo.
    pub fn parse(&mut self, input: &str) {
        // Fase 1: Pre-procesar líneas (continuación '+', comentarios)
        let lines = self.preprocess(input);

        // Fase 2: Clasificar y parsear cada línea
        let mut inside_subckt: Option<SubcktDef> = None;
        let mut depth = 0usize; // para subcircuitos anidados

        for line in &lines {
            let lower = line.trim().to_lowercase();

            if lower.is_empty() || lower.starts_with('*') {
                continue;
            }

            if lower.starts_with(".subckt") {
                depth += 1;
                if depth == 1 {
                    inside_subckt = Some(self.parse_subckt_header(&lower));
                }
                continue;
            }

            if lower.starts_with(".ends") {
                depth -= 1;
                if depth == 0 {
                    if let Some(def) = inside_subckt.take() {
                        self.subckt_defs.insert(def.name.clone(), def);
                    }
                }
                continue;
            }

            // Parsear elementos
            if let Some(elem) = self.parse_element_line(&lower) {
                if let Some(ref mut def) = inside_subckt {
                    def.elements.push(elem);
                } else {
                    self.top_elements.push(elem);
                }
            }
        }
    }

    /// Une líneas de continuación '+' y elimina comentarios '$'
    fn preprocess(&self, input: &str) -> Vec<String> {
        let mut result: Vec<String> = Vec::new();

        for raw_line in input.lines() {
            // Eliminar comentario inline '$'
            let line = if let Some(pos) = raw_line.find('$') {
                &raw_line[..pos]
            } else {
                raw_line
            };

            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('*') {
                result.push(String::new());
                continue;
            }

            // Continuación de línea
            if trimmed.starts_with('+') {
                if let Some(last) = result.last_mut() {
                    last.push(' ');
                    last.push_str(&trimmed[1..].trim());
                    continue;
                }
            }

            result.push(trimmed.to_string());
        }
        result
    }

    /// Parsea la cabecera `.subckt nombre nodo1 nodo2 [PARAMS: k=v ...]`
    fn parse_subckt_header(&self, line: &str) -> SubcktDef {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // parts[0] = ".subckt", parts[1] = nombre, rest = nodos [PARAMS: ...]
        let name = parts.get(1).unwrap_or(&"unknown").to_string();

        let mut ports  = Vec::new();
        let mut params = HashMap::new();
        let mut in_params = false;

        for &tok in parts.iter().skip(2) {
            if tok.to_lowercase() == "params:" {
                in_params = true;
                continue;
            }
            if in_params {
                if let Some((k, v)) = tok.split_once('=') {
                    params.insert(k.to_string(), parse_spice_value(v));
                }
            } else {
                ports.push(tok.to_string());
            }
        }

        SubcktDef { name, ports, params, elements: Vec::new() }
    }

    /// Parsea una línea de elemento (R, C, L, V, I, E, G, X…)
    fn parse_element_line(&self, line: &str) -> Option<RawElement> {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() { return None; }

        let first_char = parts[0].chars().next()?;

        match first_char {
            // ── Primitivos de 2 nodos ──
            'r' | 'c' | 'l' => {
                // R<id> <n+> <n-> <valor>
                if parts.len() < 4 { return None; }
                Some(RawElement::Primitive {
                    kind:  first_char.to_ascii_uppercase(),
                    id:    parts[0].to_string(),
                    nodes: vec![parts[1].to_string(), parts[2].to_string()],
                    value: parts[3].to_string(),
                    extra: vec![],
                })
            }

            'v' | 'i' => {
                // V<id> <n+> <n-> DC <valor>  | V<id> <n+> <n-> <valor>
                if parts.len() < 4 { return None; }
                let value_idx = if parts.get(3).map(|s| s.to_lowercase() == "dc").unwrap_or(false) {
                    4
                } else {
                    3
                };
                Some(RawElement::Primitive {
                    kind:  first_char.to_ascii_uppercase(),
                    id:    parts[0].to_string(),
                    nodes: vec![parts[1].to_string(), parts[2].to_string()],
                    value: parts.get(value_idx).unwrap_or(&"0").to_string(),
                    extra: vec![],
                })
            }

            // ── Fuentes Controladas ──
            'e' => {
                // E<id> <no+> <no-> <ni+> <ni-> <ganancia>
                if parts.len() < 6 { return None; }
                Some(RawElement::Primitive {
                    kind:  'E',
                    id:    parts[0].to_string(),
                    nodes: vec![parts[1].to_string(), parts[2].to_string()],
                    value: parts[5].to_string(),
                    extra: vec![parts[3].to_string(), parts[4].to_string()],
                })
            }

            'g' => {
                // G<id> <no+> <no-> <ni+> <ni-> <gm>
                if parts.len() < 6 { return None; }
                Some(RawElement::Primitive {
                    kind:  'G',
                    id:    parts[0].to_string(),
                    nodes: vec![parts[1].to_string(), parts[2].to_string()],
                    value: parts[5].to_string(),
                    extra: vec![parts[3].to_string(), parts[4].to_string()],
                })
            }

            // ── Instancia de Subcircuito ──
            'x' => {
                // X<id> <nodo…> <subckt_name> [PARAMS: k=v …]
                if parts.len() < 3 { return None; }
                let mut params_map = HashMap::new();
                let mut params_start = parts.len();

                // Buscar "params:" para separar nodos de parámetros
                for (i, &tok) in parts.iter().enumerate().skip(1) {
                    if tok.to_lowercase() == "params:" {
                        params_start = i;
                        break;
                    }
                }

                // El último token antes de params: (o del final) es el nombre del subckt
                let subckt_end = if params_start < parts.len() { params_start } else { parts.len() };
                let subckt_name = parts[subckt_end - 1].to_string();
                let ext_nodes: Vec<String> = parts[1..subckt_end - 1]
                    .iter().map(|s| s.to_string()).collect();

                // Parsear PARAMS: k=v ...
                for &tok in parts.iter().skip(params_start + 1) {
                    if let Some((k, v)) = tok.split_once('=') {
                        params_map.insert(k.to_string(), v.to_string());
                    }
                }

                Some(RawElement::Instance {
                    id:        parts[0].to_string(),
                    ext_nodes,
                    subckt:    subckt_name,
                    params:    params_map,
                })
            }

            _ => None,
        }
    }
}

// ─────────────────────────────────────────────
// Expansor Jerárquico
// ─────────────────────────────────────────────

pub struct SubcircuitExpander<'a> {
    defs: &'a HashMap<String, SubcktDef>,
}

impl<'a> SubcircuitExpander<'a> {
    pub fn new(defs: &'a HashMap<String, SubcktDef>) -> Self {
        Self { defs }
    }

    /// Aplana una instancia X<id> hacia Vec<ComponentData>
    pub fn expand_instance(
        &self,
        instance_id:    &str,
        subckt_name:    &str,
        ext_nodes:      &[String],
        instance_params: &HashMap<String, String>,
        parent_params:  &HashMap<String, f64>,
    ) -> Vec<ComponentData> {
        let def = match self.defs.get(subckt_name) {
            Some(d) => d,
            None => {
                eprintln!("ERROR: subckt '{}' no encontrado", subckt_name);
                return vec![];
            }
        };

        // Construir portMap: nombre_puerto → nodo_del_padre
        let mut port_map = HashMap::new();
        for (i, port) in def.ports.iter().enumerate() {
            if let Some(ext) = ext_nodes.get(i) {
                port_map.insert(port.clone(), ext.clone());
            }
        }

        // Construir ParamContext: defaults + instance overrides
        let mut ctx = def.params.clone();
        for (k, v_str) in instance_params {
            ctx.insert(k.clone(), parse_spice_value(v_str));
        }
        // Heredar parámetros del padre no sobrescritos
        for (k, v) in parent_params {
            ctx.entry(k.clone()).or_insert(*v);
        }

        let prefix = format!("{}_{}", instance_id, subckt_name);
        let mut result = Vec::new();

        for elem in &def.elements {
            self.expand_element(elem, &prefix, &port_map, &ctx, &mut result);
        }

        result
    }

    fn expand_element(
        &self,
        elem:     &RawElement,
        prefix:   &str,
        port_map: &HashMap<String, String>,
        ctx:      &HashMap<String, f64>,
        out:      &mut Vec<ComponentData>,
    ) {
        match elem {
            RawElement::Primitive { kind, id, nodes, value, extra } => {
                let mapped_nodes: Vec<String> = nodes.iter()
                    .map(|n| remap_node(n, port_map, prefix))
                    .collect();
                let mapped_extra: Vec<String> = extra.iter()
                    .map(|n| remap_node(n, port_map, prefix))
                    .collect();

                let val = resolve_value(value, ctx);
                let full_id = format!("{}_{}", prefix, id);

                let comp = match kind {
                    'R' => Some(ComponentData::Resistor {
                        id: full_id,
                        n_pos: mapped_nodes[0].clone(),
                        n_neg: mapped_nodes[1].clone(),
                        value: val,
                    }),
                    'C' => Some(ComponentData::Capacitor {
                        id: full_id,
                        n_pos: mapped_nodes[0].clone(),
                        n_neg: mapped_nodes[1].clone(),
                        value: val,
                    }),
                    'L' => Some(ComponentData::Inductor {
                        id: full_id,
                        n_pos: mapped_nodes[0].clone(),
                        n_neg: mapped_nodes[1].clone(),
                        value: val,
                    }),
                    'V' => Some(ComponentData::VSource {
                        id: full_id,
                        n_pos: mapped_nodes[0].clone(),
                        n_neg: mapped_nodes[1].clone(),
                        dc: val,
                    }),
                    'I' => Some(ComponentData::ISource {
                        id: full_id,
                        n_pos: mapped_nodes[0].clone(),
                        n_neg: mapped_nodes[1].clone(),
                        dc: val,
                    }),
                    'E' => Some(ComponentData::Vcvs {
                        id: full_id,
                        n_out_pos: mapped_nodes[0].clone(),
                        n_out_neg: mapped_nodes[1].clone(),
                        n_in_pos:  mapped_extra[0].clone(),
                        n_in_neg:  mapped_extra[1].clone(),
                        gain: val,
                    }),
                    'G' => Some(ComponentData::Vccs {
                        id: full_id,
                        n_out_pos: mapped_nodes[0].clone(),
                        n_out_neg: mapped_nodes[1].clone(),
                        n_in_pos:  mapped_extra[0].clone(),
                        n_in_neg:  mapped_extra[1].clone(),
                        gm: val,
                    }),
                    _ => None,
                };

                if let Some(c) = comp { out.push(c); }
            }

            RawElement::Instance { id, ext_nodes, subckt, params } => {
                // Remapear nodos externos de esta sub-instancia
                let remapped_nodes: Vec<String> = ext_nodes.iter()
                    .map(|n| remap_node(n, port_map, prefix))
                    .collect();

                let sub_prefix = format!("{}_{}", prefix, id);
                let expanded = self.expand_instance(
                    &sub_prefix,
                    subckt,
                    &remapped_nodes,
                    params,
                    ctx,
                );
                out.extend(expanded);
            }
        }
    }
}

// ─────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────

/// Remapea un nodo interno al espacio de nodos del padre.
fn remap_node(node: &str, port_map: &HashMap<String, String>, prefix: &str) -> String {
    if node == "0" {
        return "0".to_string(); // Tierra global: inmutable
    }
    if let Some(external) = port_map.get(node) {
        return external.clone();
    }
    format!("{}_{}", prefix, node)
}

/// Resuelve un valor que puede ser literal o referencia a parámetro `{PARAM}`.
fn resolve_value(value: &str, ctx: &HashMap<String, f64>) -> f64 {
    let v = value.trim();

    // Expresión entre llaves: {PARAM} o {PARAM*2}
    if v.starts_with('{') && v.ends_with('}') {
        let inner = &v[1..v.len() - 1];
        return eval_expr(inner, ctx);
    }

    // Valor literal SPICE directo
    parse_spice_value(v)
}

/// Evaluador de expresiones aritméticas simples con parámetros.
/// Soporta: referencias, +, -, *, /, constantes literales.
fn eval_expr(expr: &str, ctx: &HashMap<String, f64>) -> f64 {
    let expr = expr.trim();

    // Intentar lookup directo de parámetro
    if let Some(&v) = ctx.get(expr) {
        return v;
    }

    // Intentar parse como número
    if let Ok(v) = expr.parse::<f64>() {
        return v;
    }

    // Multiplicación / División (mayor precedencia)
    if let Some(pos) = find_op(expr, &['*', '/']) {
        let lhs = eval_expr(&expr[..pos], ctx);
        let rhs = eval_expr(&expr[pos + 1..], ctx);
        return if expr.chars().nth(pos) == Some('*') { lhs * rhs } else { lhs / rhs };
    }

    // Suma / Resta
    if let Some(pos) = find_op(expr, &['+', '-']) {
        let lhs = eval_expr(&expr[..pos], ctx);
        let rhs = eval_expr(&expr[pos + 1..], ctx);
        return if expr.chars().nth(pos) == Some('+') { lhs + rhs } else { lhs - rhs };
    }

    eprintln!("WARN: no se pudo evaluar expresión: '{}'", expr);
    0.0
}

/// Busca el operador de menor precedencia (más a la derecha, fuera de paréntesis).
fn find_op(expr: &str, ops: &[char]) -> Option<usize> {
    let mut depth = 0i32;
    let chars: Vec<char> = expr.chars().collect();
    let mut last_pos = None;

    for (i, &c) in chars.iter().enumerate() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ if depth == 0 && ops.contains(&c) => {
                last_pos = Some(i);
            }
            _ => {}
        }
    }
    last_pos
}

// ─────────────────────────────────────────────
// API Pública: parse_spice_netlist
// ─────────────────────────────────────────────

/// Punto de entrada principal. Toma un String SPICE y retorna
/// la lista de ComponentData aplanados para el solver MNA.
pub fn parse_spice_netlist(spice_input: &str) -> Vec<ComponentData> {
    let mut tokenizer = SpiceTokenizer::new();
    tokenizer.parse(spice_input);

    let expander = SubcircuitExpander::new(&tokenizer.subckt_defs);
    let mut result = Vec::new();

    for elem in &tokenizer.top_elements {
        match elem {
            RawElement::Primitive { .. } => {
                expander.expand_element(elem, "TOP", &HashMap::new(), &HashMap::new(), &mut result);
            }
            RawElement::Instance { id, ext_nodes, subckt, params } => {
                let expanded = expander.expand_instance(
                    id, subckt, ext_nodes, params, &HashMap::new(),
                );
                result.extend(expanded);
            }
        }
    }

    result
}

// ─────────────────────────────────────────────
// Tests / Demo
// ─────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const OPAMP_LIB: &str = r#"
* Op-Amp simplificado con resistencia de entrada, VCVS y resistencia de salida
.subckt OpAmp_Simple IN+ IN- OUT VCC VEE PARAMS: Rin=1Meg Aol=100K Rout=75

* Resistencia diferencial de entrada
Rin IN+ IN- {Rin}

* Amplificador de tensión (VCVS): ganancia Aol
E1 int_out_pre 0 IN+ IN- {Aol}

* Resistencia de salida
Rout int_out_pre OUT {Rout}

* Cargas de suministro (modelado mínimo)
Rvcc VCC 0 1Meg
Rvee VEE 0 1Meg

.ends OpAmp_Simple

* ── Circuito de prueba: amplificador no inversor ──
* V+ = 100mV DC, retroalimentación 10x
Vin   IN_POS 0 DC 100m
Rfb1  OUT_NODE FB_NODE 9K
Rfb2  FB_NODE 0 1K
Xamp1 IN_POS FB_NODE OUT_NODE VCC_RAIL VEE_RAIL OpAmp_Simple PARAMS: Aol=200K
Vcc   VCC_RAIL 0 DC 15
Vee   VEE_RAIL 0 DC -15
Rload OUT_NODE 0 10K
"#;

    #[test]
    fn test_opamp_expansion() {
        let components = parse_spice_netlist(OPAMP_LIB);

        println!("\n=== Componentes Aplanados (MNA) ===");
        for comp in &components {
            match comp {
                ComponentData::Resistor  { id, n_pos, n_neg, value } =>
                    println!("R  {:30} {:15} {:15} {:.3e} Ω", id, n_pos, n_neg, value),
                ComponentData::VSource   { id, n_pos, n_neg, dc } =>
                    println!("V  {:30} {:15} {:15} {:.3} V", id, n_pos, n_neg, dc),
                ComponentData::Vcvs { id, n_out_pos, n_out_neg, n_in_pos, n_in_neg, gain } =>
                    println!("E  {:30} [{}/{}] ctrl [{}/{}] gain={:.0}", id, n_out_pos, n_out_neg, n_in_pos, n_in_neg, gain),
                _ => println!("{:?}", comp),
            }
        }

        // Verificar que el VCVS fue expandido con el Aol del override (200K)
        let vcvs = components.iter().find(|c| matches!(c, ComponentData::Vcvs { .. }));
        assert!(vcvs.is_some(), "VCVS no encontrado en la expansión");
        if let Some(ComponentData::Vcvs { gain, .. }) = vcvs {
            assert!((*gain - 200_000.0).abs() < 1.0, "Aol override no aplicado correctamente");
        }

        // Verificar que la tierra global no fue renombrada
        let r_vin = components.iter().find(|c| {
            matches!(c, ComponentData::VSource { id, .. } if id.contains("Vin"))
        });
        if let Some(ComponentData::VSource { n_neg, .. }) = r_vin {
            assert_eq!(n_neg, "0", "Tierra global 'Vin' fue renombrada incorrectamente");
        }

        println!("\nTotal componentes aplanados: {}", components.len());
    }

    #[test]
    fn test_parse_spice_values() {
        assert_eq!(parse_spice_value("1K"),    1_000.0);
        assert_eq!(parse_spice_value("1Meg"),  1_000_000.0);
        assert_eq!(parse_spice_value("1m"),    0.001);
        assert_eq!(parse_spice_value("100n"),  100e-9);
        assert_eq!(parse_spice_value("22p"),   22e-12);
        assert!((parse_spice_value("1.5u") - 1.5e-6).abs() < 1e-20);
        println!("parse_spice_value: todos los sufijos OK");
    }
}
