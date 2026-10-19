import { describe, it, expect } from "vitest";
import { makeBridge, installBridge } from "./helpers";

describe("tasks store", () => {
  it("loads, creates, toggles and removes tasks via the bridge", async () => {
    const bridge = makeBridge();
    bridge.tasks.list.mockResolvedValue([
      { id: "t1", title: "Write tests", completed: false, dueAt: null, source: "manual", createdAt: 1 },
    ]);
    installBridge(bridge);

    const { useTasks } = await import("../src/store/tasks");

    // Load.
    await useTasks.getState().load();
    expect(useTasks.getState().tasks).toHaveLength(1);
    expect(bridge.tasks.list).toHaveBeenCalledTimes(1);

    // Create.
    bridge.tasks.list.mockResolvedValueOnce([
      { id: "t1", title: "Write tests", completed: false, dueAt: null, source: "manual", createdAt: 1 },
      { id: "t2", title: "Buy milk", completed: false, dueAt: null, source: "manual", createdAt: 2 },
    ]);
    await useTasks.getState().create("Buy milk");
    expect(bridge.tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Buy milk", source: "manual", completed: false, dueAt: null })
    );
    expect(useTasks.getState().tasks).toHaveLength(2);

    // Toggle.
    bridge.tasks.list.mockResolvedValueOnce([
      { id: "t1", title: "Write tests", completed: true, dueAt: null, source: "manual", createdAt: 1 },
      { id: "t2", title: "Buy milk", completed: false, dueAt: null, source: "manual", createdAt: 2 },
    ]);
    await useTasks.getState().toggle("t1");
    expect(bridge.tasks.update).toHaveBeenCalledWith("t1", expect.objectContaining({ completed: true }));

    // Remove.
    bridge.tasks.list.mockResolvedValueOnce([
      { id: "t2", title: "Buy milk", completed: false, dueAt: null, source: "manual", createdAt: 2 },
    ]);
    await useTasks.getState().remove("t2");
    expect(bridge.tasks.remove).toHaveBeenCalledWith("t2");
    expect(useTasks.getState().tasks).toHaveLength(1);
  });

  it("does not toggle when the task is not found", async () => {
    const bridge = makeBridge();
    bridge.tasks.list.mockResolvedValue([]);
    installBridge(bridge);

    const { useTasks } = await import("../src/store/tasks");
    await useTasks.getState().load();
    await useTasks.getState().toggle("missing");

    expect(bridge.tasks.update).not.toHaveBeenCalled();
  });
});
