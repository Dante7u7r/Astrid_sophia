# Migración completa de skills: OpenCode + Antigravity

El paquete contiene las diez skills de Astryd Sophia, con sus referencias y ejemplos, en la ruta estándar `.agents/skills`. Antigravity y OpenCode las descubren desde ahí al abrir la raíz del proyecto.

## Instalación segura en la laptop

1. Cierra OpenCode y Antigravity para este proyecto.
2. En la raíz del clon de `Astrid_sophia` (donde están `package.json` y `AGENTS.md`), **renombra** la carpeta antigua en lugar de borrarla inicialmente:

   ```powershell
   Rename-Item -LiteralPath .opencode -NewName .opencode.respaldo
   ```

   `.opencode` contiene solo las skills antiguas, según el paquete de origen. El respaldo es reversible y queda fuera de las rutas que los agentes buscan automáticamente.

3. Extrae el ZIP directamente en esa raíz. Debe quedar:

   ```text
   Astrid_sophia/.agents/skills/evidence-first-engineering/SKILL.md
   Astrid_sophia/.agents/skills/realtime-cosimulation-runtime/SKILL.md
   ```

4. Actualiza `opencode.json`: elimina únicamente la propiedad `skills` que apunta a `.opencode/skills`. Conserva todas las demás propiedades que existan en tu versión local. Si el archivo aún es igual al del paquete de origen, quedará así:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "instructions": ["AGENTS.md"]
   }
   ```

5. Abre `Astrid_sophia` como carpeta raíz. Antigravity y OpenCode detectarán `.agents/skills` automáticamente.

6. Cuando confirmes que las skills aparecen, puedes conservar `.opencode.respaldo` hasta el próximo commit. No copies sus subcarpetas dentro de `.agents/skills`, porque duplicarías IDs de skills.

## Regla global recomendada

No reemplaces el `AGENTS.md` de la laptop. Para hacer obligatoria la validación basada en evidencia, añade esta línea al `AGENTS.md` que ya tengas:

```markdown
Antes de responder o editar de forma sustantiva, cargar y aplicar `.agents/skills/evidence-first-engineering/SKILL.md`.
```

## Efecto en Git

Esta migración no modifica código fuente ni usa `git pull`. Sí cambia archivos de configuración: Git mostrará la eliminación de `.opencode/` y la adición de `.agents/`. Haz commit de esa migración solo después de verificar que ambos agentes cargan las skills correctamente.
