import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Habit Tracker",
  description: "Direct dashboard (no auth)",
};

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${fraunces.variable} antialiased`}>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <div className="flex-1">{children}</div>
            <footer className="text-xs text-zinc-500 text-center py-6">
              Developer- Simant Shrestha | Email: shrestha.finance082@gmail.com
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
