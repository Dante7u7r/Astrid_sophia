pub mod lexer;
pub mod expressions;
pub mod devices;
pub mod subcircuits;

#[cfg(test)]
mod tests;

pub use lexer::*;
pub use expressions::*;
pub use devices::*;
pub use subcircuits::*;

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
        // Eliminar comentarios inline $ (estándar SPICE)
        let line_no_comment = raw_line.split('$').next().unwrap_or(raw_line);
        let clean = line_no_comment.trim();
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

        if let Some(stripped) = clean.strip_prefix('+') {
            accum_line.push(' ');
            accum_line.push_str(stripped);
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


