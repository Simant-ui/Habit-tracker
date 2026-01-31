"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/reports", label: "Reports" },
  { href: "/habits", label: "Habits" },
  { href: "/profile", label: "Profile" }
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-20 bg-zinc-50/80 backdrop-blur border-b border-zinc-100">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          Habit Tracker
        </Link>

        <nav className="flex items-center gap-2 flex-wrap justify-end">
          {nav.map((i) => {
            const active = pathname === i.href;
            return (
              <Link
                key={i.href}
                href={i.href}
                className={[
                  "px-3 py-1.5 rounded-full text-sm border",
                  active
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white border-zinc-200 hover:bg-zinc-100"
                ].join(" ")}
              >
                {i.label}
              </Link>
            );
          })}

          <button
            onClick={onLogout}
            className="px-3 py-1.5 rounded-full text-sm border bg-white border-zinc-200 hover:bg-zinc-100"
          >
            Logout
          </button>
        </nav>
      </div>
    </header>
  );
}
