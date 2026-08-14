# Component Inspector

Panel de propiedades para editar parámetros de componentes (resistencia, capacitancia, valores de fuentes, modelos SPICE de semiconductores) — validación en tiempo real y manejo de unidades.

## El problema específico de este dominio: notación de ingeniería

Un usuario de electrónica no escribe "0.000001" en un campo de capacitancia. Escribe `1u`, `1uF`, `1µF`, o a veces `1e-6`. Tu inspector debe parsear **todas** estas formas como entrada válida, y mostrar la convención que el ecosistema SPICE usa de vuelta (notación de letra, sin necesitar el símbolo µ que es molesto de teclear).

Tabla de sufijos SPICE estándar (esto es universal en LTspice/KiCad/ngspice — no es opcional soportarlo, es lo que el usuario asume que funciona):

| Sufijo | Multiplicador | Ejemplo |
|---|---|---|
| `T` | 1e12 | — |
| `G` | 1e9 | — |
| `Meg` | 1e6 | `1Meg` = 1MΩ (nota: `M` sola es **mili**, no mega — error clásico) |
| `k` | 1e3 | `4.7k` |
| (ninguno) | 1 | `100` |
| `m` | 1e-3 | `10m` |
| `u` o `µ` | 1e-6 | `1u` |
| `n` | 1e-9 | `100n` |
| `p` | 1e-12 | `22p` |
| `f` | 1e-15 | — |

**El error más común al implementar esto**: tratar `M` como mega por intuición de prefijos SI. En la convención SPICE (heredada de SPICE original de Berkeley, y que LTspice/ngspice mantienen por compatibilidad), `M` sola es ambigua/no estándar y `Meg` es mega; muchas implementaciones interpretan `M` como mili para evitar el choque. Si tu parser no replica esto exactamente, un usuario que pega un valor de un netlist SPICE existente (algo que hará, porque viene de otra herramienta) obtendrá un valor 1,000,000x incorrecto sin ningún error visible — esto es el tipo de bug silencioso más peligroso posible en un simulador, porque el usuario confía en el resultado de la simulación sin saber que el dato de entrada ya estaba mal.

Ver implementación de parser completo en `assets/components/spice-value-parser.ts`.

## Validación en tiempo real: cuándo y cómo

- **Validar mientras se escribe, pero no bloquear el campo.** El usuario debe poder escribir `4` y luego `.7k` sin que el campo rechace `4` por no ser un valor completo todavía. Valida el string completo en cada keystroke, pero solo muestra error visual cuando el campo pierde foco (`onBlur`) o tras una pausa breve (debounce ~400-600ms) — no en cada tecla, eso se siente hostil.
- **Distingue "incompleto" de "inválido"**: `4.7` mientras el usuario sigue escribiendo `4.7k` es incompleto-pero-en-camino-a-válido (sin sufijo, se trataría como ohms/faradios/etc. directos, que es válido per se) — no marques error. `4.7x` con un sufijo que no existe en la tabla es inválido — marca error inmediatamente, no esperes a blur, porque `x` nunca se va a convertir en un sufijo válido con más tecleo.
- **Rangos físicamente imposibles** (resistencia negativa, capacitancia de 0F en un contexto donde eso rompería la simulación) deben marcarse, pero con criterio: algunos componentes sí aceptan valores negativos legítimamente (fuentes de voltaje/corriente, ganancia de fuentes dependientes) — el inspector necesita metadata por tipo de componente sobre qué rangos son válidos, no una regla global "no negativos".

## Unidades mostradas vs. unidades almacenadas

Almacena internamente siempre en unidades base SI (ohms, faradios, henrios, voltios, amperios — sin multiplicador), nunca en la unidad que el usuario tecleó. Esto evita una clase entera de bugs de conversión acumulada y hace que tu motor de simulación (MNA solver) reciba siempre valores consistentes sin tener que parsear sufijos en la capa de cálculo. El sufijo es puramente de presentación: se aplica al formatear para mostrar, se parsea al aceptar input, y desaparece en el modelo de datos.

Al **mostrar** un valor de vuelta (ej. el usuario abre el inspector de un componente ya colocado), reformatea al sufijo "natural" más legible — `0.0000047` almacenado se muestra como `4.7u`, no como el número crudo ni forzado siempre a notación científica. Ver `formatSpiceValue` en el mismo archivo de parser.

## Edición batch / multi-componente

Cuando el usuario selecciona múltiples componentes del mismo tipo (ver doc de selección) y abre el inspector, el comportamiento esperado por usuarios EDA:

- Si todos comparten el mismo valor para un campo → mostrar ese valor.
- Si difieren → mostrar el campo vacío o con un placeholder tipo "(valores mixtos)", **nunca** mostrar el valor de uno arbitrario de ellos como si fuera el de todos (esto ha causado ediciones accidentales masivas en herramientas mal hechas: el usuario ve "10k" pensando que es el valor de un componente, lo cambia a "4.7k" sin notar que aplicó el cambio a 8 resistencias distintas que tenían valores distintos).
- Editar un campo en modo multi-selección aplica el nuevo valor a todos los seleccionados — esto es correcto y esperado, la prevención de error está en mostrar "(mixed)" antes de editar, no en prohibir la edición batch.

## Anti-patrones específicos de este dominio

- **Inputs tipo `<input type="number">` nativos del navegador** para campos de valor de componente — estos rechazan o se comportan raro con notación de sufijo (`4.7k` no es un `number` válido de HTML, y el spinner de incremento/decremento del input nativo no tiene sentido en pasos de notación de ingeniería). Usa `<input type="text">` con tu propio parser/validador.
- **Reformatear el valor mientras el usuario todavía está escribiendo** (ej. el usuario teclea `4` y el campo se autocompleta a `4.0` o similar en cada keystroke) — esto mueve el cursor y rompe la experiencia de tecleo. Reformatea solo en blur, nunca durante edición activa.
- **Mostrar todos los parámetros de un modelo SPICE complejo (ej. un transistor con 40+ parámetros) en una sola lista plana sin jerarquía** — agrupa por categoría (parámetros básicos vs. avanzados/modelo térmico/etc.) con una sección "avanzado" colapsada por default; el usuario promedio edita 2-3 parámetros, no 40.
