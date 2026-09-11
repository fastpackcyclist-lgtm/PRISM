import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./supabaseClient.js";
import { useAuth } from "./AuthContext.jsx";

const FONT = "'Courier New', monospace";
const BG = "#040810";
const CYAN = "#00D4FF";

const inputStyle = {
  width: "100%",
  background: "rgba(0,8,20,0.9)",
  border: "1px solid rgba(0,212,255,0.25)",
  color: CYAN,
  padding: "11px 12px",
  fontSize: 12,
  fontFamily: FONT,
  outline: "none",
  marginBottom: 10,
};

const buttonStyle = (primary) => ({
  width: "100%",
  background: primary ? "rgba(0,212,255,0.12)" : "rgba(0,212,255,0.03)",
  border: `1px solid ${primary ? "rgba(0,212,255,0.55)" : "rgba(0,212,255,0.15)"}`,
  color: primary ? CYAN : "rgba(0,212,255,0.55)",
  padding: "11px",
  fontSize: 11,
  letterSpacing: 2,
  cursor: "pointer",
  fontFamily: FONT,
  marginBottom: 8,
});

export default function AuthPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(null); // { kind: "error"|"info", text }
  const [busy, setBusy] = useState(false);

  if (user) {
    navigate("/app");
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setStatus(null);
    const { error } =
      mode === "signup"
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setStatus({ kind: "error", text: error.message });
    } else if (mode === "signup") {
      setStatus({ kind: "info", text: "Check your email to confirm your account." });
    } else {
      navigate("/app");
    }
  };

  const handleMagicLink = async () => {
    if (!email.trim()) {
      setStatus({ kind: "error", text: "Enter your email first." });
      return;
    }
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    setStatus(
      error
        ? { kind: "error", text: error.message }
        : { kind: "info", text: "Magic link sent — check your email." },
    );
  };

  return (
    <div
      style={{
        background: BG,
        color: CYAN,
        fontFamily: FONT,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div
          style={{ fontSize: 12, letterSpacing: 4, fontWeight: "bold", marginBottom: 4, cursor: "pointer" }}
          onClick={() => navigate("/")}
        >
          P.R.I.S.M.
        </div>
        <div style={{ fontSize: 8, letterSpacing: 2, color: "rgba(0,212,255,0.35)", marginBottom: 28 }}>
          {mode === "signup" ? "// CREATE ACCOUNT" : "// SIGN IN"}
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="EMAIL"
            autoComplete="email"
            style={inputStyle}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="PASSWORD"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            style={inputStyle}
          />

          {status && (
            <div
              style={{
                fontSize: 10,
                lineHeight: 1.5,
                color: status.kind === "error" ? "#FF6B6B" : "#00FF9C",
                marginBottom: 10,
              }}
            >
              {status.text}
            </div>
          )}

          <button type="submit" disabled={busy} style={buttonStyle(true)}>
            {busy ? "//  WORKING..." : mode === "signup" ? "CREATE ACCOUNT" : "SIGN IN"}
          </button>
        </form>

        <button onClick={handleMagicLink} disabled={busy} style={buttonStyle(false)}>
          EMAIL ME A MAGIC LINK INSTEAD
        </button>

        <div style={{ fontSize: 9, color: "rgba(0,212,255,0.4)", marginTop: 18, textAlign: "center" }}>
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <span style={{ color: CYAN, cursor: "pointer" }} onClick={() => { setMode("signin"); setStatus(null); }}>
                Sign in
              </span>
            </>
          ) : (
            <>
              No account?{" "}
              <span style={{ color: CYAN, cursor: "pointer" }} onClick={() => { setMode("signup"); setStatus(null); }}>
                Create one
              </span>
            </>
          )}
        </div>

        <div style={{ fontSize: 8, color: "rgba(0,212,255,0.25)", marginTop: 24, textAlign: "center", lineHeight: 1.6 }}>
          By continuing you agree to the{" "}
          <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => navigate("/terms")}>Terms</span>
          {" "}and{" "}
          <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => navigate("/privacy")}>Privacy Policy</span>.
        </div>

        <div
          style={{ fontSize: 8, letterSpacing: 1.5, color: "rgba(0,212,255,0.3)", marginTop: 30, textAlign: "center", cursor: "pointer" }}
          onClick={() => navigate("/app")}
        >
          ← CONTINUE WITHOUT AN ACCOUNT (DEMO)
        </div>
      </div>
    </div>
  );
}
