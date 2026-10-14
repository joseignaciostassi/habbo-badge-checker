import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Badge Checker",
  description: "Detecta placas de Habbo duplicadas o similares antes de subirlas.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Badge Checker</Link>
          <nav>
            <Link href="/">Verificar</Link>
            <Link href="/scan">Escaneo</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
