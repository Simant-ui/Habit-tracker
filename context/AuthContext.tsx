"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  setPersistence,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  User
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { upsertUserProfile } from "@/lib/firestore";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  signupWithEmail: (email: string, password: string) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  sendVerification: (user: User) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      // End session when browser is closed.
      await setPersistence(auth, browserSessionPersistence);
      const unsub = onAuthStateChanged(auth, async (currentUser) => {
        if (!isMounted) return;
        setUser(currentUser);
        setLoading(false);
        if (currentUser) {
          await upsertUserProfile(currentUser.uid, {
            name: currentUser.displayName ?? null,
            email: currentUser.email ?? null,
            photoURL: currentUser.photoURL ?? null,
          });
          // No default habits for new users; let them add their own.
        }
      });

      return unsub;
    };

    let unsubscribe: (() => void) | undefined;
    init().then((unsub) => {
      unsubscribe = unsub;
    });

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    provider.addScope("email");
    provider.addScope("profile");
    await signInWithPopup(auth, provider);
  };

  const signupWithEmail = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
  };

  const loginWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const sendVerification = async (currentUser: User) => {
    await sendEmailVerification(currentUser);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const value = useMemo(
    () => ({ user, loading, loginWithGoogle, signupWithEmail, loginWithEmail, sendVerification, logout }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
