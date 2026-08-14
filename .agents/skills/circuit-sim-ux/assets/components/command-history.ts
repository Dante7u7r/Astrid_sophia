/**
 * command-history.ts
 *
 * Patrón Command para undo/redo. Ver references/selection-history-shortcuts.md,
 * sección "Undo/Redo: arquitectura, no solo atajo de teclado" — especialmente
 * por qué snapshot-completo-de-estado es la opción equivocada y por qué
 * agrupar acciones continuas (drag) en una sola entrada de historial importa.
 *
 * Desacoplado de React: es lógica de aplicación pura, se puede envolver
 * en un hook (useCommandHistory) o un store (zustand/redux) según el
 * stack del proyecto — no asumimos cuál usas.
 */

export interface Command {
  /** Etiqueta legible para debug/UI (ej. mostrar "Deshacer: Mover R1" en un menú). */
  label: string;
  execute(): void;
  undo(): void;
}

export interface CommandHistoryOptions {
  maxHistorySize?: number;
}

export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly maxHistorySize: number;

  // Soporte para agrupar una secuencia de mutaciones continuas (ej. drag)
  // en un solo Command. Ver beginGroup/endGroup más abajo.
  private activeGroup: Command[] | null = null;
  private activeGroupLabel: string | null = null;

  constructor(options: CommandHistoryOptions = {}) {
    this.maxHistorySize = options.maxHistorySize ?? 200;
  }

  /**
   * Ejecuta un comando y lo registra en el historial. Si hay un grupo
   * activo (ver beginGroup), se añade al grupo en vez de al historial
   * directamente — el grupo completo se compacta en un solo Command
   * al llamar endGroup().
   */
  execute(command: Command): void {
    command.execute();

    if (this.activeGroup) {
      this.activeGroup.push(command);
      return;
    }

    this.pushToHistory(command);
  }

  private pushToHistory(command: Command): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }
    // Cualquier nueva acción invalida la pila de redo — comportamiento
    // estándar en todo editor (deshacer, luego hacer algo nuevo, pierde
    // la rama de "rehacer" anterior).
    this.redoStack = [];
  }

  /**
   * Inicia un grupo de comandos que se tratarán como una sola entrada
   * de undo/redo al cerrarse. Caso de uso típico: drag-start de un
   * componente. Cada evento de movimiento durante el drag llama
   * execute() con un MoveCommand de delta pequeño; al soltar el mouse
   * (drag-end) se llama endGroup(), que compacta todo el grupo en un
   * único Command compuesto.
   */
  beginGroup(label: string): void {
    if (this.activeGroup) {
      // Grupo anidado no soportado — cerramos el anterior primero para
      // evitar estado inconsistente silencioso.
      this.endGroup();
    }
    this.activeGroup = [];
    this.activeGroupLabel = label;
  }

  /**
   * Cierra el grupo activo y lo compacta en un único Command compuesto
   * que se añade al historial real. Si el grupo terminó vacío (ej. el
   * usuario inició un drag pero soltó sin mover nada), no se añade nada
   * al historial — evita entradas de undo vacías/no-op.
   */
  endGroup(): void {
    if (!this.activeGroup) return;
    const commands = this.activeGroup;
    const label = this.activeGroupLabel ?? "Grupo de acciones";
    this.activeGroup = null;
    this.activeGroupLabel = null;

    if (commands.length === 0) return;

    const composite: Command = {
      label,
      execute: () => {
        for (const cmd of commands) cmd.execute();
      },
      undo: () => {
        // Undo en orden inverso — crítico si los comandos del grupo
        // tienen dependencias entre sí (ej. mover A, luego mover B
        // relativo a la nueva posición de A).
        for (let i = commands.length - 1; i >= 0; i--) {
          commands[i].undo();
        }
      },
    };

    this.pushToHistory(composite);
  }

  undo(): void {
    const command = this.undoStack.pop();
    if (!command) return;
    command.undo();
    this.redoStack.push(command);
  }

  redo(): void {
    const command = this.redoStack.pop();
    if (!command) return;
    command.execute();
    this.undoStack.push(command);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Etiqueta de la próxima acción a deshacer, para mostrar en UI (ej. "Deshacer: Mover R1"). */
  peekUndoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  peekRedoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  /**
   * Limpia todo el historial. DEBE llamarse al cargar un nuevo proyecto
   * — ver anti-patrón "pila de undo que no se limpia al cargar un nuevo
   * proyecto" en el reference doc. Olvidar esta llamada es el bug más
   * fácil de introducir y más confuso de diagnosticar de todo este módulo.
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.activeGroup = null;
    this.activeGroupLabel = null;
  }
}

// ---------------------------------------------------------------------
// Ejemplo de Commands concretos para las acciones más comunes de un
// editor de esquemáticos. ComponentStore es deliberadamente genérico
// (no importa ComponentInstance de tu canvas_orchestrator.ts) para que
// este archivo compile standalone — en tu integración real, implementas
// ComponentStore como un adaptador delgado sobre tu estado real:
//
//   const store: ComponentStore = {
//     getPosition: (id) => components.find(c => c.id === id)!.position,
//     setPosition: (id, pos) => updateComponent(id, { position: pos }),
//     getValue: (id) => components.find(c => c.id === id)!.value,
//     setValue: (id, v) => updateComponent(id, { value: v }),
//   };
//
// donde `components`/`updateComponent` son tu estado real de
// canvas_orchestrator.ts. El undo/redo nunca necesita conocer
// ComponentInstance directamente — solo necesita poder leer/escribir
// posición y valor a través de esta interfaz mínima.
// ---------------------------------------------------------------------

export interface Position {
  x: number;
  y: number;
}

export interface ComponentStore {
  getPosition(componentId: string): Position;
  setPosition(componentId: string, position: Position): void;
  getValue(componentId: string): string;
  setValue(componentId: string, value: string): void;
}

export function createMoveCommand(
  store: ComponentStore,
  componentId: string,
  from: Position,
  to: Position
): Command {
  return {
    label: `Mover ${componentId}`,
    execute: () => store.setPosition(componentId, to),
    undo: () => store.setPosition(componentId, from),
  };
}

export function createEditValueCommand(
  store: ComponentStore,
  componentId: string,
  fromValue: string,
  toValue: string
): Command {
  return {
    label: `Editar valor de ${componentId}`,
    execute: () => store.setValue(componentId, toValue),
    undo: () => store.setValue(componentId, fromValue),
  };
}

/**
 * Construye un Command compuesto para mover múltiples componentes a la
 * vez (drag de selección múltiple) — ver "Operaciones batch sobre
 * selección múltiple" en el reference doc. Útil cuando NO estás dentro
 * de un beginGroup/endGroup de eventos continuos, sino que ya tienes
 * el delta final calculado de antemano (ej. mover selección con flechas
 * de teclado, donde cada pulsación sí es una sola entrada de historial
 * legítima, no un drag continuo).
 */
export function createBatchMoveCommand(
  store: ComponentStore,
  moves: Array<{ componentId: string; from: Position; to: Position }>
): Command {
  return {
    label: `Mover ${moves.length} componentes`,
    execute: () => {
      for (const move of moves) store.setPosition(move.componentId, move.to);
    },
    undo: () => {
      for (const move of moves) store.setPosition(move.componentId, move.from);
    },
  };
}
