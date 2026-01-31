export type UserProfile = {
  name: string | null;
  email: string | null;
  photoURL: string | null;
  createdAt: number;     // ms
  lastLoginAt: number;   // ms
};

export type HabitCategory = "common" | "custom";
export type TargetType = "daily" | "weekly";

export type Habit = {
  id: string;
  title: string;
  category: HabitCategory;
  targetType: TargetType;
  targetValue: number; // if > 1 numeric tracking, else checkbox
  active: boolean;
  createdAt: number;
};

export type HabitStatus = {
  status: "done" | "skip" | "none";
  count: number; // numeric progress
};

export type DayLog = {
  dateString: string; // yyyy-mm-dd
  updatedAt: number;
  habitStatus: Record<string, HabitStatus>;
  mood?: "happy" | "angry" | "rest";
  note?: string;
};
