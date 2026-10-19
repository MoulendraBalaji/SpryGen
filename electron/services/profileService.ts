import { dbLayer } from "./db";
import { UserProfile } from "../../shared/types";

const DEFAULT_PROFILE: UserProfile = {
  activeHours: { start: 9, end: 22 },
  phrasingStyle: "concise",
  recurringCategories: ["Work", "Study", "Personal"],
  learnedFacts: [],
  summary: ""
};

export const profileService = {
  get(): UserProfile {
    const rows = dbLayer.all("profile") as any[];
    const map: Record<string, string> = {};
    rows.forEach((r) => (map[r.key] = r.value));
    if (!rows.length) return DEFAULT_PROFILE;
    return {
      ...DEFAULT_PROFILE,
      ...(map.profile ? JSON.parse(map.profile) : {})
    };
  },

  set(patch: Partial<UserProfile>): UserProfile {
    const current = this.get();
    const next = { ...current, ...patch } as UserProfile;
    dbLayer.upsert("profile", { id: "profile", key: "profile", value: JSON.stringify(next) });
    return next;
  },

  addFact(key: string, value: string): UserProfile {
    const current = this.get();
    const learnedFacts = current.learnedFacts.filter((f: { key: string }) => f.key !== key);
    learnedFacts.push({ key, value, updatedAt: Date.now() });
    return this.set({ learnedFacts });
  },

  deleteFact(key: string): UserProfile {
    const current = this.get();
    current.learnedFacts = current.learnedFacts.filter((f: { key: string }) => f.key !== key);
    return this.set({ learnedFacts: current.learnedFacts });
  }
};
