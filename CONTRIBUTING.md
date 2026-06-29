# 🛠️ Contributing Guide — Astrid Sophia

Gracias por tu interés en contribuir a **Astrid Sophia**, el simulador de circuitos mixtos de código abierto.

---

## 📋 Tabla de Contenidos

1. [Código de Conducta](#código-de-conducta)
2. [Cómo Contribuir](#cómo-contribuir)
3. [Configuración del Entorno](#configuración-del-entorno)
4. [Flujo de Trabajo Git](#flujo-de-trabajo-git)
5. [Estándares de Código](#estándares-de-código)
6. [Testing](#testing)
7. [Reportar Bugs](#reportar-bugs)
8. [Solicitar Features](#solicitar-features)

---

## Código de Conducta

- Sé respetuoso y constructivo en todas las interacciones.
- Aceptamos contribuciones de todos los niveles de experiencia.
- No toleramos acoso, discriminación o comportamiento ofensivo.

---

## Cómo Contribuir

### Tipos de Contribuciones

| Tipo | Descripción | Ejemplos |
|------|-------------|----------|
| 🐛 Bug Fixes | Corrección de errores | Crash en parser, ERC falso positivo |
| ✨ Features | Nuevas funcionalidades | Nuevo modelo de dispositivo, análisis FFT |
| 📚 Documentación | Mejoras en docs | QUICKSTART, ejemplos, comentarios |
| 🧪 Tests | Cobertura de testing | Unit tests, integration tests |
| 🎨 UI/UX | Mejoras de interfaz | Tooltips, accesibilidad, temas |
| ⚡ Performance | Optimizaciones | SIMD, paralelización, caching |

---

## Configuración del Entorno

### Prerrequisitos

```bash
# Node.js v18+
node --version
npm --version

# Rust edition 2021
rustc --version
cargo --version

# Git
git --version
```

### Instalación

```bash
# 1. Clonar repositorio
git clone https://github.com/Dante7u7r/Astrid_sophia.git
cd Astrid_sophia

# 2. Instalar dependencias frontend
npm install

# 3. Verificar build de Rust
cd src-tauri
cargo check
cd ..

# 4. Ejecutar en modo desarrollo
npm run dev
```

### IDE Recomendado

- **VS Code** con extensiones:
  - `rust-analyzer`
  - `TypeScript Hero`
  - `Tauri`
  - `Prettier`

---

## Flujo de Trabajo Git

### 1. Crear un fork (si no eres colaborador directo)

```bash
# En GitHub: Click en "Fork"
git clone https://github.com/TU_USUARIO/Astrid_sophia.git
cd Astrid_sophia
git remote add upstream https://github.com/Dante7u7r/Astrid_sophia.git
```

### 2. Crear una rama feature

```bash
git checkout master
git pull upstream master
git checkout -b feature/nombre-descriptivo
```

### 3. Desarrollar y commitear

```bash
# Hacer cambios...
git add .
git commit -m "feat: descripción clara del cambio"

# Convenciones de commits:
# feat:     Nueva funcionalidad
# fix:      Corrección de bug
# docs:     Documentación
# style:    Formato (sin cambios de lógica)
# refactor: Refactorización (sin cambios de comportamiento)
# test:     Agregar/modificar tests
# chore:    Tareas de mantenimiento
```

### 4. Sincronizar con upstream

```bash
git fetch upstream
git rebase upstream master
```

### 5. Push y Pull Request

```bash
git push origin feature/nombre-descriptivo
# Ir a GitHub y crear Pull Request
```

### Checklist para PR

- [ ] El código compila sin warnings (`cargo clippy -- -D warnings`)
- [ ] Todos los tests pasan (`npm test` + `cargo test`)
- [ ] Se agregaron tests para nuevas features
- [ ] La documentación está actualizada
- [ ] El commit sigue las convenciones
- [ ] No hay `unwrap()` en código crítico (usar `?` o `match`)

---

## Estándares de Código

### Rust

```rust
// ✅ BIEN: Manejo seguro de errores
fn parse_value(input: &str) -> Result<f64, ParseError> {
    let value = input.parse::<f64>()
        .map_err(|e| ParseError::InvalidNumber(e))?;
    Ok(value)
}

// ❌ MAL: unwrap() peligroso
fn parse_value(input: &str) -> f64 {
    input.parse::<f64>().unwrap() // ¡Puede panic!
}

// ✅ BIEN: Pattern matching exhaustivo
match result {
    Ok(val) => process(val),
    Err(e) => log_error(e),
}

// ✅ BIEN: Documentación de funciones públicas
/// Calcula la corriente de drenaje para un MOSFET Level 1.
/// 
/// # Arguments
/// * `vgs` - Voltaje Gate-Source
/// * `vds` - Voltaje Drain-Source
/// * `model` - Parámetros del modelo BSIM
/// 
/// # Returns
/// Corriente en Amperios
pub fn ids_mosfet(vgs: f64, vds: f64, model: &MosfetModel) -> f64 {
    // ...
}
```

### TypeScript

```typescript
// ✅ BIEN: Tipado estricto
interface CircuitNode {
  id: string;
  voltage: number | null;
  connections: string[];
}

// ✅ BIEN: Manejo de errores con try-catch
async function runSimulation(): Promise<void> {
  try {
    await invoke('run_transient_analysis', { netlist });
  } catch (error) {
    console.error('Simulación falló:', error);
    showUserError(error);
  }
}

// ❌ MAL: any implícito o explícito
function process(data: any) { ... } // ¡Evitar!

// ✅ BIEN: Funciones puras sin efectos secundarios
function calculateResistance(colorCode: string[]): number {
  return colorCode.reduce((acc, color) => acc * multiplier(color), 0);
}
```

### Estructura de Archivos

```
src/
├── simulation/          # Lógica de simulación (pura, sin estado global)
│   ├── netlist_extractor.ts
│   ├── fallback_solver.ts
│   └── ...
├── ui/                  # Componentes de interfaz
│   ├── oscilloscope_panel.ts
│   └── ...
└── main.ts              # Entry point

src-tauri/src/
├── solver/              # Motor MNA en Rust
│   ├── engine.rs
│   ├── matrix.rs
│   └── ...
├── parser.rs            # Parser SPICE
└── lib.rs               # Puentes Tauri IPC
```

---

## Testing

### Frontend (Vitest)

```bash
# Ejecutar todos los tests
npm test

# Modo watch para TDD
npm run test:watch

# Coverage
npm run test:coverage
```

**Ejemplo de test:**

```typescript
import { describe, it, expect } from 'vitest';
import { extractNetlist } from '../simulation/netlist_extractor';

describe('NetlistExtractor', () => {
  it('debe extraer nodos correctamente', () => {
    const components = [
      { id: 'R1', terminals: ['n1', 'n2'] },
      { id: 'C1', terminals: ['n2', '0'] }
    ];
    const netlist = extractNetlist(components);
    expect(netlist.nodes).toContain('n1');
    expect(netlist.nodes).toContain('0'); // Ground
  });
});
```

### Backend (Cargo Test)

```bash
cd src-tauri

# Todos los tests
cargo test

# Test específico
cargo test test_parse_resistor

# Con output detallado
cargo test -- --nocapture
```

**Ejemplo de test en Rust:**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_resistor_value() {
        assert_eq!(parse_spice_value("10k"), Ok(10000.0));
        assert_eq!(parse_spice_value("4.7u"), Ok(4.7e-6));
        assert_eq!(parse_spice_value("invalid"), Err(ParseError::InvalidFormat));
    }
}
```

---

## Reportar Bugs

### Plantilla de Bug Report

```markdown
**Descripción:**
Breve descripción del problema.

**Pasos para reproducir:**
1. Abrir circuito X
2. Configurar parámetro Y
3. Ejecutar simulación
4. Ver error Z

**Comportamiento esperado:**
Qué debería ocurrir.

**Comportamiento actual:**
Qué ocurre realmente.

**Capturas de pantalla:**
(Si aplica)

**Entorno:**
- OS: Windows 11 / macOS 14 / Ubuntu 22.04
- Versión: v0.37.0
- Browser: Chrome 120 (si aplica)

**Información adicional:**
Logs, netlists de ejemplo, etc.
```

---

## Solicitar Features

### Plantilla de Feature Request

```markdown
**¿Tu solicitud está relacionada con un problema?**
Describe el problema que intentas resolver.

**Describe la solución que te gustaría:**
Explica claramente qué quieres que ocurra.

**Describe alternativas que has considerado:**
Otras formas de abordar el problema.

**Información adicional:**
Mockups, casos de uso, referencias a otros simuladores.
```

---

## 🎯 Áreas Prioritarias para Contribución

| Área | Dificultad | Impacto | Issues Relacionados |
|------|------------|---------|---------------------|
| Reemplazar `unwrap()` por manejo de errores | Baja | Alto | #42, #43 |
| Agregar tooltips a la UI | Baja | Medio | #45 |
| Tests de integración end-to-end | Media | Alto | #40 |
| Organización de componentes por categorías | Media | Medio | #46 |
| Scripts de build cross-platform | Baja | Alto | #41 |
| Validación mejorada de netlist | Media | Alto | #44 |

---

## 📞 Contacto

- **GitHub Issues:** Para bugs y features
- **GitHub Discussions:** Para preguntas generales
- **Email:** (si se proporciona en el futuro)

---

*¡Gracias por hacer de Astrid Sophia un proyecto mejor! 🚀*
