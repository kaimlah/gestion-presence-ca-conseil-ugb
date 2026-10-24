import { useEffect, useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import PageHeader from "../components/PageHeader";
import type { Activity } from "../types";

type MemberName = { id: string; first_name: string; last_name: string };
type Mark = "Présent" | "Absent";

export default function Attendance() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [members, setMembers] = useState<MemberName[]>([]);
  const [selected, setSelected] = useState("");
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [scanTimes, setScanTimes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    supabase.from("activities").select("*").order("start_datetime", { ascending: false })
      .then(({ data }) => setActivities((data as Activity[]) || []));
    supabase.rpc("public_member_names")
      .then(({ data }) => setMembers((data as MemberName[]) || []));
  }, []);

  useEffect(() => {
    setMarks({});
    setScanTimes({});
    if (!selected) return;
    let cancelled = false;
    supabase.from("attendance").select("member_id,status,check_in_at").eq("activity_id", selected)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setInfo("Erreur de chargement : " + error.message); return; }
        const x: Record<string, Mark> = {};
        const t: Record<string, string> = {};
        (data || []).forEach((r: any) => {
          if (r.status === "Présent" || r.status === "Absent") x[r.member_id] = r.status;
          if (r.status === "Présent" && r.check_in_at) t[r.member_id] = r.check_in_at;
        });
        setMarks(x);
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

  const present = members.filter((m) => marks[m.id] === "Présent").length;
  const absent = members.filter((m) => marks[m.id] === "Absent").length;
  const todo = members.length - present - absent;

  return (
    <>
      <PageHeader title="Présences" description="Choisis l'activité, puis coche Présent ou Absent. L'enregistrement est automatique." />
      <div className="panel">
        <label>Activité
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">— Sélectionner —</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>{a.name} — {new Date(a.start_datetime).toLocaleDateString("fr-FR")}</option>
            ))}
          </select>
        </label>
      </div>

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