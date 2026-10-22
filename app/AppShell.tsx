"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BadgeIcon, GridIcon, PanelLeftIcon, SearchIcon, SlidersIcon } from "./icons";

const PAGES = [
  {
    href: "/",
    label: "Verificar",
    Icon: SearchIcon,
    title: "Verificar placa",
    description: "Subí una placa para ver si ya existe una idéntica o parecida en la carpeta.",
  },
  {
    href: "/scan",
    label: "Escaneo",
    Icon: GridIcon,
    title: "Escaneo de la base",
    description: "Grupos de placas duplicadas o parecidas que ya existen en la carpeta.",
  },
  {
    href: "/calibrate",
    label: "Calibración",
    Icon: SlidersIcon,
    title: "Calibración",
    description: "Etiquetá pares de placas para estimar la precisión de cada umbral de diseño.",
  },
];

/** Breakpoint below which the sidebar is an overlay instead of a column (same as globals.css). */
const NARROW = "(max-width: 767px)";

/**
 * Sidebar + page header around every page, like the admin panel. The collapsed state lives on
 * <html data-sidebar> (set before paint by the script in layout.tsx) and in localStorage.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // overlay on narrow screens
  const page = PAGES.find((p) => p.href === pathname) ?? PAGES.find((p) => p.href !== "/" && pathname.startsWith(p.href)) ?? PAGES[0];

  useEffect(() => setOpen(false), [pathname]);

  const toggle = () => {
    if (window.matchMedia(NARROW).matches) {
      setOpen((o) => !o);
      return;
    }
    const html = document.documentElement;
    const collapse = html.dataset.sidebar !== "collapsed";
    if (collapse) html.dataset.sidebar = "collapsed";
    else delete html.dataset.sidebar;
    try {
      localStorage.setItem("sidebar", collapse ? "collapsed" : "expanded");
    } catch {}
  };

  return (
    <div className="shell">
      <aside className={`sidebar${open ? " open" : ""}`}>
        <Link href="/" className="sidebar-brand">
          <BadgeIcon size={18} />
          <span className="sidebar-label">Badge Checker</span>
        </Link>
        <nav className="sidebar-nav">
          {PAGES.map(({ href, label, Icon }) => (
            <Link key={href} href={href} title={label} className={`sidebar-link${page.href === href ? " active" : ""}`}>
              <Icon />
              <span className="sidebar-label">{label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}

      <div className="shell-main">
        <header className="page-header">
          <button type="button" className="icon-btn" onClick={toggle} aria-label="Mostrar u ocultar la barra lateral">
            <PanelLeftIcon />
          </button>
          <h1>{page.title}</h1>
          <p>{page.description}</p>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
