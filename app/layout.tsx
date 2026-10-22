import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "./AppShell";
import "./globals.css";
import { SyncBanner } from "./SyncBanner";

export const metadata: Metadata = {
  title: "Badge Checker",
  description: "Detecta placas de Habbo duplicadas o similares antes de subirlas.",
};

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

// Applies the remembered collapsed sidebar before the first paint, so it does not flash open.
const sidebarScript = `try{if(localStorage.getItem("sidebar")==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: sidebarScript }} />
      </head>
      <body>
        <AppShell>
          <SyncBanner />
          {children}
        </AppShell>
      </body>
    </html>
  );
}
