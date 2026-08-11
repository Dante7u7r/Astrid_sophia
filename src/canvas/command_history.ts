export interface Command {
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
  private activeGroup: Command[] | null = null;
  private activeGroupLabel: string | null = null;

  constructor(options: CommandHistoryOptions = {}) {
    this.maxHistorySize = options.maxHistorySize ?? 200;
  }

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
    this.redoStack = [];
  }

  beginGroup(label: string): void {
    if (this.activeGroup) {
      this.endGroup();
    }
    this.activeGroup = [];
    this.activeGroupLabel = label;
  }

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

  peekUndoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  peekRedoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.activeGroup = null;
    this.activeGroupLabel = null;
  }
}

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
