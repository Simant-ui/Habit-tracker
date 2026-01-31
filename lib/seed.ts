import type { Habit } from "./types";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function commonHabitsSeed(): Habit[] {
  const now = Date.now();
  const titles = [
    "Drink Water",
    "Exercise",
    "Read Book",
    "Meditation",
    "Wake Up Early",
    "No Junk Food",
    "Study / Skill Practice",
    "Sleep before 11"
  ];

  return titles.map((t) => ({
    id: slugify(t),
    title: t,
    category: "common",
    targetType: "daily",
    targetValue: 1,
    active: true,
    createdAt: now
  }));
}
