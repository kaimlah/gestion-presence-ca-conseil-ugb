import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "../lib/supabase";
import Footer from "../components/Footer";

type Card = {
  found: boolean;
  active?: boolean;
  first_name?: string;
  last_name?: string;
  member_number?: string;
};

// Page publique ouverte depuis le lien envoyé au membre : elle affiche sa carte et son QR personnel.
export default function MemberCard() {
  const { token = "" } = useParams();
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.rpc("public_member_card", { p_token: token }).then(({ data, error: rpcError }) => {
      if (rpcError) setError("Impossible de charger la carte : " + rpcError.message);
      else setCard(data as Card);
    });
  }, [token]);

  return (
    <div className="login-screen">
      <div className="login-card" style={{ textAlign: "center" }}>
        <img className="login-logo" src="/logo.png" alt="Conseil UGB" />
        <h1>Carte de membre</h1>
        <p>Moustarchidine Junior</p>

        {!card && !error && <p role="status">Chargement…</p>}
        {error && <div className="error-box" role="alert">{error}</div>}
        {card && !card.found && <div className="error-box" role="alert">Carte introuvable ou remplacée par une nouvelle.</div>}
        {card?.found && card.active === false && (
          <div className="error-box" role="alert">Cette carte n'est plus valide.</div>
        )}

        {card?.found && card.active && (
          <>
            <div style={{ margin: "4px 0 16px" }}>
              <div style={{ fontFamily: "var(--font-title)", fontSize: 24, fontWeight: 700 }}>
                {card.first_name} {card.last_name}
              </div>
              <div className="muted" style={{ fontWeight: 700, letterSpacing: ".05em" }}>{card.member_number}</div>
            </div>
            <div style={{ background: "#fff", padding: 16, borderRadius: 16, border: "1px solid #eadfda", display: "inline-block" }}>
              <QRCodeSVG value={`MJM:${token}`} size={240} level="M" />
            </div>
            <p className="muted" style={{ fontSize: 13, margin: "16px 0 0" }}>
              Présente ce QR code à l'entrée. Monte la luminosité de ton écran et ne le partage avec personne.
            </p>
          </>
        )}
        <Footer />
      </div>
    </div>
  );
}