import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CalendarDays, Check, MapPin, QrCode, ScanLine, Search, UserPlus, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "../lib/supabase";
import { siteUrl } from "../lib/site";
import PageHeader from "../components/PageHeader";
import ActivityGuests from "../components/ActivityGuests";
import type { Activity } from "../types";

type MemberName = { id: string; first_name: string; last_name: string };
type Mark = "Présent" | "Absent";

type Group = 0 | 1 | 2; // 0 = en cours, 1 = à venir, 2 = passée / annulée

// Règle unique (la même que le pointage QR et le statut en base) :
//  en cours = du début jusqu'à la fin (4 h après le début s'il n'y a pas de fin) ;
//  à venir = avant le début ; passée = après la fin, terminée ou annulée.
function groupOf(a: Activity, now: number): Group {
  if (a.status === "annulée" || a.status === "terminée") return 2;
  const start = new Date(a.start_datetime).getTime();
  const end = a.end_datetime ? new Date(a.end_datetime).getTime() : start + 4 * 3600_000;
  if (now > end) return 2;
  if (now >= start) return 0;
  return 1;
}

const GROUP_LABEL: Record<Group, string> = { 0: "En cours", 1: "À venir", 2: "Passées" };

export default function Attendance() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [members, setMembers] = useState<MemberName[]>([]);
  const [selected, setSelected] = useState("");
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [scanTimes, setScanTimes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [info, setInfo] = useState("");
  const [showGuests, setShowGuests] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [excused, setExcused] = useState<Set<string>>(new Set());
  const [guestCount, setGuestCount] = useState(0);

  useEffect(() => {
    supabase.from("activities").select("*").order("start_datetime", { ascending: false })
      .then(({ data }) => setActivities((data as Activity[]) || []));
    supabase.rpc("public_member_names")
      .then(({ data }) => setMembers((data as MemberName[]) || []));
  }, []);

  // Ordre : en cours, puis à venir (la plus proche d'abord), puis passées (la plus récente d'abord)
  const sortedActivities = useMemo(() => {
    const now = Date.now();
    const t = (a: Activity) => new Date(a.start_datetime).getTime();
    return activities
      .map((a) => ({ a, g: groupOf(a, now) }))
      .sort((x, y) => {
        if (x.g !== y.g) return x.g - y.g;
        return x.g === 1 ? t(x.a) - t(y.a) : t(y.a) - t(x.a);
      });
  }, [activities]);

  const current = activities.find((a) => a.id === selected);

  async function loadGuestCount() {
    if (!selected) { setGuestCount(0); return; }
    const { count } = await supabase.from("activity_guests")
      .select("id", { count: "exact", head: true }).eq("activity_id", selected);
    setGuestCount(count || 0);
  }

  useEffect(() => {
    setShowGuests(false);
    setShowQr(false);
    void loadGuestCount();
  }, [selected]);

  useEffect(() => {
    setMarks({});
    setExcused(new Set());
    setScanTimes({});
    if (!selected) return;
    let cancelled = false;
    supabase.from("attendance").select("member_id,status,check_in_at").eq("activity_id", selected)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setInfo("Erreur de chargement : " + error.message); return; }
        const x: Record<string, Mark> = {};
        const t: Record<string, string> = {};
        const ex = new Set<string>();
        (data || []).forEach((r: any) => {
          if (r.status === "Présent" || r.status === "Absent") x[r.member_id] = r.status;
          if (r.status === "Excusé") ex.add(r.member_id);
          if (r.status === "Présent" && r.check_in_at) t[r.member_id] = r.check_in_at;
        });
        setMarks(x);
        setExcused(ex);
        setScanTimes(t);
      });
    return () => { cancelled = true; };
  }, [selected]);

  // Enregistre immédiatement (pas de bouton « Enregistrer »)
  async function setMany(ids: string[], value: Mark) {
    if (!selected || !ids.length) return;
    const before = marks;
    const beforeTimes = scanTimes;
    const now = new Date().toISOString();
    // Un membre marqué « Présent » reçoit une heure d'arrivée (conservée si déjà scanné)
    const newTimes = { ...scanTimes };
    if (value === "Présent") ids.forEach((id) => { if (!newTimes[id]) newTimes[id] = now; });
    setScanTimes(newTimes);
    setMarks((m) => {
      const n = { ...m };
      ids.forEach((id) => (n[id] = value));
      return n;
    });
    const rows = ids.map((id) => {
      const row: Record<string, unknown> = { activity_id: selected, member_id: id, status: value, method: "manual" };
      if (value === "Présent") row.check_in_at = newTimes[id];
      return row;
    });
    const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "activity_id,member_id" });
    if (error) {
      setMarks(before);
      setScanTimes(beforeTimes);
      setInfo("Erreur : " + error.message);
    } else {
      setInfo("✓ Enregistré");
      setTimeout(() => setInfo(""), 1500);
    }
  }

  // Ordre : présents selon l'ordre de scan (1er arrivé en haut), puis les autres par ordre alphabétique
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? members.filter((m) => `${m.first_name} ${m.last_name}`.toLowerCase().includes(q)) : members;
    const rank = (id: string) => (marks[id] === "Présent" && scanTimes[id] ? 0 : marks[id] === "Présent" ? 1 : 2);
    return [...list].sort((a, b) => {
      const ra = rank(a.id), rb = rank(b.id);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return scanTimes[a.id].localeCompare(scanTimes[b.id]);
      return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "fr");
    });
  }, [members, query, marks, scanTimes]);

  const scanOrder = useMemo(() => {
    const ids = Object.keys(scanTimes).filter((id) => marks[id] === "Présent").sort((a, b) => scanTimes[a].localeCompare(scanTimes[b]));
    return Object.fromEntries(ids.map((id, i) => [id, i + 1])) as Record<string, number>;
  }, [marks, scanTimes]);

  // Clôture : tous les membres encore non marqués (même cachés par la recherche) passent « Absent ».
  function closeRoll() {
    const ids = members.filter((m) => !marks[m.id] && !excused.has(m.id)).map((m) => m.id);
    if (!ids.length) { setInfo("Tout le monde est déjà marqué."); return; }
    if (!confirm(`Clôturer l'appel ?\n\n${ids.length} membre(s) non marqué(s) seront enregistrés « Absent ». Les présents ne changent pas.`)) return;
    void setMany(ids, "Absent");
  }

  const present = members.filter((m) => marks[m.id] === "Présent").length;
  const absent = members.filter((m) => marks[m.id] === "Absent").length;
  const todo = members.length - present - absent;

  return (
    <>
      <PageHeader title="Présences" description="Touche une activité (celle en cours ou la plus proche est en haut), puis coche Présent ou Absent. L'enregistrement est automatique." />
      {!selected && (
        <div className="att-activities">
          {sortedActivities.map(({ a, g }, i) => (
            <div key={a.id}>
              {(i === 0 || sortedActivities[i - 1].g !== g) && (
                <h3 className="muted" style={{ margin: "16px 0 8px" }}>{GROUP_LABEL[g]}</h3>
              )}
              <button
                type="button"
                className="panel"
                onClick={() => setSelected(a.id)}
                style={{
                  width: "100%", textAlign: "left", cursor: "pointer", marginBottom: 8,
                  borderLeft: g === 0 ? "4px solid #16a34a" : g === 1 ? "4px solid #2563eb" : undefined,
                  opacity: g === 2 ? 0.75 : 1,
                }}
              >
                <b>{a.name}</b>
                {g === 0 && <span className="badge" style={{ marginLeft: 8 }}>En cours</span>}
                {a.status === "annulée" && <span className="badge" style={{ marginLeft: 8 }}>Annulée</span>}
                <div className="muted" style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
                  <span><CalendarDays size={14} style={{ verticalAlign: -2 }} />{" "}
                    {new Date(a.start_datetime).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {a.location && <span><MapPin size={14} style={{ verticalAlign: -2 }} /> {a.location}</span>}
                </div>
              </button>
            </div>
          ))}
          {!sortedActivities.length && <div className="empty">Aucune activité.</div>}
        </div>
      )}

      {selected && (
        <div className="panel" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="secondary" onClick={() => { setSelected(""); setQuery(""); setInfo(""); }}>
            <ArrowLeft size={16} /> Toutes les activités
          </button>
          {current && (
            <div>
              <b>{current.name}</b>
              <div className="muted">{new Date(current.start_datetime).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</div>
            </div>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link to={`/scan?activity=${selected}`} className="primary" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", padding: "10px 14px", borderRadius: 10 }}>
              <ScanLine size={16} /> Scanner
            </Link>
            <button type="button" className="primary" onClick={() => setShowQr(true)}>
              <QrCode size={16} /> QR code
            </button>
            <button type="button" className="primary" onClick={() => setShowGuests(true)}>
              <UserPlus size={16} /> Invités{guestCount > 0 ? ` (${guestCount})` : ""}
            </button>
          </div>
        </div>
      )}

      {showQr && current && (() => {
        const link = `${siteUrl()}/checkin/${current.qr_token}`;
        return (
          <div className="modal-backdrop" onClick={() => setShowQr(false)}>
            <div className="modal" style={{ textAlign: "center", width: "min(480px,100%)" }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h2>{current.name}</h2>
                <button type="button" className="icon-btn" aria-label="Fermer" onClick={() => setShowQr(false)}>×</button>
              </div>
              <div style={{ background: "#fff", padding: 16, display: "inline-block", borderRadius: 12, border: "1px solid #e6e8ec" }}>
                <QRCodeSVG value={link} size={300} level="M" />
              </div>
              <p className="muted">Les membres scannent ce code pour se marquer présents, de 30 minutes avant le début jusqu'à la fin de l'activité.</p>
              <p style={{ fontSize: 12, wordBreak: "break-all", color: "#667085", margin: "0 0 12px" }}>{link}</p>
              <button type="button" className="secondary full"
                onClick={() => navigator.clipboard.writeText(link).then(() => setInfo("Lien copié"), () => setInfo("Copie impossible"))}>
                Copier le lien
              </button>
            </div>
          </div>
        );
      })()}

      {showGuests && current && (
        <ActivityGuests activity={current} onClose={() => setShowGuests(false)} onChanged={loadGuestCount} />
      )}

      {selected && (
        <>
          <div className="att-bar">
            <div className="att-counts">
              <span className="c-p">Présents : {present}</span>
              <span className="c-a">Absents : {absent}</span>
              <span className="c-n">Non marqués : {todo}</span>
              {info && <span className="att-info">{info}</span>}
            </div>
            <div className="att-actions">
              <button className="secondary" onClick={() => setMany(shown.map((m) => m.id), "Présent")}>Tous présents</button>
              <button className="secondary" onClick={() => setMany(shown.map((m) => m.id), "Absent")}>Tous absents</button>
              <button className="primary" disabled={todo === 0} onClick={closeRoll}>Clôturer l'appel</button>
            </div>
          </div>

          <div className="input-icon search" style={{ marginBottom: 14 }}>
            <Search size={18} />
            <input placeholder="Rechercher un membre…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="att-list">
            {shown.map((m) => {
              const v = marks[m.id];
              return (
                <div className="att-row" key={m.id}>
                  <span className="att-name">
                    {scanOrder[m.id] ? <b style={{ marginRight: 8 }}>{scanOrder[m.id]}.</b> : null}
                    {m.last_name} {m.first_name}
                    {scanTimes[m.id] && v === "Présent" && (
                      <small className="muted" style={{ marginLeft: 8 }}>
                        {new Date(scanTimes[m.id]).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </small>
                    )}
                  </span>
                  <div className="att-btns">
                    <button type="button" className={`att-btn p ${v === "Présent" ? "on" : ""}`}
                      aria-pressed={v === "Présent"} onClick={() => setMany([m.id], "Présent")}>
                      <Check size={18} /> Présent
                    </button>
                    <button type="button" className={`att-btn a ${v === "Absent" ? "on" : ""}`}
                      aria-pressed={v === "Absent"} onClick={() => setMany([m.id], "Absent")}>
                      <X size={18} /> Absent
                    </button>
                  </div>
                </div>
              );
            })}
            {!shown.length && <div className="empty">Aucun membre.</div>}
          </div>
        </>
      )}
    </>
  );
}