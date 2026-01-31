"use client";

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  collection,
  getDocs,
  writeBatch,
  updateDoc,
  deleteDoc,
  orderBy,
  query,
  startAt,
  endAt
} from "firebase/firestore";
import { db } from "./firebase";
import { commonHabitsSeed } from "./seed";
import type { DayLog, Habit, UserProfile } from "./types";

export function userDocRef(uid: string) {
  return doc(db, "users", uid);
}

export function habitsColRef(uid: string) {
  return collection(db, "users", uid, "habits");
}

export function logsColRef(uid: string) {
  return collection(db, "users", uid, "logs");
}

export async function upsertUserProfile(uid: string, profile: Omit<UserProfile, "createdAt" | "lastLoginAt">) {
  const ref = userDocRef(uid);
  const snap = await getDoc(ref);

  const now = Date.now();
  if (!snap.exists()) {
    const data: UserProfile = {
      ...profile,
      createdAt: now,
      lastLoginAt: now
    };
    await setDoc(ref, data, { merge: true });
  } else {
    await setDoc(ref, { ...profile, lastLoginAt: now }, { merge: true });
  }
}

export async function listHabits(uid: string): Promise<Habit[]> {
  const snap = await getDocs(habitsColRef(uid));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Habit, "id">) }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function createHabit(uid: string, habit: Habit) {
  await setDoc(doc(db, "users", uid, "habits", habit.id), habit, { merge: true });
}

export async function updateHabit(uid: string, habitId: string, patch: Partial<Habit>) {
  await setDoc(doc(db, "users", uid, "habits", habitId), patch as any, { merge: true });
}

export async function deleteHabit(uid: string, habitId: string) {
  await deleteDoc(doc(db, "users", uid, "habits", habitId));
}

export async function getDayLog(uid: string, dateString: string): Promise<DayLog | null> {
  const ref = doc(db, "users", uid, "logs", dateString);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as DayLog;
}

export async function upsertDayLog(uid: string, log: DayLog) {
  const ref = doc(db, "users", uid, "logs", log.dateString);
  await setDoc(
    ref,
    {
      ...log,
      updatedAt: Date.now()
    },
    { merge: true }
  );
}

export async function getLogsInRange(uid: string, startDateString: string, endDateString: string): Promise<DayLog[]> {
  // log doc ids are yyyy-mm-dd => lexicographic sortable
  const q = query(
    logsColRef(uid),
    orderBy("__name__"),
    startAt(startDateString),
    endAt(endDateString)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as DayLog);
}

export async function batchCreateHabitsIfEmpty(uid: string, habits: Habit[]) {
  const existing = await getDocs(habitsColRef(uid));
  if (!existing.empty) return;

  const batch = writeBatch(db);
  for (const h of habits) {
    batch.set(doc(db, "users", uid, "habits", h.id), h, { merge: true });
  }
  await batch.commit();

  // also ensure user doc exists (optional)
  await setDoc(userDocRef(uid), { seededAt: serverTimestamp() }, { merge: true });
}

export async function seedCommonHabitsIfEmpty(uid: string) {
  await batchCreateHabitsIfEmpty(uid, commonHabitsSeed());
}
