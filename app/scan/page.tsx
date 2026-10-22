import Link from "next/link";
import { MATCH_LABELS } from "@/core/compare";
import { type GroupKind, type ScanGroup, type ScanPair, ScanRepository } from "@/data/scanRepo";
import { ensureDatabase } from "@/data/setup";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { PixelBadge } from "../PixelBadge";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

type Stats = {
  exactPairs: number;
  exactByRelation: Record<string, number>;
  similarPairs: number;
  exactGroups: number;
  badgesInExactGroups: number;
  similarGroups: number;
  badgesInSimilarGroups: number;
};

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ kind?: string; page?: string }> }) {
  const sp = await searchParams;
  const kind: GroupKind = sp.kind === "similar" ? "similar" : "exact";
  const page = Math.max(1, Number(sp.page) || 1);

  // First run (no database yet): SyncBanner shows the setup dialog instead.
  if ((await ensureDatabase({ create: false })).state !== "ready") return null;

  const repo = new ScanRepository();
  const run = await repo.latestRun();
  if (!run) {
    return (
      <p className="empty">
        Todavía no hay un escaneo. Tocá <strong>Actualizar BD</strong> arriba para analizar toda la base.
      </p>
    );
  }
  const stats = run.stats as Stats;
  const { total, groups } = await repo.groups(run.id, kind, (page - 1) * PAGE_SIZE, PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const t = run.thresholds;

  const n = (v: number) => v.toLocaleString("es-AR");

  return (
    <>
      <div className="panel scan-summary">
        <div className="stats">
          <Stat value={n(stats.exactGroups)} label={`grupos de duplicados exactos · ${n(stats.badgesInExactGroups)} placas`} />
          <Stat value={n(stats.similarGroups)} label={`grupos de similares · ${n(stats.badgesInSimilarGroups)} placas`} />
          <Stat value={n(stats.exactPairs)} label="pares exactos" />
          <Stat value={n(stats.similarPairs)} label="pares similares" />
        </div>
        <span className="meta">
          Último escaneo:{" "}
          {run.finishedAt.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", hourCycle: "h23" })} · diseño ≥{" "}
          {Math.round(t.design * 100)}%, prefiltro dHash ≤ {t.dhash}, silueta ≤ {t.silhouette} · pares exactos:{" "}
          {Object.entries(stats.exactByRelation)
            .map(([r, v]) => `${n(v)} ${MATCH_LABELS[r as keyof typeof MATCH_LABELS].toLowerCase()}`)
            .join(", ")}
        </span>
      </div>

      <nav className="tabs">
        <Link href="/scan?kind=exact" className={kind === "exact" ? "active" : ""}>
          Duplicados exactos <span className="count">{n(stats.exactGroups)}</span>
        </Link>
        <Link href="/scan?kind=similar" className={kind === "similar" ? "active" : ""}>
          Similares <span className="count">{n(stats.similarGroups)}</span>
        </Link>
      </nav>

      {kind === "similar" && (
        <p className="status">
          Cada grupo tiene una placa central (la primera, con borde naranja) y las placas que se parecen directamente a ella.
          Las placas que ya son duplicados exactos entre sí se listan en la otra pestaña.
        </p>
      )}

      <div className="groups">
        {groups.map((g) => (
          <GroupCard key={g.groupId} group={g} kind={kind} />
        ))}
      </div>

      <Pager kind={kind} page={page} pages={pages} />
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function relationTo(center: number, id: number, pairs: ScanPair[]) {
  return pairs.find((p) => (p.a === center && p.b === id) || (p.b === center && p.a === id));
}

/** The badge code as the panel shows it: the file name without its extension. */
const code = (fileName: string) => fileName.replace(/\.(gif|png)$/i, "");

function GroupCard({ group, kind }: { group: ScanGroup; kind: GroupKind }) {
  const center = group.members[0];
  return (
    <div className="panel group">
      <div className="group-head">
        <span className="group-title">Grupo de {group.members.length} placas</span>
        <span className="meta">
          {kind === "similar" && <>centro: {code(center.fileName)} · </>}
          {group.pairs.length} {group.pairs.length === 1 ? "par" : "pares"}
        </span>
      </div>
      <div className="members">
        {group.members.map((m, i) => {
          const p = i === 0 ? undefined : relationTo(center.id, m.id, group.pairs);
          return (
            <div key={m.id} className={`tile${i === 0 && kind === "similar" ? " center" : ""}`} title={m.fileName}>
              <PixelBadge src={`/api/badges/${m.id}/image`} width={m.width} height={m.height} scale={2} box={88} title={m.fileName} />
              <span className="tile-code">{code(m.fileName)}</span>
              <span className="meta">
                {m.width}x{m.height}
                {m.animated ? " · animada" : ""}
              </span>
              {p &&
                (p.relation === "similar" ? (
                  <span className="tag similar">{Math.round((p.design ?? 0) * 100)}%</span>
                ) : (
                  <span className={`tag ${p.relation}`}>{MATCH_LABELS[p.relation]}</span>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Pager({ kind, page, pages }: { kind: GroupKind; page: number; pages: number }) {
  if (pages <= 1) return null;
  const href = (p: number) => `/scan?kind=${kind}&page=${p}`;
  return (
    <nav className="pager">
      {page > 1 ? (
        <Link href={href(page - 1)} className="btn small">
          <ChevronLeftIcon size={14} /> Anterior
        </Link>
      ) : (
        <span />
      )}
      <span className="status">
        Página {page} de {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="btn small">
          Siguiente <ChevronRightIcon size={14} />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
