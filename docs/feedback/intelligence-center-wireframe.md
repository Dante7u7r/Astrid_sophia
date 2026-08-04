# Wireframe — Centro de inteligencia

## Entrada principal

Nueva pestaña dentro del centro de instrumentos: `Inteligencia`.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Inteligencia                    Local ●      42 ejecuciones    ⚙     │
├──────────────┬───────────────────────────────────────────────────────┤
│ Resumen      │ Salud de simulación                                  │
│ Ejecuciones  │  Éxito 95%   Fallos 2   p95 38 ms   Datos 12.4 MB    │
│ Sugerencias  │                                                       │
│ Validación   │ Recomendaciones activas                              │
│ Mis datos    │ ┌───────────────────────────────────────────────────┐ │
│              │ │ Paso temporal alto para la constante RC mínima   │ │
│              │ │ Evidencia: dt/τmin = 0.42   Confianza: 0.96      │ │
│              │ │ [Ver evidencia] [Aplicar] [No es útil]           │ │
│              │ └───────────────────────────────────────────────────┘ │
│              │                                                       │
│              │ Cambios desde 0.1.0                                  │
│              │  ✓ menos fallos de convergencia                      │
│              │  ! PSS continúa experimental                         │
└──────────────┴───────────────────────────────────────────────────────┘
```

## Ejecución

```text
┌─ Transitorio · 2026-07-30 20:04 ────────────────────────────────────┐
│ Estado: completado       Duración: 41.2 ms       Puntos: 5 000      │
│ Método: TRAP             Iteraciones: 18          Rechazos: 2        │
│ ERC: correcto            Residuo final: 2.1e-10                      │
├─────────────────────────────────────────────────────────────────────┤
│ Línea de tiempo: Inicio ─ ERC ─ Estampado ─ Newton ─ Resultado       │
│                                                                      │
│ [Comparar] [Marcar resultado] [Crear paquete de soporte]             │
└──────────────────────────────────────────────────────────────────────┘
```

## Feedback humano

```text
¿El resultado fue útil y físicamente plausible?
( ) Correcto   ( ) Dudoso   ( ) Incorrecto

Categoría: [Modelo ▼]
Valor esperado: [          ]  Unidad: [V ▼]
Comentario opcional: [                                      ]
[ ] Incluir una copia redactada del circuito

[Cancelar]                                      [Guardar feedback]
```

El comentario no entra en telemetría operativa. Se guarda como contenido de
usuario y requiere consentimiento visible.

## Mis datos

```text
Modo: [Local ▼]
Uso: 12.4 MB de 250 MB          Retención: 90 días

Operational       8 420 eventos
Circuit-derived     184 eventos
User-content          3 eventos
Adjuntos              1 archivo

[Ver eventos] [Exportar paquete] [Borrar vencidos] [Eliminar todo]
```

## Accesibilidad

- orden de foco estable;
- no depender sólo del color;
- `aria-live` para final de exportación y borrado;
- tablas con encabezados;
- detalle de recomendación accesible antes de aplicar;
- Escape cierra diálogos sin perder el formulario accidentalmente;
- confirmación escrita para `Eliminar todo`;
- gráficos con resumen textual equivalente;
- preferencias de movimiento reducido respetadas.

## Estados obligatorios

- feedback desactivado;
- base vacía;
- cargando;
- datos disponibles;
- cuota próxima;
- base dañada y aislada;
- migración fallida;
- exportación en progreso;
- consentimiento revocado;
- aprendizaje en sombra;
- asesor desactivado por kill switch.
