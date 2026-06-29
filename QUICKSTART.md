# ⚡ Quick Start Guide — Astrid Sophia

**Tiempo estimado:** 5 minutos  
**Nivel:** Principiante a Intermedio

---

## 📋 Prerrequisitos

Asegúrate de tener instalado:
- **Node.js** v18+ ([descargar](https://nodejs.org/))
- **Rust** (edición 2021) ([instalar](https://rustup.rs/))
- **Git** para clonar el repositorio

Verifica las instalaciones:
```bash
node --version    # v18.x o superior
npm --version     # 9.x o superior
rustc --version   # 1.70.0 o superior
cargo --version   # 1.70.0 o superior
```

---

## 🚀 Instalación Rápida

### 1. Clonar el repositorio
```bash
git clone https://github.com/Dante7u7r/Astrid_sophia.git
cd Astrid_sophia
```

### 2. Instalar dependencias
```bash
# Dependencias de frontend
npm install

# Verificar compilación de Rust (opcional pero recomendado)
cd src-tauri
cargo check
cd ..
```

### 3. Ejecutar en modo desarrollo
```bash
npm run dev
```

La aplicación se abrirá automáticamente en tu navegador predeterminado (puerto 1420).

---

## 🎯 Tu Primer Circuito

### Paso 1: Crear un circuito simple RC

1. **Selecciona componentes** desde la barra lateral izquierda:
   - 1x Resistor (R)
   - 1x Capacitor (C)
   - 1x Fuente de voltaje DC (VDC)
   - 1x Tierra (GND)

2. **Coloca los componentes** en el canvas haciendo clic o arrastrando.

3. **Conecta los componentes**:
   - Haz clic en un terminal y arrastra hasta otro terminal para crear un wire.
   - El enrutamiento inteligente creará ángulos de 90° automáticamente.

4. **Configura valores**:
   - Doble clic en cada componente para editar su valor.
   - Ejemplo: R = 1kΩ, C = 1µF, VDC = 5V.

### Paso 2: Configurar la simulación

1. Abre el panel de **Simulación** (ícono de gráfico en la barra superior).

2. Selecciona el tipo de análisis:
   - **TRAN** (Transient): Respuesta en el tiempo.
   - **DC**: Punto de operación.
   - **AC**: Barrido en frecuencia.

3. Configura parámetros para TRAN:
   - **Tiempo final:** 10ms
   - **Timestep:** 1µs (automático con adaptativo)

### Paso 3: Ejecutar y visualizar

1. Haz clic en **"Ejecutar Simulación"** (▶️).

2. El osciloscopio mostrará:
   - Canal A: Voltaje en el capacitor (carga exponencial).
   - Canal B: Corriente del circuito (decae exponencialmente).

3. **Exporta resultados**:
   - Botón "Exportar CSV" para datos numéricos.
   - Botón "Capturar PNG" para imagen del gráfico.

---

## ⌨️ Atajos de Teclado Esenciales

| Acción | Atajo |
|--------|-------|
| Deshacer | `Ctrl + Z` |
| Rehacer | `Ctrl + Y` |
| Rotar componente | `Espacio` |
| Eliminar selección | `Supr` / `Delete` |
| Copiar | `Ctrl + C` |
| Pegar | `Ctrl + V` |
| Zoom in | `Ctrl + +` |
| Zoom out | `Ctrl + -` |
| Ajustar vista | `Ctrl + 0` |
| Pausar simulación | `Espacio` (durante simulación) |

---

## 🔍 Solución de Problemas Comunes

### ❌ Error: "Missing ground reference"
**Causa:** Tu circuito no tiene una conexión a tierra (node "0").  
**Solución:** Agrega al menos un componente GND y conéctalo.

### ❌ Error: "Shorted voltage source"
**Causa:** Una fuente de voltaje tiene ambos terminales en el mismo nodo.  
**Solución:** Revisa las conexiones y asegúrate de que haya componentes entre nodos.

### ❌ La simulación no converge
**Causa:** Circuito con condiciones iniciales extremas o componentes no lineales.  
**Solución:** 
- Reduce el timestep.
- Habilita "Pseudo-transient analysis" en configuración avanzada.
- Verifica polaridades de diodos/transistores.

### ❌ Canvas lento o con lag
**Causa:** Muchos componentes (>500) o navegador antiguo.  
**Solución:**
- Usa Chrome/Edge/Firefox actualizado.
- Reduce la complejidad del circuito.
- Desactiva animaciones en configuración.

---

## 📚 Siguientes Pasos

Una vez domines lo básico, explora:

1. **Análisis avanzado:**
   - `.measure` para mediciones automáticas (RISETIME, PEAK, RMS).
   - Análisis PVT (Process-Voltage-Temperature).
   - Extracción de parámetros S (.sNp Touchstone).

2. **Co-simulación MCU:**
   - Carga firmware .hex para 8051 o AVR.
   - Observa registros y GPIO en tiempo real.
   - Depura con breakpoints y step-through.

3. **Componentes personalizados:**
   - Importa librerías SPICE (.lib, .subckt).
   - Crea tus propios subcircuitos.

4. **Automatización:**
   - Scripts de simulación por lotes.
   - Optimización paramétrica automática.

---

## 🆘 ¿Necesitas Ayuda?

- **Documentación completa:** Lee `README.md` en la raíz del proyecto.
- **Historial de cambios:** Consulta `CHANGELOG.md`.
- **Reportar bugs:** Abre un issue en GitHub.
- **Discusión:** Únete a las discusiones del repositorio.

---

*¡Feliz simulación! 🎉*
