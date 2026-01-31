"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { auth } from "@/lib/firebase";
import { sendPasswordResetEmail, updateProfile } from "firebase/auth";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, signupWithEmail, loginWithEmail, sendVerification, logout } = useAuth();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user && user.emailVerified) {
      router.replace("/dashboard");
    }
  }, [loading, router, user]);

  const handleSubmit = async () => {
    setError(null);
    setMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Email अनिवार्य छ।");
      return;
    }
    if (!trimmedEmail.endsWith("@gmail.com")) {
      setError("Gmail मात्र प्रयोग गर्नुहोस्।");
      return;
    }
    if (!password) {
      setError("Password अनिवार्य छ।");
      return;
    }
    if (password.length < 6) {
      setError("Password कम्तिमा 6 अक्षर हुनुपर्छ।");
      return;
    }
    if (mode === "signup" && password !== confirmPassword) {
      setError("Confirm password मिलेन।");
      return;
    }

    if (mode === "signup" && !name.trim()) {
      setError("Name अनिवार्य छ।");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "signup") {
        await signupWithEmail(trimmedEmail, password);
        if (auth.currentUser && name.trim()) {
          await updateProfile(auth.currentUser, { displayName: name.trim() });
        }
        if (auth.currentUser) {
          await sendVerification(auth.currentUser);
        }
        setMessage("Verification link पठाइयो। Email confirm गरेर login गर्नुहोस्।");
        await logout();
      } else {
        await loginWithEmail(trimmedEmail, password);
        if (auth.currentUser && !auth.currentUser.emailVerified) {
          await sendVerification(auth.currentUser);
          setMessage("Email verify गरिएको छैन। Verification link फेरि पठाइयो।");
          await logout();
          return;
        }
      }
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async () => {
    setResetError(null);
    setResetMessage(null);

    const targetEmail = (resetEmail || email).trim().toLowerCase();
    if (!targetEmail) {
      setResetError("Email required.");
      return;
    }
    if (!targetEmail.endsWith("@gmail.com")) {
      setResetError("Gmail मात्र प्रयोग गर्नुहोस्।");
      return;
    }

    setResetSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, targetEmail);
      setResetMessage("Reset link email मा पठाइयो।");
    } catch (err: any) {
      setResetError(err?.message ?? "Password reset failed.");
    } finally {
      setResetSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="card w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
            {mode === "login" ? "Login" : "Create Account"}
          </h1>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`px-3 py-1.5 rounded-full border ${
                mode === "login" ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-200"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`px-3 py-1.5 rounded-full border ${
                mode === "signup" ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-200"
              }`}
            >
              Create account
            </button>
          </div>
        </div>

        <p className="text-sm text-zinc-600">
          Email verification link पठाइन्छ। Confirm भएपछि मात्र login हुन्छ।
        </p>

        <label className="text-sm text-zinc-600">
          Gmail
          <input
            type="email"
            className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="example@gmail.com"
          />
        </label>
        {mode === "signup" ? (
          <label className="text-sm text-zinc-600">
            Name
            <input
              type="text"
              className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
            />
          </label>
        ) : null}
        <label className="text-sm text-zinc-600">
          Password
          <input
            type="password"
            className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Create password"
          />
        </label>
        {mode === "login" ? (
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => setShowReset((prev) => !prev)}
              className="text-zinc-600 hover:text-zinc-900"
            >
              Forgot password?
            </button>
            {showReset ? (
              <span className="text-zinc-400">Reset link via email</span>
            ) : null}
          </div>
        ) : null}
        {mode === "login" && showReset ? (
          <div className="rounded-2xl border border-zinc-200 p-3 space-y-2">
            <label className="text-sm text-zinc-600">
              Reset email
              <input
                type="email"
                className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                placeholder="example@gmail.com"
              />
            </label>
            {resetError ? <div className="text-xs text-rose-600">{resetError}</div> : null}
            {resetMessage ? <div className="text-xs text-emerald-600">{resetMessage}</div> : null}
            <button
              type="button"
              onClick={handlePasswordReset}
              className="w-full px-4 py-2 rounded-full border border-zinc-200 text-sm"
              disabled={resetSubmitting}
            >
              {resetSubmitting ? "Sending..." : "Send reset link"}
            </button>
          </div>
        ) : null}
        {mode === "signup" ? (
          <label className="text-sm text-zinc-600">
            Confirm password
            <input
              type="password"
              className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
            />
          </label>
        ) : null}

        {error ? <div className="text-xs text-rose-600">{error}</div> : null}
        {message ? <div className="text-xs text-emerald-600">{message}</div> : null}

        <button
          type="button"
          onClick={handleSubmit}
          className="w-full px-4 py-2 rounded-full bg-zinc-900 text-white text-sm"
          disabled={submitting}
        >
          {submitting ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
        </button>
      </div>
    </main>
  );
}
