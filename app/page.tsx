
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createHabit, deleteHabit, getLogsInRange, listHabits, updateHabit, upsertDayLog, upsertUserProfile } from "@/lib/firestore";
import {
  dateStringAddDays,
  daysInMonthUTC,
  fromDateStringLocal,
  getWeekdayIndexInTZ,
  toDateStringInTZ,
} from "@/lib/date";
import { auth, storage } from "@/lib/firebase";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { updateProfile } from "firebase/auth";
import LineGraph from "@/components/LineGraph";
import type { DayLog, Habit } from "@/lib/types";

type HabitCard = {
  id: string;
  name: string;
  category: string;
  target: string;
  targetValue: number;
  targetType: "daily" | "weekly";
  frequency: string;
  streak: number;
  completion: number;
  status: "Active" | "Paused";
};

type ChallengeState = {
  habitId: string;
  habitName: string;
  durationDays: number;
  targetMinutes: number;
  startDate: string; // yyyy-mm-dd (Kathmandu)
  endDate: string; // yyyy-mm-dd (inclusive)
  daily: Record<string, number>;
  status: "active" | "completed" | "not-completed";
};

const initialHabitCards: HabitCard[] = [
  {
    id: "a1",
    name: "Morning Walk",
    category: "Health",
    target: "30 minutes",
    targetValue: 30,
    targetType: "daily",
    frequency: "Daily",
    streak: 12,
    completion: 82,
    status: "Active",
  },
  {
    id: "a2",
    name: "Read Book",
    category: "Study",
    target: "20 pages",
    targetValue: 20,
    targetType: "daily",
    frequency: "Daily",
    streak: 7,
    completion: 68,
    status: "Active",
  },
  {
    id: "a3",
    name: "Meditation",
    category: "Mind",
    target: "10 minutes",
    targetValue: 10,
    targetType: "daily",
    frequency: "Daily",
    streak: 18,
    completion: 91,
    status: "Active",
  },
  {
    id: "a4",
    name: "Project Review",
    category: "Work",
    target: "3 tasks",
    targetValue: 3,
    targetType: "weekly",
    frequency: "Weekly",
    streak: 4,
    completion: 54,
    status: "Paused",
  },
  {
    id: "a5",
    name: "Clean Desk",
    category: "Home",
    target: "15 minutes",
    targetValue: 15,
    targetType: "weekly",
    frequency: "Weekly",
    streak: 2,
    completion: 41,
    status: "Active",
  },
];

const categoryOptions = ["All", "Health", "Study", "Work", "Mind", "Home", "Custom"];

const habitTemplates = [
  { name: "Drink Water", category: "Health", target: "8", frequency: "Daily" },
  { name: "Morning Walk", category: "Health", target: "30", frequency: "Daily" },
  { name: "Read Book", category: "Study", target: "20", frequency: "Daily" },
  { name: "Meditation", category: "Mind", target: "10", frequency: "Daily" },
  { name: "Workout", category: "Health", target: "45", frequency: "Weekly (Mon-Sun)" },
  { name: "Clean Room", category: "Home", target: "20", frequency: "Weekly (Mon-Sun)" },
];

const TIME_ZONE = "Asia/Kathmandu";
const KATHMANDU_OFFSET = "+05:45";
const CHALLENGE_STORAGE_KEY = "habit_challenge_v1";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function getStatusValue(entry?: { status?: string; done?: boolean }) {
  if (!entry) return "none";
  if (entry.status === "done" || entry.status === "skip" || entry.status === "none") return entry.status;
  if (typeof entry.done === "boolean") return entry.done ? "done" : "none";
  return "none";
}

function formatDisplayDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

function toKathmanduDateTime(dateString: string, time = "00:00:00") {
  return new Date(`${dateString}T${time}${KATHMANDU_OFFSET}`);
}

function getChallengeStatus(challenge: ChallengeState, now: Date) {
  const endExclusive = toKathmanduDateTime(dateStringAddDays(challenge.endDate, 1));
  if (now < endExclusive) return "active";
  const days: string[] = [];
  let cursor = challenge.startDate;
  let guard = 0;
  while (cursor <= challenge.endDate && guard < 400) {
    days.push(cursor);
    cursor = dateStringAddDays(cursor, 1);
    guard += 1;
  }
  const completed = days.every(
    (day) => (challenge.daily[day] ?? 0) >= challenge.targetMinutes
  );
  return completed ? "completed" : "not-completed";
}

