import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarCheck, ClipboardCheck, ClipboardList, Percent, QrCode, ScanLine, TrendingUp, Users } from "lucide-react";
import { supabase } from "../lib/supabase";
import PageHeader from "../components/PageHeader";
import { fmtDate, goudiStreaks, loadStats, type StatsData } from "../lib/stats";

type Upcoming = {
  id: string;
  name: string;
  location: string | null;
  start_datetime: string;
  activity_type_id: string | null;
};

const GREEN = "#18794e";
const RED = "#b42318";
const ORANGE = "#b54708";
const GRAY = "var(--muted)";
const LINE = "var(--line-soft)";

const rateColor = (r: number) => (r >= 70 ? GREEN : r >= 40 ? ORANGE : RED);
const dateTime = (v: string) => new Date(v).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
const fullName = (m: { first_name: string; last_name: string }) => `${m.last_name} ${m.first_name}`;
const HOURS_3 = 3 * 3600 * 1000;

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ height: 8, borderRadius: 99, background: "#eef2f6", overflow: "hidden" }}>
      <div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, value))}%`, height: "100%", background: color }} />
    </div>
  );
}

function Box({ title, link, children }: { title: string; link?: { to: string; label: string }; children: ReactNode }) {
  return (
    <div className="panel" style={{ margin: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
        {link && (
          <Link to={link.to} style={{ fontSize: 13, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>
            {link.label} →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${LINE}` }}>
      <div style={{ minWidth: 0 }}>{left}</div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

const Small = ({ children, color = GRAY }: { children: ReactNode; color?: string }) => (
  <div style={{ fontSize: 12, color, marginTop: 2 }}>{children}</div>
);

