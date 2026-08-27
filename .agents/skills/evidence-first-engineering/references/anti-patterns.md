# Anti-patrones y Errores Recurrentes en Astryd Sophia

Este documento registra los errores sistemáticos y discrepancias de razonamiento identificadas en el desarrollo de la aplicación, con el fin de evitar su reaparición.

---

## 1. Desfase de Serialización JS vs. Atributos HTML DOM

### El Error
Asumir que un elemento `<select>` de HTML encontrará una opción cuyo valor numérico fue escrito en notación decimal larga (p. ej. `<option value="0.00000001">`) cuando se le asigna el valor mediante `select.value = num.toString()`.

### Causa Técnica
En JavaScript, los números de punto flotante menores a $10^{-6}$ (e.g. `1e-8`) se convierten automáticamente a notación científica (`"1e-8"`). El motor DOM de HTML realiza una comparación estricta de igualdad de cadenas (`string equality`). Al asignar `"1e-8"`, el `<select>` busca exactamente el string `"1e-8"`; si solo existe `"0.00000001"`, no encuentra coincidencia y el selector se desconfigura o queda en blanco.

### Solución Obligatoria
1. Declarar siempre los atributos `value` en el HTML usando la representación canónica que produce `.toString()` en JS (`1e-8`, `2e-8`, `5e-8`, `0.000001`, `0.001`, `1`, `10`).
2. Utilizar funciones auxiliares de sincronización con tolerancia numérica de punto flotante (`syncTimeDivSelect`):
   ```ts
   public syncTimeDivSelect(val: number): void {
     if (!this.timeDivSelect) return;
     this.timeDivSelect.value = val.toString();
     if (this.timeDivSelect.selectedIndex === -1) {
       for (let i = 0; i < this.timeDivSelect.options.length; i++) {
         const optVal = parseFloat(this.timeDivSelect.options[i].value);
         if (Math.abs(optVal - val) <= Math.max(1e-12, val * 0.05)) {
           this.timeDivSelect.selectedIndex = i;
           break;
         }
       }
     }
   }
   ```

---

## 2. Doble Sufijo y Acumulación en Formateadores de Ingeniería

### El Error
Generar cadenas como `"1.00kkHz"`, `"16000.00kkHz"` o `"0.00 ms"` al formatear mediciones analógicas y frecuencias.

### Causa Técnica
Concatenar variables intermedias donde una parte ya calculó un prefijo (`freqStr = "${(f / 1000).toFixed(2)}k"`) y otra variable le añade la unidad (`freqUnit = "kHz"`), resultando en `freqStr + freqUnit` = `"1.00kkHz"`.

### Solución Obligatoria
Usar funciones puras y unificadas de formateo con umbrales mutuamente excluyentes:
```ts
export function formatFrequency(freq: number): string {
  if (!Number.isFinite(freq) || freq <= 0) return "--";
  if (freq >= 1e9) return `${(freq / 1e9).toFixed(2)} GHz`;
  if (freq >= 1e6) return `${(freq / 1e6).toFixed(2)} MHz`;
  if (freq >= 1e3) return `${(freq / 1e3).toFixed(2)} kHz`;
  return `${freq.toFixed(1)} Hz`;
}
```

---

## 3. Dependencia de Métricas de Layout en Entornos Headless (`Happy-DOM`)

### El Error
Condicionar la ejecución de métodos críticos de renderizado o telemetría a llamadas geométricas del navegador real como `getClientRects().length > 0` o `clientWidth > 0`.

### Causa Técnica
En entornos de pruebas automatizadas con `happy-dom` o `jsdom`, no existe un motor de renderizado CSS completo. `getClientRects()` retorna arrays vacíos por defecto y `canvas.getContext("2d")` es `null` salvo que se proporcione un mock.

### Solución Obligatoria
1. En el código de producción, combinar comprobaciones de layout con validación de dimensiones lógicas del canvas:
   ```ts
   private isCanvasVisible(): boolean {
     if (!this.oscCanvas?.isConnected) return false;
     const dock = this.oscCanvas.closest("#bottom-dock");
     if (dock?.classList.contains("collapsed")) return false;
     if (this.oscCanvas.clientWidth > 0 && this.oscCanvas.clientHeight > 0) return true;
     if (this.oscCanvas.width > 0 && this.oscCanvas.height > 0) return true;
     return this.oscCanvas.getClientRects().length > 0;
   }
   ```
2. En las pruebas unitarias (`*.test.ts`), inicializar siempre el mock de `getContext("2d")` en `beforeEach`:
   ```ts
   HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
     fillRect: vi.fn(),
     beginPath: vi.fn(),
     moveTo: vi.fn(),
     lineTo: vi.fn(),
     stroke: vi.fn(),
     fill: vi.fn(),
     fillText: vi.fn(),
     measureText: vi.fn(() => ({ width: 50 })),
     save: vi.fn(),
     restore: vi.fn(),
   })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
   ```

---

## 4. Extensión Parcial de Rangos Físicos

### El Error
Ampliar la escala de un instrumento en el modelo o en un selector (por ejemplo, permitir tiempos de $10\text{ ns}$ a $10\text{ s}$), pero olvidar actualizar las capas de visualización, cursores o algoritmos de auto-ajuste dependientes.

### Causa Técnica
Modificar el array de constantes sin hacer una búsqueda global (`rg`) de todos los consumidores de la variable.

### Solución Obligatoria
Siempre que se altere un rango dinámico o físico:
1. Auditar algoritmos de disparo (`findTriggerStartIndex`, `autoFit`).
2. Auditar la capa visual (`drawOscilloscopeCursors`, `drawTyReticle`).
3. Auditar telemetría y exportación (.meas, CSV, JSON).
4. Añadir casos de prueba que cubran explícitamente los valores mínimos y máximos de la nueva escala.
