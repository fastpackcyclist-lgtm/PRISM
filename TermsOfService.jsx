import { useNavigate } from "react-router-dom";

const FONT = "'Courier New', monospace";
const BG = "#040810";
const CYAN = "#00D4FF";

export default function TermsOfService() {
  const navigate = useNavigate();
  return (
    <div style={{ background: BG, color: CYAN, fontFamily: FONT, minHeight: "100vh", padding: "40px 24px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ fontSize: 12, letterSpacing: 4, fontWeight: "bold", marginBottom: 24, cursor: "pointer" }} onClick={() => navigate("/")}>
          P.R.I.S.M.
        </div>
        <h1 style={{ fontSize: 20, letterSpacing: 2, marginBottom: 8 }}>TERMS OF SERVICE</h1>
        <p style={{ fontSize: 10, color: "#FFB800", letterSpacing: 1, marginBottom: 24 }}>
          DRAFT — placeholder text, pending professional legal review before real signups/payments go live.
        </p>
        <p style={{ fontSize: 13, color: "rgba(0,212,255,0.65)", lineHeight: 1.7 }}>
          This page will cover account eligibility and responsibilities, subscription billing terms (via Stripe —
          renewal, cancellation, refund policy), acceptable use, the fact that PRISM's financial figures and
          AI responses are informational and not licensed financial advice, limitation of liability, and
          termination conditions.
        </p>
      </div>
    </div>
  );
}