export default function Dashboard() {
  const [data, setData] = useState<StatsData | null>(null);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [typeNames, setTypeNames] = useState<Map<string, string>>(new Map());
  const [inactive, setInactive] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    loadStats().then(setData).catch((e) => setError(e.message));

    const since = new Date(Date.now() - HOURS_3).toISOString();
    supabase
      .from("activities")
      .select("id,name,location,start_datetime,activity_type_id")
      .neq("status", "annulée")
      .gte("start_datetime", since)
      .order("start_datetime")
      .limit(5)
      .then(({ data: rows }) => setUpcoming((rows as Upcoming[]) || []));

    supabase
      .from("activity_types")
      .select("id,name")
      .then(({ data: rows }) =>
        setTypeNames(new Map(((rows || []) as { id: string; name: string }[]).map((t) => [t.id, t.name])))
      );

    supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("status", "inactive")
      .then(({ count }) => setInactive(count || 0));
  }, []);

  const v = useMemo(() => {
    if (!data) return null;

    const held = data.acts.filter((a) => a.marked).sort((a, b) => a.start.localeCompare(b.start));
    const pct = (list: typeof held) => {
      const total = list.reduce((s, a) => s + a.total, 0);
      const present = list.reduce((s, a) => s + a.present, 0);
      return total ? Math.round((present / total) * 100) : null;
    };

    const now = new Date();
    const thisKey = monthKey(now);
    const prevKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const thisMonth = held.filter((a) => monthKey(new Date(a.start)) === thisKey);
    const lastMonth = held.filter((a) => monthKey(new Date(a.start)) === prevKey);

    const toFix = data.acts
      .filter((a) => !a.marked && new Date(a.start).getTime() < Date.now() - HOURS_3)
      .sort((a, b) => b.start.localeCompare(a.start));

    const streaks = goudiStreaks(data)
      .filter((s) => s.current >= 3)
      .sort((a, b) => b.current - a.current);

    const assidus = data.members
      .map((m) => {
        const p = held.filter((a) => data.status.get(`${a.id}|${m.id}`) === "Présent").length;
        return { m, p, rate: held.length ? Math.round((p / held.length) * 100) : 0 };
      })
      .sort((a, b) => b.p - a.p || a.m.last_name.localeCompare(b.m.last_name))
      .slice(0, 5);

    return {
      held,
      global: pct(held),
      month: pct(thisMonth),
      prevMonth: pct(lastMonth),
      monthCount: thisMonth.length,
      toFix,
      streaks,
      assidus,
      last: held.length ? held[held.length - 1] : null,
      recent: held.slice(-8),
    };
  }, [data]);

  if (error) return <div className="error-box">{error}</div>;
  if (!data || !v) return <div className="center-screen">Chargement…</div>;

  const delta = v.month !== null && v.prevMonth !== null ? v.month - v.prevMonth : null;
  const cards = [
    {
      label: "Membres actifs",
      value: data.members.length,
      sub: `${inactive} inactif${inactive > 1 ? "s" : ""}`,
      Icon: Users,
      color: undefined as string | undefined,
    },
    {
      label: "Présence globale",
      value: v.global === null ? "—" : `${v.global}%`,
      sub: `${v.held.length} appel${v.held.length > 1 ? "s" : ""} effectué${v.held.length > 1 ? "s" : ""}`,
      Icon: Percent,
      color: v.global === null ? undefined : rateColor(v.global),
    },
    {
      label: "Présence ce mois-ci",
      value: v.month === null ? "—" : `${v.month}%`,
      sub:
        delta === null
          ? v.monthCount
            ? `${v.monthCount} appel${v.monthCount > 1 ? "s" : ""}`
            : "Aucun appel ce mois-ci"
          : `${delta >= 0 ? "+" : ""}${delta} pts vs mois dernier`,
      Icon: TrendingUp,
      color: delta === null ? undefined : delta >= 0 ? GREEN : RED,
    },
    {
      label: "Dernière activité",
      value: v.last ? `${v.last.present}/${v.last.total}` : "—",
      sub: v.last ? v.last.name : "Aucun appel effectué",
      Icon: CalendarCheck,
      color: undefined,
    },
    {
      label: "Appels à régulariser",
      value: v.toFix.length,
      sub: "activités passées sans présences",
      Icon: ClipboardList,
      color: v.toFix.length ? RED : GREEN,
    },
    {
      label: "Membres à relancer",
      value: v.streaks.length,
      sub: "3 GOUDI ou plus d'affilée",
      Icon: AlertTriangle,
      color: v.streaks.length ? RED : GREEN,
    },
  ];

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description="Ce qui est à faire, ce qui arrive et comment évolue la présence."
      />

      <div className="stats-grid">
        {cards.map(({ label, value, sub, Icon, color }) => (
          <div className="stat-card" key={label}>
            <div>
              <span>{label}</span>
              <strong style={color ? { color } : undefined}>{value}</strong>
              <Small>{sub}</Small>
            </div>
            <Icon size={28} />
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginTop: 16 }}>
        {[
          { to: "/scan", label: "Scanner l'entrée", sub: "Pointer les membres avec leur carte QR", Icon: ScanLine },
          { to: "/attendance", label: "Faire l'appel", sub: "Marquer les présences à la main", Icon: ClipboardCheck },
          { to: "/members", label: "Cartes de membre", sub: "Afficher et envoyer le QR d'un membre", Icon: QrCode },
        ].map(({ to, label, sub, Icon }) => (
          <Link key={to} to={to} className="panel" style={{ margin: 0, display: "flex", alignItems: "center", gap: 14, textDecoration: "none", color: "inherit" }}>
            <Icon size={30} color="var(--brand)" />
            <div>
              <div style={{ fontWeight: 800 }}>{label}</div>
              <div className="muted" style={{ fontSize: 13 }}>{sub}</div>
            </div>
          </Link>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16 }}>
        <Box title="Prochaines activités" link={{ to: "/activities", label: "Toutes les activités" }}>
          {upcoming.length === 0 && <div className="empty">Aucune activité prévue.</div>}
          {upcoming.map((a) => {
            const started = new Date(a.start_datetime).getTime() < Date.now();
            return (
              <Row
                key={a.id}
                left={
                  <>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    <Small>
                      {dateTime(a.start_datetime)}
                      {a.location ? ` · ${a.location}` : ""}
                    </Small>
                  </>
                }
                right={
                  started ? (
                    <span className="badge">En cours</span>
                  ) : (
                    <span className="badge">{typeNames.get(a.activity_type_id || "") || "—"}</span>
                  )
                }
              />
            );
          })}
        </Box>

        <Box title="Dernière activité avec appel" link={{ to: "/statistics", label: "Statistiques" }}>
          {!v.last && <div className="empty">Aucun appel effectué pour le moment.</div>}
          {v.last && (
            <>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{v.last.name}</div>
              <Small>
                {v.last.typeName} · {fmtDate(v.last.start)}
              </Small>
              <div className="att-counts" style={{ margin: "12px 0" }}>
                <span className="c-p">Présents {v.last.present}</span>
                <span className="c-a">Absents {v.last.absent}</span>
                <span>Excusés {v.last.excused}</span>
              </div>
              <Bar value={v.last.rate} color={rateColor(v.last.rate)} />
              <Small color={rateColor(v.last.rate)}>Taux de présence : {v.last.rate}%</Small>
            </>
          )}
        </Box>

        <Box title="Évolution de la présence (8 derniers appels)">
          {v.recent.length === 0 && <div className="empty">Pas encore de données.</div>}
          {v.recent.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 150 }}>
                {v.recent.map((a) => (
                  <div
                    key={a.id}
                    title={`${a.name} · ${fmtDate(a.start)} : ${a.rate}%`}
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: rateColor(a.rate), marginBottom: 3 }}>{a.rate}%</span>
                    <div
                      className="chart-bar"
                      style={{
                        width: "100%",
                        maxWidth: 36,
                        height: Math.max(4, Math.round(a.rate * 1.1)),
                        background: rateColor(a.rate),
                        borderRadius: "6px 6px 0 0",
                      }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, borderTop: `1px solid ${LINE}`, paddingTop: 4 }}>
                {v.recent.map((a) => (
                  <span key={a.id} style={{ flex: 1, textAlign: "center", fontSize: 10, color: GRAY }}>
                    {new Date(a.start).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
                  </span>
                ))}
              </div>
            </>
          )}
        </Box>

        <Box title="Présence par type d'activité">
          {data.types.filter((t) => t.held > 0).length === 0 && <div className="empty">Pas encore de données.</div>}
          {data.types
            .filter((t) => t.held > 0)
            .map((t) => (
              <div key={t.typeName} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontWeight: 600 }}>{t.typeName}</span>
                  <span style={{ fontWeight: 700, color: rateColor(t.rate) }}>{t.rate}%</span>
                </div>
                <Bar value={t.rate} color={rateColor(t.rate)} />
                <Small>
                  {t.held} appel{t.held > 1 ? "s" : ""} sur {t.created} · {t.avgPresent} présents en moyenne
                </Small>
              </div>
            ))}
        </Box>

        <Box title="Membres à relancer" link={{ to: "/absences", label: "Voir tout" }}>
          {v.streaks.length === 0 && (
            <div className="empty">Aucun membre n'a 3 absences consécutives aux GOUDI ALJUMAH.</div>
          )}
          {v.streaks.slice(0, 5).map((s) => (
            <Row
              key={s.member.id}
              left={<span style={{ fontWeight: 600 }}>{fullName(s.member)}</span>}
              right={<span className="badge inactive">{s.current} absences d'affilée</span>}
            />
          ))}
        </Box>

        <Box title="Appels à régulariser" link={{ to: "/attendance", label: "Saisir les présences" }}>
          {v.toFix.length === 0 && <div className="empty">Tout est à jour.</div>}
          {v.toFix.slice(0, 5).map((a) => (
            <Row
              key={a.id}
              left={
                <>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <Small>{fmtDate(a.start)}</Small>
                </>
              }
              right={<span className="badge">{a.typeName}</span>}
            />
          ))}
          {v.toFix.length > 5 && <Small>+ {v.toFix.length - 5} autre(s) activité(s)</Small>}
        </Box>

        <Box title="Les plus assidus">
          {v.held.length === 0 && <div className="empty">Pas encore de données.</div>}
          {v.held.length > 0 &&
            v.assidus.map((x, i) => (
              <Row
                key={x.m.id}
                left={
                  <span style={{ fontWeight: 600 }}>
                    {i + 1}. {fullName(x.m)}
                  </span>
                }
                right={
                  <span style={{ fontWeight: 700, color: rateColor(x.rate) }}>
                    {x.p}/{v.held.length} · {x.rate}%
                  </span>
                }
              />
            ))}
        </Box>
      </div>
    </>
  );
}