export default function DashboardPage() {
  const [habitCards, setHabitCards] = useState<HabitCard[]>(initialHabitCards);
  const [todayStatus, setTodayStatus] = useState<Record<string, "done" | "skip" | "none">>({});

  const { user, logout } = useAuth();
  const router = useRouter();

  const [habitName, setHabitName] = useState("");
  const [habitCategory, setHabitCategory] = useState("Health");
  const [habitTarget, setHabitTarget] = useState("30");
  const [habitFrequency, setHabitFrequency] = useState("Daily");
  const [habitStartDate, setHabitStartDate] = useState(() => toDateStringInTZ(new Date(), TIME_ZONE));
  const [habitReminderTime, setHabitReminderTime] = useState("");
  const [habitReminderEnabled, setHabitReminderEnabled] = useState(false);
  const [habitColor, setHabitColor] = useState("#0f766e");
  const [habitIcon, setHabitIcon] = useState("Walk");

  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Paused">("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");

  const [todayString, setTodayString] = useState(() => toDateStringInTZ(new Date(), TIME_ZONE));
  const [selectedDateString, setSelectedDateString] = useState(todayString);
  const [logsByDate, setLogsByDate] = useState<Record<string, DayLog>>({});
  const [logSaving, setLogSaving] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const prevTodayRef = useRef(todayString);
  const [historyDateString, setHistoryDateString] = useState(todayString);
  const [historyStatus, setHistoryStatus] = useState<Record<string, "done" | "skip" | "none">>({});
  const [analyticsLogs, setAnalyticsLogs] = useState<Record<string, DayLog>>({});

  const [yearStr, monthStr, dayStr] = todayString.split("-");
  const todayYear = Number(yearStr);
  const todayMonth = Number(monthStr) - 1;
  const todayDate = Number(dayStr);
  const [viewYear, setViewYear] = useState(todayYear);
  const [viewMonth, setViewMonth] = useState(todayMonth);
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const daysInMonth = daysInMonthUTC(viewYear, viewMonth);
  const firstDayIndex = (getWeekdayIndexInTZ(viewYear, viewMonth, 1, TIME_ZONE) + 6) % 7;
  const monthStart = `${viewYear}-${pad2(viewMonth + 1)}-01`;
  const monthEnd = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(daysInMonth)}`;
  const calendarCells = [
    ...Array.from({ length: firstDayIndex }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      return {
        day,
        dateString: `${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}`
      };
    }),
  ];

  const [selectedDay, setSelectedDay] = useState<number>(todayDate);
  const [exportStart, setExportStart] = useState(monthStart);
  const [exportEnd, setExportEnd] = useState(todayString);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savingHabit, setSavingHabit] = useState(false);
  const [quickActionMessage, setQuickActionMessage] = useState<string | null>(null);
  const [reminderMessage, setReminderMessage] = useState<string | null>(null);
  const [journalMessage, setJournalMessage] = useState<string | null>(null);
  const [journalText, setJournalText] = useState("");
  const [selectedMood, setSelectedMood] = useState<"happy" | "angry" | "rest" | null>(null);
  const [habitActionMessage, setHabitActionMessage] = useState<string | null>(null);
  const [goalMessage, setGoalMessage] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<ChallengeState | null>(null);
  const [challengeDuration, setChallengeDuration] = useState(7);
  const [challengeHabitId, setChallengeHabitId] = useState<string>("");
  const [challengeTarget, setChallengeTarget] = useState("30");
  const [challengeCountdown, setChallengeCountdown] = useState("00:00:00");
  const [challengeTodayMinutes, setChallengeTodayMinutes] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editHabitId, setEditHabitId] = useState<string | null>(null);
  const [editHabitName, setEditHabitName] = useState("");
  const [editHabitTarget, setEditHabitTarget] = useState("1");
  const [activeSection, setActiveSection] = useState<
    | "overview"
    | "my-habits"
    | "add-habit"
    | "calendar"
    | "history"
    | "analytics"
    | "goals"
    | "reminders"
    | "journal"
    | "profile"
    | "settings"
  >("overview");

  const mapHabitToCard = (habit: Habit): HabitCard => {
    const safeTargetValue = Number.isFinite(habit.targetValue) ? habit.targetValue : 1;
    const safeTargetType = habit.targetType ?? "daily";
    return {
      id: habit.id,
      name: habit.title || habit.id,
      category: habit.category === "common" ? "Health" : "Custom",
      target: `${safeTargetValue} ${safeTargetType === "daily" ? "min" : "tasks"}`,
      targetValue: safeTargetValue,
      targetType: safeTargetType,
      frequency: safeTargetType === "daily" ? "Daily" : "Weekly",
      streak: 0,
      completion: 0,
      status: habit.active ? "Active" : "Paused",
    };
  };

  useEffect(() => {
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user && !user.emailVerified) {
      router.replace("/login");
    }
  }, [router, user]);

  useEffect(() => {
    const interval = setInterval(() => {
      const next = toDateStringInTZ(new Date(), TIME_ZONE);
      setTodayString((prev) => (prev === next ? prev : next));
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(CHALLENGE_STORAGE_KEY) : null;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as ChallengeState;
      if (parsed && parsed.habitId && parsed.startDate && parsed.endDate) {
        setChallenge(parsed);
        setChallengeDuration(parsed.durationDays);
        setChallengeHabitId(parsed.habitId);
        setChallengeTarget(String(parsed.targetMinutes));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!challenge) {
      window.localStorage.removeItem(CHALLENGE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(CHALLENGE_STORAGE_KEY, JSON.stringify(challenge));
    }
  }, [challenge]);

  useEffect(() => {
    const tick = () => {
      if (!challenge) {
        setChallengeCountdown("00:00:00");
        return;
      }
      const endExclusive = toKathmanduDateTime(dateStringAddDays(challenge.endDate, 1));
      const now = new Date();
      const diff = Math.max(endExclusive.getTime() - now.getTime(), 0);
      const totalSeconds = Math.floor(diff / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      setChallengeCountdown(
        `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      );

      const nextStatus = getChallengeStatus(challenge, now);
      if (nextStatus !== challenge.status) {
        setChallenge((prev) => (prev ? { ...prev, status: nextStatus } : prev));
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [challenge]);

  useEffect(() => {
    if (selectedDateString === prevTodayRef.current) {
      setSelectedDateString(todayString);
    }
    if (exportEnd === prevTodayRef.current) {
      setExportEnd(todayString);
    }
    prevTodayRef.current = todayString;
  }, [todayString, selectedDateString, exportEnd]);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    listHabits(user.uid)
      .then((habits) => {
        if (!mounted || habits.length === 0) return;
        setHabitCards(habits.map(mapHabitToCard));
      })
      .catch(() => {
        // fallback to demo cards
      });
    return () => {
      mounted = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    getLogsInRange(user.uid, monthStart, monthEnd)
      .then((logs) => {
        if (!mounted) return;
        const next: Record<string, DayLog> = {};
        for (const log of logs) next[log.dateString] = log;
        setLogsByDate(next);
      })
      .catch(() => {
        if (mounted) setLogsByDate({});
      });
    return () => {
      mounted = false;
    };
  }, [user, monthStart, monthEnd]);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const start = dateStringAddDays(todayString, -89);
    getLogsInRange(user.uid, start, todayString)
      .then((logs) => {
        if (!mounted) return;
        const next: Record<string, DayLog> = {};
        for (const log of logs) next[log.dateString] = log;
        setAnalyticsLogs(next);
      })
      .catch(() => {
        if (mounted) setAnalyticsLogs({});
      });
    return () => {
      mounted = false;
    };
  }, [user, todayString]);

  useEffect(() => {
    const [selYear, selMonth, selDay] = selectedDateString.split("-").map(Number);
    if (Number.isFinite(selDay)) setSelectedDay(selDay);
    if (selYear !== viewYear || selMonth - 1 !== viewMonth) {
      setSelectedDateString(`${viewYear}-${pad2(viewMonth + 1)}-01`);
    }
  }, [selectedDateString, viewYear, viewMonth]);

  useEffect(() => {
    if (selectedDateString === todayString) {
      setSelectedDay(todayDate);
    }
  }, [todayDate, todayString, selectedDateString]);

  const filteredHabits = useMemo(() => {
    return habitCards.filter((habit) => {
      if (statusFilter !== "All" && habit.status !== statusFilter) {
        return false;
      }
      if (categoryFilter !== "All" && habit.category !== categoryFilter) {
        return false;
      }
      if (searchTerm.trim().length > 0) {
        return habit.name.toLowerCase().includes(searchTerm.toLowerCase());
      }
      return true;
    });
  }, [statusFilter, categoryFilter, searchTerm]);

  const buildStatusFromLog = (log: DayLog | null) => {
    const next: Record<string, "done" | "skip" | "none"> = {};
    for (const habit of habitCards) {
      const entry = log?.habitStatus?.[habit.id] as any;
      next[habit.id] = getStatusValue(entry) as "done" | "skip" | "none";
    }
    return next;
  };

  const getDayStatus = (log?: DayLog) => {
    if (!log) return "none";
    const statuses = habitCards.map((habit) =>
      getStatusValue(log.habitStatus?.[habit.id] as any)
    );
    if (statuses.length === 0) return "none";
    if (statuses.every((status) => status === "done")) return "done";
    if (statuses.some((status) => status === "skip")) return "missed";
    if (statuses.some((status) => status === "done")) return "missed";
    return "missed";
  };

  const getCompletionPct = (log?: DayLog) => {
    if (!log || habitCards.length === 0) return 0;
    const done = habitCards.filter(
      (habit) => getStatusValue(log.habitStatus?.[habit.id] as any) === "done"
    ).length;
    return (done / habitCards.length) * 100;
  };

  const weeklyBarsData = useMemo(() => {
    const arr: { label: string; value: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dateString = dateStringAddDays(todayString, -i);
      const label = new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        weekday: "short",
      }).format(toKathmanduDateTime(dateString));
      const log = analyticsLogs[dateString];
      arr.push({ label, value: getCompletionPct(log) });
    }
    return arr;
  }, [analyticsLogs, todayString, habitCards]);

  const monthlyBarsData = useMemo(() => {
    const buckets = [0, 0, 0, 0];
    const counts = [0, 0, 0, 0];
    const days = daysInMonthUTC(todayYear, todayMonth);
    for (let day = 1; day <= days; day++) {
      const weekIndex = Math.min(3, Math.floor((day - 1) / 7));
      const dateString = `${todayYear}-${String(todayMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const log = analyticsLogs[dateString];
      buckets[weekIndex] += getCompletionPct(log);
      counts[weekIndex] += 1;
    }
    return ["W1", "W2", "W3", "W4"].map((label, idx) => ({
      label,
      value: counts[idx] ? buckets[idx] / counts[idx] : 0,
    }));
  }, [analyticsLogs, todayYear, todayMonth, habitCards]);

  const trendData = useMemo(() => {
    const rows: { label: string; value: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const dateString = dateStringAddDays(todayString, -i);
      const log = analyticsLogs[dateString];
      rows.push({ label: dateString.slice(5), value: getCompletionPct(log) });
    }
    return rows;
  }, [analyticsLogs, todayString, habitCards]);

  const habitStats = useMemo(() => {
    const days: string[] = [];
    let cursor = dateStringAddDays(todayString, -29);
    let guard = 0;
    while (cursor <= todayString && guard < 40) {
      days.push(cursor);
      cursor = dateStringAddDays(cursor, 1);
      guard += 1;
    }
    const stats = habitCards.map((habit) => {
      let done = 0;
      let longest = 0;
      let current = 0;
      for (const day of days) {
        const log = analyticsLogs[day];
        const status = getStatusValue(log?.habitStatus?.[habit.id] as any);
        if (status === "done") {
          done += 1;
          current += 1;
          longest = Math.max(longest, current);
        } else {
          current = 0;
        }
      }
      const completion = days.length ? Math.round((done / days.length) * 100) : 0;
      const missed = Math.max(days.length - done, 0);
      return { ...habit, completion, streak: longest, missed };
    });
    return stats;
  }, [habitCards, analyticsLogs, todayString]);


  const weekdayStats = useMemo(() => {
    const sums: Record<string, { total: number; count: number }> = {
      Mon: { total: 0, count: 0 },
      Tue: { total: 0, count: 0 },
      Wed: { total: 0, count: 0 },
      Thu: { total: 0, count: 0 },
      Fri: { total: 0, count: 0 },
      Sat: { total: 0, count: 0 },
      Sun: { total: 0, count: 0 },
    };
    for (let i = 29; i >= 0; i--) {
      const dateString = dateStringAddDays(todayString, -i);
      const label = new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        weekday: "short",
      }).format(toKathmanduDateTime(dateString));
      const log = analyticsLogs[dateString];
      const pct = getCompletionPct(log);
      if (sums[label]) {
        sums[label].total += pct;
        sums[label].count += 1;
      }
    }
    const entries = Object.entries(sums).map(([day, val]) => ({
      day,
      avg: val.count ? val.total / val.count : 0,
    }));
    entries.sort((a, b) => b.avg - a.avg);
    return {
      best: entries[0]?.day ?? "N/A",
      worst: entries[entries.length - 1]?.day ?? "N/A",
    };
  }, [analyticsLogs, todayString, habitCards]);

  const mostConsistent = useMemo(() => {
    const sorted = [...habitStats].sort((a, b) => b.completion - a.completion);
    return sorted[0]?.name ?? "N/A";
  }, [habitStats]);

  useEffect(() => {
    const log = logsByDate[todayString] ?? null;
    setTodayStatus(buildStatusFromLog(log));
  }, [habitCards, logsByDate, todayString]);

  useEffect(() => {
    const log = logsByDate[historyDateString] ?? null;
    setHistoryStatus(buildStatusFromLog(log));
  }, [habitCards, logsByDate, historyDateString]);

  const overviewHabits = habitCards;

  const doneCount = overviewHabits.reduce(
    (count, habit) => count + (todayStatus[habit.id] === "done" ? 1 : 0),
    0
  );
  const remainingCount = Math.max(overviewHabits.length - doneCount, 0);
  const progressPct = overviewHabits.length
    ? Math.round((doneCount / overviewHabits.length) * 100)
    : 0;

  const saveTodayStatus = async (nextStatus: Record<string, "done" | "skip" | "none">) => {
    setTodayStatus(nextStatus);
    if (!user) return;
    setLogSaving(true);
    try {
      const habitStatus: Record<string, { status: "done" | "skip" | "none"; count: number }> = {};
      for (const habit of habitCards) {
        const status = nextStatus[habit.id] ?? "none";
        habitStatus[habit.id] = {
          status,
          count: status === "done" ? 1 : 0,
        };
      }
      const log: DayLog = {
        dateString: todayString,
        updatedAt: Date.now(),
        habitStatus,
      };
      await upsertDayLog(user.uid, log);
      setLogsByDate((prev) => ({ ...prev, [todayString]: log }));
    } catch (error) {
      console.error(error);
    } finally {
      setLogSaving(false);
    }
  };

  const saveStatusForDate = async (
    dateString: string,
    nextStatus: Record<string, "done" | "skip" | "none">
  ) => {
    setHistoryStatus(nextStatus);
    if (!user) return;
    setLogSaving(true);
    try {
      const habitStatus: Record<string, { status: "done" | "skip" | "none"; count: number }> = {};
      for (const habit of habitCards) {
        const status = nextStatus[habit.id] ?? "none";
        habitStatus[habit.id] = {
          status,
          count: status === "done" ? 1 : 0,
        };
      }
      const log: DayLog = {
        dateString,
        updatedAt: Date.now(),
        habitStatus,
      };
      await upsertDayLog(user.uid, log);
      setLogsByDate((prev) => ({ ...prev, [dateString]: log }));
    } catch (error) {
      console.error(error);
    } finally {
      setLogSaving(false);
    }
  };

  const handleSaveHabit = async () => {
    setSaveMessage(null);

    if (!user) {
      setSaveMessage("Please login to save habits.");
      return;
    }

    if (!habitName.trim()) {
      setSaveMessage("Habit name is required.");
      return;
    }

    const targetValue = Number(habitTarget);
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      setSaveMessage("Target must be a positive number.");
      return;
    }

    setSavingHabit(true);
    try {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const normalizedFrequency = habitFrequency === "Daily" ? "daily" : "weekly";
      const targetLabel = `${targetValue} ${habitTarget === "1" ? "unit" : "units"}`;

      const startDateString = habitStartDate || todayString;
      const startDate = fromDateStringLocal(startDateString);
      await createHabit(user.uid, {
        id,
        title: habitName.trim(),
        category: "custom",
        targetType: normalizedFrequency,
        targetValue,
        active: true,
        createdAt: startDate.getTime(),
      });

      const card: HabitCard = {
        id,
        name: habitName.trim(),
        category: habitCategory,
        target: `${targetValue} ${habitFrequency === "Daily" ? "min" : "tasks"}`,
        targetValue,
        targetType: normalizedFrequency,
        frequency: habitFrequency === "Daily" ? "Daily" : "Weekly",
        streak: 0,
        completion: 0,
        status: "Active",
      };

      setHabitCards((prev) => [card, ...prev]);
      setTodayStatus((prev) => ({ ...prev, [id]: "none" }));

      setSaveMessage("Saved to Firebase.");
      await refreshHabits();
    } catch (error) {
      setSaveMessage("Save failed. Check Firebase setup.");
    } finally {
      setSavingHabit(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const handleQuickNav = (target: typeof activeSection, message: string) => {
    setActiveSection(target);
    setQuickActionMessage(message);
    setTimeout(() => setQuickActionMessage(null), 2000);
  };

  const handleReminderAction = (label: string) => {
    setReminderMessage(`${label} (demo).`);
    setTimeout(() => setReminderMessage(null), 2000);
  };

  const handleJournalSave = () => {
    if (!selectedMood) {
      setJournalMessage("Select mood first.");
      setTimeout(() => setJournalMessage(null), 2000);
      return;
    }
    if (!user) {
      setJournalMessage("Please login to save.");
      setTimeout(() => setJournalMessage(null), 2000);
      return;
    }
    const save = async () => {
      try {
        const log: DayLog = {
          dateString: todayString,
          updatedAt: Date.now(),
          habitStatus: (logsByDate[todayString]?.habitStatus ?? {}) as any,
          mood: selectedMood,
          note: journalText.trim(),
        };
        await upsertDayLog(user.uid, log);
        setLogsByDate((prev) => ({ ...prev, [todayString]: log }));
        setAnalyticsLogs((prev) => ({ ...prev, [todayString]: log }));
        setJournalMessage("Journal saved.");
      } catch (error) {
        console.error(error);
        setJournalMessage("Save failed.");
      } finally {
        setTimeout(() => setJournalMessage(null), 2000);
      }
    };
    void save();
  };

  const handleHabitAction = (label: string) => {
    setHabitActionMessage(label);
    setTimeout(() => setHabitActionMessage(null), 2000);
  };


  const startChallenge = () => {
    const habit = habitCards.find((h) => h.id === challengeHabitId && h.status === "Active");
    if (!habit) {
      setGoalMessage("Select an active habit.");
      return;
    }
    const targetMinutes = Number(challengeTarget);
    if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) {
      setGoalMessage("Enter valid minutes target.");
      return;
    }
    const startDate = todayString;
    const endDate = dateStringAddDays(startDate, challengeDuration - 1);
    const next: ChallengeState = {
      habitId: habit.id,
      habitName: habit.name,
      durationDays: challengeDuration,
      targetMinutes,
      startDate,
      endDate,
      daily: {},
      status: "active",
    };
    setChallenge(next);
    setGoalMessage("Challenge started.");
    setTimeout(() => setGoalMessage(null), 2000);
  };

  const logTodayMinutes = () => {
    if (!challenge) return;
    const minutes = Number(challengeTodayMinutes);
    if (!Number.isFinite(minutes) || minutes < 0) {
      setGoalMessage("Enter valid minutes.");
      return;
    }
    setChallenge((prev) =>
      prev
        ? {
            ...prev,
            daily: {
              ...prev.daily,
              [todayString]: minutes,
            },
          }
        : prev
    );
    setGoalMessage("Logged for today.");
    setTimeout(() => setGoalMessage(null), 2000);
  };

  const markTodayComplete = () => {
    if (!challenge) return;
    setChallenge((prev) =>
      prev
        ? {
            ...prev,
            daily: {
              ...prev.daily,
              [todayString]: prev.targetMinutes,
            },
          }
        : prev
    );
    setGoalMessage("Marked complete for today.");
    setTimeout(() => setGoalMessage(null), 2000);
  };

  const markTodayNotComplete = () => {
    if (!challenge) return;
    setChallenge((prev) =>
      prev
        ? {
            ...prev,
            daily: {
              ...prev.daily,
              [todayString]: 0,
            },
          }
        : prev
    );
    setGoalMessage("Marked not complete for today.");
    setTimeout(() => setGoalMessage(null), 2000);
  };

  const resetChallenge = () => {
    setChallenge(null);
    setChallengeTodayMinutes("");
    setGoalMessage("Challenge cleared.");
    setTimeout(() => setGoalMessage(null), 2000);
  };

  const handlePhotoChange = (file?: File | null) => {
    setPhotoError(null);
    setPhotoMessage(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Only image files are allowed.");
      return;
    }
    if (file.size > 4_000_000) {
      setPhotoError("Image too large. Max 4MB.");
      return;
    }

    if (!auth.currentUser) {
      setPhotoError("Login required.");
      return;
    }

    const compressImage = (input: File) =>
      new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(input);
        img.onload = () => {
          URL.revokeObjectURL(url);
          const maxSize = 512;
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const width = Math.round(img.width * scale);
          const height = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas not supported"));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error("Compression failed"));
                return;
              }
              resolve(blob);
            },
            "image/jpeg",
            0.8
          );
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Image load failed"));
        };
        img.src = url;
      });

    const upload = async () => {
      setPhotoUploading(true);
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error("No user");
        }
        const uid = currentUser.uid;
        const compressed = await compressImage(file);
        const ref = storageRef(storage, `users/${uid}/profile-${Date.now()}.jpg`);
        await uploadBytes(ref, compressed, { contentType: "image/jpeg" });
        const url = await getDownloadURL(ref);

        await updateProfile(currentUser, { photoURL: url });
        await upsertUserProfile(currentUser.uid, {
          name: currentUser.displayName ?? null,
          email: currentUser.email ?? null,
          photoURL: url,
        });
        setPhotoPreview(url);
        setPhotoMessage("Profile photo updated.");
      } catch (error) {
        console.error(error);
        setPhotoError("Failed to update photo.");
      } finally {
        setPhotoUploading(false);
      }
    };

    void upload();
  };

  const refreshHabits = async () => {
    if (!user) return;
    try {
      const habits = await listHabits(user.uid);
      if (habits.length > 0) {
        setHabitCards(habits.map(mapHabitToCard));
      }
    } catch (error) {
      console.error(error);
    }
  };

  const goPrevMonth = () => {
    const nextMonth = viewMonth - 1;
    if (nextMonth < 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(nextMonth);
    }
  };

  const goNextMonth = () => {
    const nextMonth = viewMonth + 1;
    if (nextMonth > 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(nextMonth);
    }
  };

  const handleExportPdf = async (rangeStart?: string, rangeEnd?: string) => {
    setExportMessage(null);
    if (!user) {
      setExportMessage("Please login to export.");
      return;
    }
    const start = rangeStart ?? exportStart;
    const end = rangeEnd ?? exportEnd;
    if (!start || !end) {
      setExportMessage("Select a valid date range.");
      return;
    }
    if (start > end) {
      setExportMessage("Start date must be before end date.");
      return;
    }

    try {
      const logs = await getLogsInRange(user.uid, start, end);
      const logsMap: Record<string, DayLog> = {};
      for (const log of logs) logsMap[log.dateString] = log;

      const dates: string[] = [];
      let cursor = start;
      let guard = 0;
      while (cursor <= end && guard < 400) {
        dates.push(cursor);
        cursor = dateStringAddDays(cursor, 1);
        guard += 1;
      }

      const rows = dates.map((date) => {
        const log = logsMap[date];
        const statuses = habitCards.map((habit) =>
          getStatusValue(log?.habitStatus?.[habit.id] as any)
        );
        const done = statuses.filter((s) => s === "done").length;
        const skipped = statuses.filter((s) => s === "skip").length;
        const unmarked = Math.max(statuses.length - done - skipped, 0);
        return { date, done, skipped, unmarked };
      });

      const html = `
        <html>
          <head>
            <title>Habit Export ${start} to ${end}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
              h1 { font-size: 18px; margin: 0 0 6px; }
              p { font-size: 12px; color: #555; margin: 0 0 16px; }
              table { width: 100%; border-collapse: collapse; font-size: 12px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background: #f4f4f5; }
            </style>
          </head>
          <body>
            <h1>Habit Tracker Report</h1>
            <p>Range: ${start} to ${end} (Asia/Kathmandu)</p>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Done</th>
                  <th>Skipped</th>
                  <th>Unmarked</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (row) => `
                  <tr>
                    <td>${row.date}</td>
                    <td>${row.done}</td>
                    <td>${row.skipped}</td>
                    <td>${row.unmarked}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </body>
        </html>
      `;

      const win = window.open("", "_blank", "width=900,height=700");
      if (!win) {
        setExportMessage("Popup blocked. Allow popups to export.");
        return;
      }
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    } catch (error) {
      console.error(error);
      setExportMessage("Export failed. Please try again.");
    }
  };

  const handleExportCsv = () => {
    if (!habitCards.length) {
      setExportMessage("No habits to export.");
      return;
    }
    const dates: string[] = [];
    let cursor = dateStringAddDays(todayString, -29);
    let guard = 0;
    while (cursor <= todayString && guard < 40) {
      dates.push(cursor);
      cursor = dateStringAddDays(cursor, 1);
      guard += 1;
    }
    const headers = ["Date", "Done", "Skipped", "NotMarked", ...habitCards.map((h) => h.name)];
    const rows = dates.map((date) => {
      const log = analyticsLogs[date];
      const statuses = habitCards.map((habit) =>
        getStatusValue(log?.habitStatus?.[habit.id] as any)
      );
      const done = statuses.filter((s) => s === "done").length;
      const skipped = statuses.filter((s) => s === "skip").length;
      const notMarked = Math.max(statuses.length - done - skipped, 0);
      const perHabit = statuses.map((s) => s);
      return [date, done, skipped, notMarked, ...perHabit];
    });
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((val) => {
            const safe = String(val ?? "");
            if (safe.includes(",") || safe.includes("\"")) {
              return `"${safe.replace(/\"/g, "\"\"")}"`;
            }
            return safe;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `habit-analytics-${todayString}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleToggleHabit = async (habitId: string) => {
    const current = habitCards.find((habit) => habit.id === habitId);
    const nextStatus = current?.status === "Active" ? "Paused" : "Active";

    setHabitCards((prev) =>
      prev.map((habit) =>
        habit.id === habitId
          ? {
              ...habit,
              status: nextStatus,
            }
          : habit
      )
    );
    handleHabitAction("Updating...");

    if (!user) {
      handleHabitAction("Paused/Resumed (demo)");
      return;
    }

    try {
      const nextActive = nextStatus === "Active";
      await updateHabit(user.uid, habitId, { active: nextActive });
      handleHabitAction("Updated on Firebase.");
    } catch (error) {
      try {
        if (current) {
          const targetValue = Number.isFinite(current.targetValue)
            ? current.targetValue
            : Number.parseInt(current.target, 10);
          await createHabit(user.uid, {
            id: habitId,
            title: current.name,
            category: "custom",
            targetType: current.targetType ?? (current.frequency === "Daily" ? "daily" : "weekly"),
            targetValue: Number.isFinite(targetValue) ? targetValue : 1,
            active: nextStatus === "Active",
            createdAt: Date.now(),
          });
          handleHabitAction("Created on Firebase.");
          return;
        }
      } catch (innerError) {
        console.error(innerError);
      }
      console.error(error);
      setHabitCards((prev) =>
        prev.map((habit) =>
          habit.id === habitId && current
            ? {
                ...habit,
                status: current.status,
              }
            : habit
        )
      );
      handleHabitAction("Update failed. Check Firebase.");
    }
  };

  const handleEditHabit = (habitId: string) => {
    const current = habitCards.find((habit) => habit.id === habitId);
    if (!current) return;

    setEditHabitId(habitId);
    setEditHabitName(current.name);
    setEditHabitTarget(
      Number.isFinite(current.targetValue) ? String(current.targetValue) : current.target.replace(/\D/g, "") || "1"
    );
    setIsEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editHabitId) return;
    const nextName = editHabitName.trim();
    if (!nextName) {
      handleHabitAction("Habit name required.");
      return;
    }
    const nextTargetValue = Number.parseInt(editHabitTarget, 10);
    if (!Number.isFinite(nextTargetValue) || nextTargetValue <= 0) {
      handleHabitAction("Invalid target.");
      return;
    }

    const current = habitCards.find((habit) => habit.id === editHabitId);
    const nextTargetLabel = `${nextTargetValue} ${current?.targetType === "daily" ? "min" : "tasks"}`;

    const previous = current;
    setHabitCards((prev) =>
      prev.map((habit) =>
        habit.id === editHabitId
          ? {
              ...habit,
              name: nextName,
              target: nextTargetLabel,
              targetValue: nextTargetValue,
            }
          : habit
      )
    );

    setTodayStatus((prev) => ({ ...prev, [editHabitId]: prev[editHabitId] ?? "none" }));
    setIsEditOpen(false);

    if (!user) {
      handleHabitAction("Edited (demo).");
      return;
    }

    try {
      await updateHabit(user.uid, editHabitId, {
        title: nextName,
        targetValue: nextTargetValue,
      });
      handleHabitAction("Updated on Firebase.");
    } catch (error) {
      console.error(error);
      if (previous) {
        setHabitCards((prev) =>
          prev.map((habit) => (habit.id === previous.id ? previous : habit))
        );
      }
      handleHabitAction("Update failed. Check Firebase.");
    }
  };

  const handleDeleteHabit = async (habitId: string) => {
    const current = habitCards.find((habit) => habit.id === habitId);
    if (!current) return;
    const ok = window.confirm(`Delete "${current.name}"?`);
    if (!ok) return;

    const prevIndex = habitCards.findIndex((habit) => habit.id === habitId);
    setHabitCards((prev) => prev.filter((habit) => habit.id !== habitId));
    setTodayStatus((prev) => {
      const next = { ...prev };
      delete next[habitId];
      return next;
    });

    if (!user) {
      handleHabitAction("Deleted (demo).");
      return;
    }

    try {
      await deleteHabit(user.uid, habitId);
      handleHabitAction("Deleted from Firebase.");
    } catch (error) {
      console.error(error);
      if (current) {
        setHabitCards((prev) => {
          const next = [...prev];
          const insertAt = prevIndex >= 0 ? prevIndex : next.length;
          next.splice(insertAt, 0, current);
          return next;
        });
      }
      handleHabitAction("Delete failed. Check Firebase.");
    }
  };

  return (
    <main className="min-h-screen px-6 py-10 lg:px-12">
      {isEditOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="card w-full max-w-md p-6 space-y-4">
            <div className="text-lg font-semibold">Edit habit</div>
            <label className="text-sm text-zinc-600">
              Habit name
              <input
                className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
                value={editHabitName}
                onChange={(event) => setEditHabitName(event.target.value)}
              />
            </label>
            <label className="text-sm text-zinc-600">
              Target (number)
              <input
                type="number"
                min={1}
                className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
                value={editHabitTarget}
                onChange={(event) => setEditHabitTarget(event.target.value)}
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditOpen(false)}
                className="px-4 py-2 rounded-full border border-zinc-200 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEditSave}
                className="px-4 py-2 rounded-full bg-zinc-900 text-white text-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="max-w-6xl mx-auto space-y-10">
        <header className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] items-center">
          <div className="fade-rise">
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Habit Tracker</p>
            <h1
              className="text-4xl md:text-5xl font-semibold leading-tight text-zinc-900"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Design your days with intention.
            </h1>
            <p className="text-base text-zinc-600 mt-3 max-w-xl">
              A focused dashboard that keeps daily habits visible, measurable, and rewarding.
              Update progress quickly and review trends without leaving the page.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => handleQuickNav("add-habit", "Add habit opened.")}
                className="px-4 py-2 rounded-full bg-teal-700 text-white text-sm shadow-sm"
              >
                Add new habit
              </button>
              <button
                type="button"
                onClick={() => handleQuickNav("analytics", "Weekly report opened.")}
                className="px-4 py-2 rounded-full border border-zinc-200 bg-white text-sm text-zinc-700"
              >
                View weekly report
              </button>
            </div>
            {quickActionMessage ? (
              <p className="text-xs text-zinc-500 mt-2">{quickActionMessage}</p>
            ) : null}
          </div>

          <div className="card p-5 fade-rise-delay float-soft">
            <div className="flex items-center justify-between text-sm text-zinc-500">
              <span>Today progress</span>
              <span>{progressPct}%</span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-zinc-100">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-amber-500 to-teal-600"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-amber-50 p-3">
                <div className="text-zinc-500">Done</div>
                <div className="text-lg font-semibold text-amber-700">{doneCount}</div>
                <div className="text-xs text-zinc-500 mt-1">
                  {overviewHabits.length ? `${doneCount}/${overviewHabits.length}` : "0/0"}
                </div>
              </div>
              <div className="rounded-xl bg-teal-50 p-3">
                <div className="text-zinc-500">Remaining</div>
                <div className="text-lg font-semibold text-teal-700">{remainingCount}</div>
              </div>
            </div>
            <p className="mt-4 text-xs text-zinc-500">
              Motivation: "Small steps daily become giant leaps yearly."
            </p>
          </div>
        </header>

        <div className="grid lg:grid-cols-[240px_1fr] gap-8">
          <aside className="hidden lg:block">
            <div className="sticky top-8 card p-4">
              <div className="text-xs uppercase tracking-[0.3em] text-zinc-400 mb-3">
                Sections
              </div>
              <nav className="space-y-1 text-sm text-zinc-600">
                {[
                  { id: "overview", label: "Overview" },
                  { id: "my-habits", label: "My Habits" },
                  { id: "add-habit", label: "Add Habit" },
                  { id: "calendar", label: "Calendar" },
                  { id: "history", label: "History" },
                  { id: "analytics", label: "Analytics" },
                  { id: "goals", label: "Goals" },
                  { id: "reminders", label: "Reminders" },
                  { id: "journal", label: "Journal" },
                  { id: "profile", label: "Profile" },
                  { id: "settings", label: "Settings" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveSection(item.id as typeof activeSection)}
                    className={`w-full text-left rounded-full px-3 py-2 transition ${
                      activeSection === item.id
                        ? "bg-zinc-900 text-white"
                        : "hover:bg-zinc-50 text-zinc-600"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          <section className="space-y-10">
            {activeSection === "overview" ? (
            <section id="overview" className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                  Overview
                </h2>
                <span className="text-xs text-zinc-500">{formatDisplayDate(new Date())}</span>
              </div>

              <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
                <div className="card p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">All habits</h3>
                    <span className="text-xs text-zinc-500">{overviewHabits.length} habits</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {overviewHabits.map((habit) => {
                      const state = todayStatus[habit.id] ?? "none";
                      return (
                        <div
                          key={habit.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-100 px-3 py-3"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-zinc-900">{habit.name}</div>
                            <div className="text-xs text-zinc-500">
                              {habit.target} {habit.frequency}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <button
                              className={`px-3 py-1.5 rounded-full border ${
                                state === "done"
                                  ? "bg-teal-600 text-white border-teal-600"
                                  : "border-zinc-200 text-zinc-700"
                              }`}
                              onClick={() =>
                                saveTodayStatus({ ...todayStatus, [habit.id]: "done" })
                              }
                            >
                              Complete
                            </button>
                            <button
                              className={`px-3 py-1.5 rounded-full border ${
                                state === "skip"
                                  ? "bg-amber-500 text-white border-amber-500"
                                  : "border-zinc-200 text-zinc-700"
                              }`}
                              onClick={() =>
                                saveTodayStatus({ ...todayStatus, [habit.id]: "skip" })
                              }
                            >
                              Incomplete
                            </button>
                            <button
                              className="px-3 py-1.5 rounded-full border border-zinc-200 text-zinc-600"
                              onClick={() =>
                                saveTodayStatus({ ...todayStatus, [habit.id]: "none" })
                              }
                            >
                              Not interested
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="card p-4">
                    <div className="text-sm text-zinc-500">Streak summary</div>
                    <div className="mt-2 flex items-end justify-between">
                      <div>
                        <div className="text-2xl font-semibold">18</div>
                        <div className="text-xs text-zinc-500">Current streak</div>
                      </div>
                      <div>
                        <div className="text-2xl font-semibold text-amber-600">32</div>
                        <div className="text-xs text-zinc-500">Best streak</div>
                      </div>
                    </div>
                  </div>

                  <div className="card p-4">
                    <div className="text-sm text-zinc-500">Today summary</div>
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <span className="text-zinc-700">Done</span>
                      <span className="font-semibold text-teal-600">{doneCount}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-zinc-700">Remaining</span>
                      <span className="font-semibold text-zinc-700">{remainingCount}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-zinc-700">Skipped</span>
                      <span className="font-semibold text-amber-600">
                        {Object.values(todayStatus).filter((value) => value === "skip").length}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          const next: Record<string, "done" | "skip" | "none"> = {};
                          for (const habit of overviewHabits) next[habit.id] = "done";
                          saveTodayStatus(next);
                        }}
                        className="text-xs px-3 py-1.5 rounded-full border border-zinc-200"
                      >
                        Mark all done
                      </button>
                      {logSaving ? (
                        <span className="text-xs text-zinc-400">Saving...</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </section>
            ) : null}
            {activeSection === "my-habits" ? (
            <section id="my-habits" className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                  My Habits
                </h2>
                <button
                  type="button"
                  onClick={() => handleQuickNav("add-habit", "Add habit opened.")}
                  className="text-sm px-3 py-1.5 rounded-full border border-zinc-200 bg-white"
                >
                  Add habit
                </button>
              </div>

              <div className="card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  {(["All", "Active", "Paused"] as const).map((filter) => (
                    <button
                      key={filter}
                      className={`px-3 py-1.5 rounded-full text-sm border ${
                        statusFilter === filter
                          ? "bg-zinc-900 text-white border-zinc-900"
                          : "border-zinc-200 text-zinc-700"
                      }`}
                      onClick={() => setStatusFilter(filter)}
                    >
                      {filter}
                    </button>
                  ))}

                  <select
                    className="ml-auto px-3 py-2 rounded-full border border-zinc-200 bg-white text-sm"
                    value={categoryFilter}
                    onChange={(event) => setCategoryFilter(event.target.value)}
                  >
                    {categoryOptions.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>

                  <input
                    className="px-3 py-2 rounded-full border border-zinc-200 bg-white text-sm w-full md:w-56"
                    placeholder="Search habits"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {filteredHabits.map((habit) => (
                  <div key={habit.id} className="card p-4 space-y-3 relative z-0 pointer-events-auto">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-lg">{habit.name}</h3>
                        <p className="text-xs text-zinc-500">
                          {habit.category} {habit.frequency}
                        </p>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          habit.status === "Active"
                            ? "bg-teal-50 text-teal-700"
                            : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {habit.status}
                      </span>
                    </div>

                    <div className="text-sm text-zinc-600">
                      Target: <span className="font-medium text-zinc-900">{habit.target}</span>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span>Completion</span>
                        <span>{habit.completion}%</span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-zinc-100">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-teal-500 to-amber-400"
                          style={{ width: `${habit.completion}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <div className="text-zinc-500">Streak</div>
                      <div className="font-semibold">{habit.streak} days</div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs pointer-events-auto relative z-10">
                      <button
                        type="button"
                        onClick={() => handleEditHabit(habit.id)}
                        className="px-3 py-1.5 rounded-full border border-zinc-200 relative z-10"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleHabit(habit.id)}
                        className="px-3 py-1.5 rounded-full border border-zinc-200 relative z-10"
                      >
                        {habit.status === "Active" ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteHabit(habit.id)}
                        className="px-3 py-1.5 rounded-full border border-zinc-200 text-rose-600 relative z-10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {habitActionMessage ? (
                <div className="text-xs text-zinc-500">{habitActionMessage}</div>
              ) : null}
            </section>
            ) : null}
            {activeSection === "add-habit" ? (
            <section id="add-habit" className="space-y-5">
              <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Add Habit
              </h2>
              <div className="card p-6 grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Templates</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {habitTemplates.map((template) => (
                      <button
                        key={template.name}
                        type="button"
                        onClick={() => {
                          setHabitName(template.name);
                          setHabitCategory(template.category);
                          setHabitTarget(template.target);
                          setHabitFrequency(template.frequency);
                        }}
                        className="px-3 py-1.5 rounded-full border border-zinc-200"
                      >
                        {template.name}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="text-sm text-zinc-600">
                  Habit name
                  <input
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
                    value={habitName}
                    onChange={(event) => setHabitName(event.target.value)}
                    placeholder="Reading book"
                  />
                </label>
                <label className="text-sm text-zinc-600">
                  Category
                  <select
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2 bg-white"
                    value={habitCategory}
                    onChange={(event) => setHabitCategory(event.target.value)}
                  >
                    <option>Health</option>
                    <option>Study</option>
                    <option>Work</option>
                    <option>Mind</option>
                    <option>Home</option>
                  </select>
                </label>
                <label className="text-sm text-zinc-600">
                  Target (minutes/pages/steps)
                  <input
                    type="number"
                    min={1}
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
                    value={habitTarget}
                    onChange={(event) => setHabitTarget(event.target.value)}
                  />
                </label>
                <label className="text-sm text-zinc-600">
                  Frequency
                  <select
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2 bg-white"
                    value={habitFrequency}
                    onChange={(event) => setHabitFrequency(event.target.value)}
                  >
                    <option>Daily</option>
                    <option>Weekly (Mon-Sun)</option>
                    <option>Custom days</option>
                  </select>
                </label>
                <label className="text-sm text-zinc-600">
                  Start date
                  <input
                    type="date"
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
                    value={habitStartDate}
                    onChange={(event) => setHabitStartDate(event.target.value)}
                  />
                </label>
                <label className="text-sm text-zinc-600">
                  Reminder time
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="time"
                      className="w-full rounded-xl border border-zinc-200 px-3 py-2"
                      value={habitReminderTime}
                      onChange={(event) => setHabitReminderTime(event.target.value)}
                    />
                    <label className="text-xs flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={habitReminderEnabled}
                        onChange={(event) => setHabitReminderEnabled(event.target.checked)}
                      />
                      Enable
                    </label>
                  </div>
                </label>
                <label className="text-sm text-zinc-600">
                  Color
                  <div className="mt-2 flex gap-2">
                    {["#0f766e", "#d97706", "#1d4ed8", "#db2777"].map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`relative h-9 w-9 rounded-full border shadow-sm ring-2 ${
                          habitColor === color ? "border-zinc-900 ring-zinc-900" : "border-white ring-transparent"
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setHabitColor(color)}
                        aria-pressed={habitColor === color}
                        title={`Select ${color}`}
                      >
                        {habitColor === color ? (
                          <span className="absolute inset-0 grid place-items-center text-white text-xs">✓</span>
                        ) : null}
                        <span className="sr-only">{color}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">Selected: {habitColor}</p>
                </label>
                <label className="text-sm text-zinc-600">
                  Icon
                  <select
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2 bg-white"
                    value={habitIcon}
                    onChange={(event) => setHabitIcon(event.target.value)}
                  >
                    <option>Walk</option>
                    <option>Book</option>
                    <option>Water</option>
                    <option>Focus</option>
                  </select>
                </label>
                <div className="md:col-span-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-zinc-500">{saveMessage ?? " "}</p>
                  <button
                    type="button"
                    onClick={handleSaveHabit}
                    disabled={savingHabit}
                    className="px-4 py-2 rounded-full bg-zinc-900 text-white text-sm disabled:opacity-70"
                  >
                    {savingHabit ? "Saving..." : "Save habit"}
                  </button>
                </div>
              </div>
            </section>
            ) : null}
            {activeSection === "calendar" ? (
            <section id="calendar" className="space-y-5">
              <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Calendar / History
              </h2>
              <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="card p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={goPrevMonth}
                        className="h-8 w-8 rounded-full border border-zinc-200 text-sm"
                      >
                        ←
                      </button>
                      <h3 className="font-semibold">
                        {monthNames[viewMonth]} {viewYear}
                      </h3>
                      <button
                        type="button"
                        onClick={goNextMonth}
                        className="h-8 w-8 rounded-full border border-zinc-200 text-sm"
                      >
                        →
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setExportStart(monthStart);
                        setExportEnd(monthEnd);
                        handleExportPdf(monthStart, monthEnd);
                      }}
                      className="text-xs px-3 py-1.5 rounded-full border border-zinc-200"
                    >
                      Export history
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-7 gap-2 text-xs text-zinc-500">
                    {dayNames.map((day) => (
                      <div key={day} className="text-center">
                        {day}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-7 gap-2 text-sm">
                    {calendarCells.map((cell, index) => {
                      if (!cell) {
                        return <div key={`empty-${index}`} className="h-10" />;
                      }
                      const dayLog = logsByDate[cell.dateString];
                      const status = getDayStatus(dayLog);
                      const isSelected = selectedDateString === cell.dateString;
                      return (
                        <button
                          key={cell.dateString}
                          className={`h-10 rounded-xl border ${
                            isSelected
                              ? "border-zinc-900"
                              : "border-zinc-100"
                          } ${
                            status === "done"
                              ? "bg-teal-50 text-teal-700"
                              : status === "missed"
                              ? "bg-rose-50 text-rose-600"
                              : "bg-white text-zinc-700"
                          }`}
                          onClick={() => setSelectedDateString(cell.dateString)}
                        >
                          {cell.day}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="card p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">Day {selectedDay}</h3>
                      <span className="text-xs text-zinc-500">Notes + status</span>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Done habits
                      </div>
                      <ul className="mt-2 text-sm text-zinc-700 space-y-1">
                        {habitCards.filter((habit) => {
                          const log = logsByDate[selectedDateString];
                          return getStatusValue(log?.habitStatus?.[habit.id] as any) === "done";
                        }).length === 0 ? (
                          <li className="text-zinc-400">None</li>
                        ) : (
                          habitCards
                            .filter((habit) => {
                              const log = logsByDate[selectedDateString];
                              return getStatusValue(log?.habitStatus?.[habit.id] as any) === "done";
                            })
                            .map((habit) => <li key={habit.id}>{habit.name}</li>)
                        )}
                      </ul>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Missed habits
                      </div>
                      <ul className="mt-2 text-sm text-zinc-700 space-y-1">
                        {habitCards.filter((habit) => {
                          const log = logsByDate[selectedDateString];
                          return getStatusValue(log?.habitStatus?.[habit.id] as any) === "skip";
                        }).length === 0 ? (
                          <li className="text-zinc-400">None</li>
                        ) : (
                          habitCards
                            .filter((habit) => {
                              const log = logsByDate[selectedDateString];
                              return getStatusValue(log?.habitStatus?.[habit.id] as any) === "skip";
                            })
                            .map((habit) => <li key={habit.id}>{habit.name}</li>)
                        )}
                      </ul>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Not marked
                      </div>
                      <p className="mt-2 text-sm text-zinc-600">
                        {habitCards.some((habit) => {
                          const log = logsByDate[selectedDateString];
                          return getStatusValue(log?.habitStatus?.[habit.id] as any) === "none";
                        })
                          ? habitCards
                              .filter((habit) => {
                                const log = logsByDate[selectedDateString];
                                return getStatusValue(log?.habitStatus?.[habit.id] as any) === "none";
                              })
                              .map((habit) => habit.name)
                              .join(", ")
                          : "No unmarked habits for this day."}
                      </p>
                    </div>
                  </div>
                  <div className="card p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">Export PDF</h3>
                      <button
                        type="button"
                        onClick={handleExportPdf}
                        className="text-xs px-3 py-1.5 rounded-full border border-zinc-200"
                      >
                        Export PDF
                      </button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 text-sm">
                      <label className="text-sm text-zinc-600">
                        From
                        <input
                          type="date"
                          className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
                          value={exportStart}
                          onChange={(event) => setExportStart(event.target.value)}
                        />
                      </label>
                      <label className="text-sm text-zinc-600">
                        To
                        <input
                          type="date"
                          className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
                          value={exportEnd}
                          onChange={(event) => setExportEnd(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setExportStart(selectedDateString);
                          setExportEnd(selectedDateString);
                        }}
                        className="px-3 py-1.5 rounded-full border border-zinc-200"
                      >
                        Use selected day
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setExportStart(monthStart);
                          setExportEnd(monthEnd);
                        }}
                        className="px-3 py-1.5 rounded-full border border-zinc-200"
                      >
                        This month
                      </button>
                      {exportMessage ? (
                        <span className="text-xs text-zinc-500">{exportMessage}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </section>
            ) : null}
            {activeSection === "history" ? (
            <section id="history" className="space-y-5">
              <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                History
              </h2>
              <div className="card p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="text-sm text-zinc-600">
                    Select date
                    <input
                      type="date"
                      className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
                      value={historyDateString}
                      onChange={(event) => setHistoryDateString(event.target.value)}
                    />
                  </label>
                  <div className="text-sm text-zinc-600">
                    Status saved for: <span className="font-medium">{historyDateString}</span>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3 text-sm">
                  <div className="rounded-2xl bg-teal-50 p-4">
                    <div className="text-zinc-500">Done</div>
                    <div className="text-lg font-semibold text-teal-700">
                      {Object.values(historyStatus).filter((value) => value === "done").length}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-4">
                    <div className="text-zinc-500">Skipped</div>
                    <div className="text-lg font-semibold text-amber-700">
                      {Object.values(historyStatus).filter((value) => value === "skip").length}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-zinc-100 p-4">
                    <div className="text-zinc-500">Not marked</div>
                    <div className="text-lg font-semibold text-zinc-800">
                      {Math.max(habitCards.length - Object.values(historyStatus).filter((value) => value !== "none").length, 0)}
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  {habitCards.map((habit) => {
                    const state = historyStatus[habit.id] ?? "none";
                    const isPastDate = historyDateString < todayString;
                    return (
                      <div
                        key={habit.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-100 px-3 py-3"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-900">{habit.name}</div>
                          <div className="text-xs text-zinc-500">
                            {habit.target} {habit.frequency}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <button
                            className={`px-3 py-1.5 rounded-full border ${
                              state === "done"
                                ? "bg-teal-600 text-white border-teal-600"
                                : "border-zinc-200 text-zinc-700"
                            }`}
                            onClick={() =>
                              saveStatusForDate(historyDateString, {
                                ...historyStatus,
                                [habit.id]: "done",
                              })
                            }
                            disabled={isPastDate}
                          >
                            Complete
                          </button>
                          <button
                            className={`px-3 py-1.5 rounded-full border ${
                              state === "skip"
                                ? "bg-amber-500 text-white border-amber-500"
                                : "border-zinc-200 text-zinc-700"
                            }`}
                            onClick={() =>
                              saveStatusForDate(historyDateString, {
                                ...historyStatus,
                                [habit.id]: "skip",
                              })
                            }
                            disabled={isPastDate}
                          >
                            Incomplete
                          </button>
                          <button
                            className="px-3 py-1.5 rounded-full border border-zinc-200 text-zinc-600"
                            onClick={() =>
                              saveStatusForDate(historyDateString, {
                                ...historyStatus,
                                [habit.id]: "none",
                              })
                            }
                            disabled={isPastDate}
                          >
                            Not interested
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {historyDateString < todayString ? (
                  <div className="text-xs text-zinc-500">Past dates are read-only.</div>
                ) : null}
                {logSaving ? <div className="text-xs text-zinc-500">Saving...</div> : null}
              </div>
            </section>
            ) : null}
            {activeSection === "analytics" ? (
            <section id="analytics" className="space-y-5">
              <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Analytics / Reports
              </h2>
              <LineGraph data={trendData} xKey="label" yKey="value" yLabel="30-day completion trend" />
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="card p-5">
                  <h3 className="font-semibold">Weekly completion</h3>
                  <div className="mt-4 flex items-end gap-3 h-40">
                    {weeklyBarsData.map((bar) => (
                      <div key={bar.label} className="flex-1 flex flex-col items-center gap-2">
                        <div
                          className="w-full rounded-t-xl bg-gradient-to-b from-teal-500 to-teal-300"
                          style={{ height: `${bar.value}%` }}
                        />
                        <span className="text-xs text-zinc-500">{bar.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card p-5">
                  <h3 className="font-semibold">Monthly completion</h3>
                  <div className="mt-4 flex items-end gap-4 h-40">
                    {monthlyBarsData.map((bar) => (
                      <div key={bar.label} className="flex-1 flex flex-col items-center gap-2">
                        <div
                          className="w-full rounded-t-xl bg-gradient-to-b from-amber-500 to-amber-300"
                          style={{ height: `${bar.value}%` }}
                        />
                        <span className="text-xs text-zinc-500">{bar.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="card p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Habit-wise stats</h3>
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="text-xs px-3 py-1.5 rounded-full border border-zinc-200"
                  >
                    Export CSV
                  </button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {habitStats.map((habit) => (
                    <div key={habit.id} className="rounded-2xl border border-zinc-100 p-4">
                      <div className="text-sm font-medium">{habit.name}</div>
                      <div className="mt-2 text-xs text-zinc-500">Completion</div>
                      <div className="text-lg font-semibold">{habit.completion}%</div>
                      <div className="mt-2 text-xs text-zinc-500">Longest streak</div>
                      <div className="text-sm font-semibold">{habit.streak} days</div>
                      <div className="mt-2 text-xs text-zinc-500">Missed days</div>
                      <div className="text-sm font-semibold">{habit.missed}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid md:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-2xl bg-teal-50 p-4">
                    <div className="text-zinc-500">Best day</div>
                    <div className="text-lg font-semibold text-teal-700">{weekdayStats.best}</div>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-4">
                    <div className="text-zinc-500">Worst day</div>
                    <div className="text-lg font-semibold text-amber-700">{weekdayStats.worst}</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-100 p-4">
                    <div className="text-zinc-500">Most consistent</div>
                    <div className="text-lg font-semibold text-zinc-800">{mostConsistent}</div>
                  </div>
                </div>
              </div>
            </section>
            ) : null}
            {activeSection === "goals" ? (
            <section id="goals" className="space-y-5">
              <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Goals / Challenges
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="card p-5 space-y-4">
                  <h3 className="font-semibold">Start challenge</h3>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {[7, 14, 21, 30].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => {
                          setChallengeDuration(days);
                        }}
                        className={`px-4 py-2 rounded-full border ${
                          challengeDuration === days
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200"
                        }`}
                        aria-pressed={challengeDuration === days}
                        disabled={challenge?.status === "active"}
                      >
                        {days} day
                      </button>
                    ))}
                  </div>
                  <label className="text-sm text-zinc-600">
                    Habit
                    <select
                      className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2 bg-white"
                      value={challengeHabitId}
                      onChange={(event) => setChallengeHabitId(event.target.value)}
                      disabled={challenge?.status === "active"}
                    >
                      <option value="">Select habit</option>
                      {habitCards
                        .filter((habit) => habit.status === "Active")
                        .map((habit) => (
                          <option key={habit.id} value={habit.id}>
                            {habit.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="text-sm text-zinc-600">
                    Target minutes (daily)
                    <input
                      type="number"
                      min={1}
                      className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
                      value={challengeTarget}
                      onChange={(event) => setChallengeTarget(event.target.value)}
                      disabled={challenge?.status === "active"}
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={startChallenge}
                      className="px-4 py-2 rounded-full bg-zinc-900 text-white text-sm"
                      disabled={challenge?.status === "active"}
                    >
                      Start
                    </button>
                    {challenge ? (
                      <button
                        type="button"
                        onClick={resetChallenge}
                        className="px-4 py-2 rounded-full border border-zinc-200 text-sm"
                      >
                        Clear
                      </button>
                    ) : null}
                    {goalMessage ? <span className="text-xs text-zinc-500">{goalMessage}</span> : null}
                  </div>
                </div>
                <div className="card p-5">
                  <h3 className="font-semibold">Milestones</h3>
                  <div className="mt-4 grid gap-3 text-sm">
                    <div className="flex items-center justify-between rounded-2xl border border-zinc-100 px-4 py-3">
                      <span>10-day streak badge</span>
                      <span className="text-xs text-teal-600">Unlocked</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-zinc-100 px-4 py-3">
                      <span>30-day streak badge</span>
                      <span className="text-xs text-zinc-500">In progress</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Challenge status</h3>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      challenge?.status === "completed"
                        ? "bg-teal-50 text-teal-700"
                        : challenge?.status === "not-completed"
                        ? "bg-rose-50 text-rose-600"
                        : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {challenge ? challenge.status.replace("-", " ") : "no challenge"}
                  </span>
                </div>
                {challenge ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Habit</span>
                      <span className="font-medium">{challenge.habitName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Target</span>
                      <span className="font-medium">{challenge.targetMinutes} min / day</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Duration</span>
                      <span className="font-medium">{challenge.durationDays} days</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Timer</span>
                      <span className="font-mono">{challengeCountdown}</span>
                    </div>
                    <div className="grid gap-2 text-xs">
                      <div className="text-zinc-500">Daily check-in (today)</div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          className="w-28 rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                          value={challengeTodayMinutes}
                          onChange={(event) => setChallengeTodayMinutes(event.target.value)}
                          disabled={challenge.status !== "active"}
                        />
                        <button
                          type="button"
                          onClick={logTodayMinutes}
                          className="px-3 py-2 rounded-full border border-zinc-200 text-sm"
                          disabled={challenge.status !== "active"}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={markTodayComplete}
                          className="px-3 py-2 rounded-full border border-zinc-200 text-sm"
                          disabled={challenge.status !== "active"}
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          onClick={markTodayNotComplete}
                          className="px-3 py-2 rounded-full border border-zinc-200 text-sm"
                          disabled={challenge.status !== "active"}
                        >
                          Not complete
                        </button>
                        <span className="text-zinc-500">
                          {challenge.daily[todayString] != null
                            ? `Logged: ${challenge.daily[todayString]} min`
                            : "No log today"}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Days</div>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        {(() => {
                          const rows: string[] = [];
                          let cursor = challenge.startDate;
                          let guard = 0;
                          while (cursor <= challenge.endDate && guard < 400) {
                            rows.push(cursor);
                            cursor = dateStringAddDays(cursor, 1);
                            guard += 1;
                          }
                          return rows.map((day) => {
                            const logged = challenge.daily[day] ?? 0;
                            const ok = logged >= challenge.targetMinutes;
                            return (
                              <div
                                key={day}
                                className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                                  ok ? "border-teal-100 bg-teal-50 text-teal-700" : "border-zinc-100 text-zinc-600"
                                }`}
                              >
                                <span>{day}</span>
                                <span>{ok ? "Complete" : "Not complete"}</span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No active challenge. Start one to track progress.</p>
                )}
              </div>
            </section>
            ) : null}
            {activeSection === "reminders" ? (
            <section id="reminders" className="space-y-5">
              <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Reminders
              </h2>
              <div className="card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Reminder list</h3>
                  <button
                    type="button"
                    onClick={() => handleReminderAction("Add reminder")}
                    className="text-xs px-3 py-1.5 rounded-full border border-zinc-200"
                  >
                    Add reminder
                  </button>
                </div>
                {[
                  { habit: "Morning Walk", time: "6:30 AM" },
                  { habit: "Read Book", time: "9:00 PM" },
                  { habit: "Meditation", time: "7:00 AM" },
                ].map((item) => (
                  <div
                    key={item.habit}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-100 px-4 py-3 text-sm"
                  >
                    <div>
                      <div className="font-medium">{item.habit}</div>
                      <div className="text-xs text-zinc-500">{item.time}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => handleReminderAction(`Snooze ${item.habit}`)}
                        className="px-3 py-1.5 rounded-full border border-zinc-200"
                      >
                        Snooze
                      </button>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" defaultChecked className="h-4 w-4" />
                        Enabled
                      </label>
                    </div>
                  </div>
                ))}
                {reminderMessage ? (
                  <div className="rounded-2xl bg-zinc-50 p-4 text-xs text-zinc-600">
                    {reminderMessage}
                  </div>
                ) : null}

                <div className="rounded-2xl bg-zinc-50 p-4 text-sm">
                  <div className="font-medium text-zinc-700">Notification preferences</div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" defaultChecked className="h-4 w-4" />
                      Push (web)
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="h-4 w-4" />
                      Email (optional)
                    </label>
                  </div>
                </div>
              </div>
            </section>
            ) : null}
            {activeSection === "journal" ? (
            <section id="journal" className="space-y-5">
              <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Journal / Notes
              </h2>
              <div className="card p-5 grid gap-4 md:grid-cols-[1fr_0.4fr]">
                <label className="text-sm text-zinc-600">
                  Daily reflection note
                  <textarea
                    className="mt-2 w-full min-h-[140px] rounded-2xl border border-zinc-200 px-3 py-2"
                    placeholder="Write about the day..."
                    value={journalText}
                    onChange={(event) => setJournalText(event.target.value)}
                  />
                </label>
                <div className="space-y-4">
                  <div>
                    <div className="text-sm text-zinc-600">Mood</div>
                    <div className="mt-2 flex gap-2 text-lg">
                      {[
                        { id: "happy", label: "Happy", emoji: "😊" },
                        { id: "angry", label: "Angry", emoji: "😠" },
                        { id: "rest", label: "Rest", emoji: "😌" },
                      ].map((mood) => (
                        <button
                          key={mood.id}
                          type="button"
                          onClick={() => setSelectedMood(mood.id as "happy" | "angry" | "rest")}
                          className={`h-10 w-10 rounded-full border ${
                            selectedMood === mood.id
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-200"
                          }`}
                          aria-pressed={selectedMood === mood.id}
                          title={mood.label}
                        >
                          {mood.emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-zinc-600">Linked habits</div>
                    <div className="mt-2 text-xs text-zinc-500">
                      Morning Walk, Read Book, Meditation
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleJournalSave}
                    className="px-4 py-2 rounded-full bg-zinc-900 text-white text-sm"
                  >
                    Save note
                  </button>
                  {journalMessage ? (
                    <div className="text-xs text-zinc-500">{journalMessage}</div>
                  ) : null}
                </div>
              </div>
              <div className="card p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Mood history</h3>
                  <span className="text-xs text-zinc-500">Latest 30 days</span>
                </div>
                <div className="mt-4 grid gap-2 text-sm">
                  {(() => {
                    const rows: { date: string; mood?: string; note?: string }[] = [];
                    let cursor = dateStringAddDays(todayString, -29);
                    let guard = 0;
                    while (cursor <= todayString && guard < 40) {
                      const log = analyticsLogs[cursor];
                      rows.push({ date: cursor, mood: log?.mood, note: log?.note });
                      cursor = dateStringAddDays(cursor, 1);
                      guard += 1;
                    }
                    return rows.reverse().map((row) => (
                      <div
                        key={row.date}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-100 px-3 py-2"
                      >
                        <span className="text-zinc-500">{row.date}</span>
                        <span className="font-medium">
                          {row.mood === "happy" ? "😊 Happy" : row.mood === "angry" ? "😠 Angry" : row.mood === "rest" ? "😌 Rest" : "No mood"}
                        </span>
                        <span className="text-xs text-zinc-400 max-w-[360px] truncate">
                          {row.note ?? ""}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </section>
            ) : null}
            {activeSection === "profile" ? (
            <section id="profile" className="space-y-5">
              <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Profile
              </h2>
              <div className="card p-5 grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 flex items-center gap-4">
                  <div className="relative h-16 w-16 rounded-full bg-zinc-100 border border-zinc-200 overflow-hidden flex items-center justify-center text-sm text-zinc-500">
                    {photoPreview || user?.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoPreview ?? user?.photoURL ?? ""} alt="Profile" className="h-full w-full object-cover" />
                    ) : (
                      "No Photo"
                    )}
                    <label className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-zinc-900 text-white text-xs grid place-items-center cursor-pointer">
                      ✎
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => handlePhotoChange(event.target.files?.[0])}
                      />
                    </label>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Signed in as</div>
                    <div className="text-lg font-semibold text-zinc-900">
                      {user?.displayName ?? "Guest"}
                    </div>
                    <div className="text-sm text-zinc-600">
                      {user?.email ?? user?.providerData?.[0]?.email ?? "Email not available"}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {photoUploading ? <span className="text-xs text-zinc-500">Uploading...</span> : null}
                      {photoMessage ? <span className="text-xs text-emerald-600">{photoMessage}</span> : null}
                      {photoError ? <span className="text-xs text-rose-600">{photoError}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="px-4 py-2 rounded-full bg-zinc-900 text-white text-sm"
                  >
                    Logout
                  </button>
                </div>
                <div className="card p-4 md:col-span-2">
                  <div className="grid gap-3 md:grid-cols-2 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Name</div>
                      <div className="mt-1 font-semibold text-zinc-900">
                        {user?.displayName ?? "Guest"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Email</div>
                      <div className="mt-1 font-semibold text-zinc-900">
                        {user?.email ?? user?.providerData?.[0]?.email ?? "Not logged in"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            ) : null}
            {activeSection === "settings" ? (
            <section id="settings" className="space-y-5">
              <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Settings
              </h2>
              <div className="card p-5 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm text-zinc-600">
                    Theme
                    <select className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2 bg-white">
                      <option>Light</option>
                      <option>Dark</option>
                    </select>
                  </label>
                  <label className="text-sm text-zinc-600">
                    Timezone
                    <select className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2 bg-white">
                      <option>Asia/Kathmandu</option>
                      <option>America/New York</option>
                      <option>Europe/London</option>
                    </select>
                  </label>
                  <label className="text-sm text-zinc-600">
                    Week starts on
                    <select className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2 bg-white">
                      <option>Sunday</option>
                      <option>Monday</option>
                    </select>
                  </label>
                  <label className="text-sm text-zinc-600">
                    Backup / export
                    <select className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2 bg-white">
                      <option>Export CSV</option>
                      <option>Export JSON</option>
                    </select>
                  </label>
                </div>
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <div className="font-medium text-rose-700">Danger zone</div>
                  <p className="text-sm text-rose-600 mt-1">
                    Deleting your account removes all habits and history.
                  </p>
                  <button className="mt-3 px-4 py-2 rounded-full bg-rose-600 text-white text-sm">
                    Delete account
                  </button>
                </div>
              </div>
            </section>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
