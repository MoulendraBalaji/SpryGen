import cron from "node-cron";
import { dbLayer } from "./db";

export function startReminders(notify: (title: string, body: string) => void) {
  cron.schedule("* * * * *", () => {
    const now = Date.now();
    const tasks = dbLayer.all("tasks") as any[];
    for (const t of tasks) {
      if (t.completed) continue;
      const due = t.dueAt ? Number(t.dueAt) : null;
      if (due && due > now - 60000 && due <= now + 60000) {
        notify("SPRYGEN Reminder", t.title);
      }
    }
  });
}
