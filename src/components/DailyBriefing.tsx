import React, { useEffect, useState } from "react";
import { ClayCard, ClayButton } from "../design-system";
import { sprygen } from "../lib/sprygen";
import { BriefingItem } from "../../shared/types";

export function DailyBriefing() {
  const [items, setItems] = useState<BriefingItem[]>([]);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    const res = (await sprygen.briefing.generate()) as BriefingItem[];
    setItems(res);
    setLoading(false);
  };

  useEffect(() => {
    generate();
  }, []);

  return (
    <ClayCard large eyebrow="02 · Daily Briefing">
      <div className="console-row" style={{ justifyContent: "space-between" }}>
        <span className="console-meta">{items.length} items · {new Date().toLocaleDateString()}</span>
        <ClayButton variant="ghost" onClick={generate} disabled={loading}>
          {loading ? "refreshing" : "Regenerate"}
        </ClayButton>
      </div>
      {items.length === 0 ? (
        <p className="console-meta" style={{ margin: "10px 0 0" }}>
          Nothing queued yet. Add tasks or connect Classroom to build your morning summary.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {items.map((i, idx) => (
            <div key={idx} className="console-row">
              <span className="console-meta">{i.kind === "assignment" ? "CLS" : "TASK"}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{i.title}</span>
              {i.dueAt && <span className="console-count">{new Date(i.dueAt).toLocaleDateString()}</span>}
            </div>
          ))}
        </div>
      )}
    </ClayCard>
  );
}