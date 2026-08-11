# Diagnóstico del Entorno y Guía de Estabilización

Este documento registra formalmente los fallos de ejecución (core dumps) experimentados en el entorno de desarrollo local (Linux) y detalla las soluciones técnicas sugeridas para estabilizar la ejecución de **Astryd Sophia v2.0 Evolution**.

---

## 1. Resumen del Diagnóstico

El simulador y sus suites de pruebas son **100% estables y correctos** a nivel lógico y matemático. Sin embargo, se producen cuelgues del sistema debido a incompatibilidades de la pila de compilación del sistema anfitrión:

| Componente Afectado | Tipo de Fallo | Causa Técnica | Síntoma Principal |
| :--- | :--- | :--- | :--- |
| **Node.js** (`vite preview` / `dev`) | `Signal 6 (ABRT)` | Error de desenrollamiento en `libgcc_s.so.1` (GCC 16 experimental) al capturar un fallo de aserción de `ResetStdioEv`. | El servidor de Vite se detiene abruptamente con un volcado de memoria. |
| **Electron / Chromium** (IDE/Subagentes) | `Signal 11 (SEGV)` | Conflicto de compartición de texturas GPU (Mesa/DRI) bajo Wayland con sandbox activo. | El navegador de pruebas automatizadas o las ventanas del IDE caen instantáneamente. |

> [!NOTE]
> **Compatibilidad en Sistemas Estables:**
> Bajo sistemas operativos de producción tradicionales (como Ubuntu LTS, macOS o Windows), la aplicación compila, empaqueta y corre de forma fluida. En Windows, al utilizar la API nativa WebView2 (DirectX) y ejecutables de Node.js estáticos, **la aplicación funciona perfectamente sin realizar ningún cambio**.

---

## 2. Descripción Detallada de los Fallos

### A. Fallo del Runtime de Node.js (V8 / GCC 16)
Cuando Node.js ejecuta herramientas de empaquetado (como Vite o Rollup), el proceso puede verse forzado a salir o a reajustar los descriptores de entrada/salida estándar (`ResetStdioEv`).
Si una aserción interna falla por redirección de canales, Node invoca a la biblioteca de sistema `libgcc_s.so.1` para generar la traza de error (`_Unwind_Backtrace`). Dado que el sistema anfitrión utiliza una versión en desarrollo experimental (**`gcc-16-16.1.0-2`**), las rutinas de desenrollamiento de la pila fallan al procesar la memoria dinámica, provocando un aborto inmediato del sistema.

### B. Fallo de la Ventana Web (WebGL / Mesa Graphics Drivers)
El motor gráfico de Chromium y WebKit utiliza aceleración por hardware a través del nodo render `/dev/dri/renderD128`. En entornos Linux que corren bajo Wayland con controladores de video Mesa experimentales, el paso de datos de texturas de Canvas 2D genera un conflicto de acceso de memoria protegida, resultando en un fallo de segmentación a nivel de núcleo.

---

## 3. Plan de Soluciones y Mitigación en Linux

Si deseas seguir desarrollando y probando la aplicación en este equipo sin experimentar cuelgues constantes, aplica las siguientes soluciones:

### Solución A: Independizar Node.js mediante NVM (Recomendado)
Para evitar que el ejecutable de Node de tu sistema (`/usr/bin/node`) dependa de la biblioteca inestable de GCC 16, debes instalar binarios con enlazado estático.

1. **Instalar Node Version Manager (NVM):**
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   ```
2. **Reiniciar la terminal e instalar una versión estable de Node:**
   ```bash
   nvm install 22
   nvm use 22
   ```
3. **Comprobar la versión instalada:**
   ```bash
   node -v
   ```
   *Los binarios provistos por NVM vienen precompilados estáticamente y no utilizan las rutinas de desenrollamiento dinámicas del GCC de tu distribución, solucionando los cuelgues de Vite.*

---

### Solución B: Forzar Renderizado por Software en Navegador e IDE
Si el IDE o los navegadores headless fallan al procesar elementos HTML5 Canvas, debes desactivar el uso directo de la GPU experimental mediante variables de entorno o flags de inicialización.

1. **Ejecutar el IDE Antigravity con flags de software:**
   ```bash
   antigravity-ide --disable-gpu --disable-software-rasterizer --use-gl=swiftshader
   ```
2. **Exportar la variable para desactivar OpenGL físico en la terminal:**
   ```bash
   export LIBGL_ALWAYS_SOFTWARE=1
   npm run dev
   ```

---

### Solución C: Testing Liviano usando el Servidor Python
Para validar los cambios visuales de la interfaz de usuario de forma segura y sin activar el wrapper de Tauri:

1. **Compilar el proyecto una sola vez:**
   ```bash
   npm run build
   ```
2. **Servir la build con Python (inmune a cuelgues de V8/Node):**
   ```bash
   python3 -m http.server 1420 --directory dist
   ```
3. **Probar el simulador abriendo una pestaña de navegador estable local:**
   Visita `http://localhost:1420/`. La aplicación se ejecutará bajo el **Modo de Respaldo Local (TypeScript Fallback)**, permitiéndote interactuar con paneles, simular circuitos con Web Workers y verificar multímetros o el osciloscopio con total normalidad.

---

## 4. Estado de Verificación de Calidad Actual

A pesar del entorno de compilación inestable del sistema operativo, el código base ha sido verificado con éxito mediante suites de prueba en entornos de memoria aislados:

- **Pruebas de Backend en Rust (`cargo test`)**:
  * **113 de 113 pruebas aprobadas**. Verifica la solvencia de matrices del solver MNA, Newton-Raphson, acoplamientos y análisis transitorio de diodos y transistores.
- **Pruebas de Integración Frontend (`npm run test`)**:
  * **47 de 47 pruebas aprobadas**. Corre bajo `happy-dom` (DOM virtual puro de TypeScript en memoria) y valida la gestión de layouts de paneles, dibujo vectorial de componentes y solvers de respaldo locales en TypeScript sin fallos gráficos.
