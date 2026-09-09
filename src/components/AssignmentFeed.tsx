import React, { useEffect, useState } from "react";
import { ClayCard } from "../design-system";
import { sprygen } from "../lib/sprygen";
import { Assignment } from "../../shared/types";

export function AssignmentFeed() {
  const [items, setItems] = useState<Assignment[]>([]);

  useEffect(() => {
    const load = async () => {
      const raw = (await sprygen.briefing.generate()) as any[];
      setItems(
        raw
          .filter((r) => r.kind === "assignment")
          .map((r) => ({ id: r.title, course: "", title: r.title, dueAt: r.dueAt, link: "", state: "", syncedAt: 0 }))
      );
    };
    load();
  }, []);

  return (
    <ClayCard eyebrow="03 · Coursework">
      {items.length === 0 ? (
        <p className="console-meta" style={{ margin: 0 }}>
          Connect Google Classroom in Sources to load live coursework.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {items.map((a) => (
            <div key={a.id} className="console-row">
              <span style={{ flex: 1, fontSize: 12 }}>{a.title}</span>
              {a.dueAt && <span className="console-count">due {new Date(a.dueAt).toLocaleDateString()}</span>}
            </div>
          ))}
        </div>
      )}
    </ClayCard>
  );
}