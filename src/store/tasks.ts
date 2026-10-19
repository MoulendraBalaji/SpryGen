import { create } from "zustand";
import { bridgeAvailable, sprygen } from "../lib/sprygen";
import { Task } from "../../shared/types";

interface TasksState {
  tasks: Task[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (title: string, dueAt?: number | null) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useTasks = create<TasksState>((set, get) => ({
  tasks: [],
  loaded: false,
  load: async () => {
    const tasks = (await sprygen.tasks.list()) as Task[];
    set({ tasks, loaded: true });
  },
  create: async (title, dueAt = null) => {
    await sprygen.tasks.create({ title, dueAt, source: "manual", completed: false });
    await get().load();
  },
  toggle: async (id) => {
    const t = get().tasks.find((x) => x.id === id);
    if (!t) return;
    await sprygen.tasks.update(id, { completed: !t.completed });
    await get().load();
  },
  remove: async (id) => {
    await sprygen.tasks.remove(id);
    await get().load();
  }
}));

// Chat-applied actions (e.g. "todo: buy milk") and companion quick-capture both
// emit `tasks:update`; refresh the board so the UI stays in sync.
if (bridgeAvailable()) {
  sprygen.onEvent("tasks:update", () => {
    useTasks.getState().load();
  });
}
