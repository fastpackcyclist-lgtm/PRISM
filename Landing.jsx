import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

// ─── MINI ORB (landing hero) ──────────────────────────────
const PHI = (1 + Math.sqrt(5)) / 2;

function genC60() {
  const raw = [];
  const add = (a, b, c) => { raw.push([a, b, c], [b, c, a], [c, a, b]); };
  for (const s1 of [1, -1]) for (const s2 of [1, -1]) add(0, s1, s2 * 3 * PHI);
  for (const s1 of [1, -1]) for (const s2 of [1, -1]) for (const s3 of [1, -1]) {
    add(s1 * 2, s2 * (1 + 2 * PHI), s3 * PHI);
    add(s1, s2 * (2 + PHI), s3 * 2 * PHI);
  }
  const unique = [];
  raw.forEach(p => { if (!unique.some(u => Math.abs(u[0]-p[0])<0.01 && Math.abs(u[1]-p[1])<0.01 && Math.abs(u[2]-p[2])<0.01)) unique.push(p); });
  const pts = unique.slice(0, 60);
  const phi2 = Math.PI * (3 - Math.sqrt(5));
  while (pts.length < 60) {
    const i = pts.length, y = 1-(i/59)*2, r = Math.sqrt(Math.max(0,1-y*y));
    pts.push([Math.cos(phi2*i)*r, y, Math.sin(phi2*i)*r]);
  }
  const mx = Math.max(...pts.map(p => Math.sqrt(p[0]**2+p[1]**2+p[2]**2)));
  return pts.map(p => ({x:p[0]/mx, y:p[1]/mx, z:p[2]/mx}));
}
function buildEdges(verts) {
  const edges = [];
  for (let i = 0; i < verts.length; i++) {
    verts.map((v,j) => ({j, d:(v.x-verts[i].x)**2+(v.y-verts[i].y)**2+(v.z-verts[i].z)**2}))
      .filter(o => o.j!==i).sort((a,b) => a.d-b.d).slice(0,3)
      .forEach(({j}) => { if (!edges.some(e => (e.a===j&&e.b===i)||(e.a===i&&e.b===j))) edges.push({a:i,b:j}); });
  }
  return edges;
}
const VERTS = genC60();
const EDGES = buildEdges(VERTS);

// Knit-together intro: nodes crystallize in over INTRO_MS, same pace as the
// Hub orb (PRISM.jsx) so both surfaces feel like one system booting up.
const INTRO_MS = 1600;
const NODE_APPEAR_ORDER = (() => {
  const order = Array.from({ length: 60 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const thresholds = new Array(60);
  order.forEach((nodeIdx, pos) => { thresholds[nodeIdx] = pos / 60; });
  return thresholds;
})();

function LandingOrb() {
  const containerRef = useRef(null);
  const canvasRef    = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    let raf, t = 0;
    const introStart = performance.now();

    const setup = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = container.clientWidth;
      canvas.width  = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width  = `${size}px`;
      canvas.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    setup();
    const ro = new ResizeObserver(setup);
    ro.observe(container);

    const draw = () => {
      t += 0.006;
      const size = container.clientWidth;
      const cx = size / 2, cy = size / 2;
      const baseR = size * 0.30;
      ctx.clearRect(0, 0, size, size);

      const rotY = t * 0.22, rotX = Math.sin(t * 0.14) * 0.25;
      const breath = 0.94 + 0.06 * Math.sin(t * 1.2);

      const iP = Math.min(1, (performance.now() - introStart) / INTRO_MS);
      const nodeAlpha = (i) => Math.max(0, Math.min(1, (iP - NODE_APPEAR_ORDER[i]) / 0.06));

      const proj = VERTS.map((v, i) => {
        const x1 = v.x*Math.cos(rotY) - v.z*Math.sin(rotY);
        const zr  = v.x*Math.sin(rotY) + v.z*Math.cos(rotY);
        const y2  = v.y*Math.cos(rotX) - zr*Math.sin(rotX);
        const z2  = v.y*Math.sin(rotX) + zr*Math.cos(rotX);
        const rad = baseR * breath * (0.93 + 0.07*Math.sin(t*1.5+i*0.35));
        const depth = (z2+1)/2;
        return { px: cx + x1*rad, py: cy + y2*rad, depth };
      });

      EDGES.forEach(e => {
        const edgeAlpha = Math.min(nodeAlpha(e.a), nodeAlpha(e.b));
        if (edgeAlpha <= 0.02) return;
        const a = proj[e.a], b = proj[e.b];
        const depth = (a.depth + b.depth) / 2;
        const dx = b.px-a.px, dy = b.py-a.py, len = Math.hypot(dx,dy)||1;
        const ox = (-dy/len)*1.4, oy = (dx/len)*1.4;
        ctx.strokeStyle = `rgba(0,212,255,${edgeAlpha*(0.08+0.44*depth)})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(a.px+ox,a.py+oy); ctx.lineTo(b.px+ox,b.py+oy); ctx.stroke();
        ctx.strokeStyle = `rgba(0,255,156,${edgeAlpha*(0.04+0.22*depth)})`;
        ctx.lineWidth = 0.4;
        ctx.beginPath(); ctx.moveTo(a.px-ox,a.py-oy); ctx.lineTo(b.px-ox,b.py-oy); ctx.stroke();
      });

      ctx.globalCompositeOperation = "lighter";
      proj.forEach((p, i) => {
        const nA = nodeAlpha(i);
        if (nA <= 0.02) return;
        const sz = (1.6+1.8*p.depth) * (0.94+0.06*Math.sin(t*1.8+i*0.4));
        const bio = Math.sin(t*1.4+i*0.6)*0.5+0.5;
        ctx.beginPath();
        for (let k=0;k<6;k++){const a=(Math.PI/3)*k-Math.PI/6;ctx.lineTo(p.px+Math.cos(a)*sz,p.py+Math.sin(a)*sz);}
        ctx.closePath();
        ctx.shadowBlur = p.depth > 0.75 ? 5 : 0;
        ctx.shadowColor = "rgba(0,212,255,0.5)";
        ctx.fillStyle = `rgba(0,212,255,${nA*(0.1+0.35*p.depth)})`;
        ctx.fill(); ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(${Math.round(bio*50)},${Math.round(212+bio*43)},255,${nA*(0.22+0.44*p.depth)})`;
        ctx.lineWidth = 0.55; ctx.stroke();
      });
      ctx.globalCompositeOperation = "source-over";

      const coreAlpha = Math.min(1, iP * 2);
      const cp = 0.5 + 0.45*Math.sin(t*2.6);
      ctx.fillStyle = `rgba(0,212,255,${cp*0.6*coreAlpha})`;
      ctx.beginPath(); ctx.arc(cx, cy, 2.5+1.2*cp, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = `rgba(0,212,255,${0.18*coreAlpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, 8+3.5*Math.sin(t*2), 0, Math.PI*2); ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", maxWidth: 360, aspectRatio: "1 / 1" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}

// ─── FEATURE CARDS ────────────────────────────────────────
const FEATURES = [
  { icon: "⬡", label: "MORNING BRIEF",   color: "#FFB800", desc: "PRISM briefs you every morning without being asked. Net worth, income, streak. The AI initiates. You receive." },
  { icon: "⬡", label: "VOICE FIRST",     color: "#00D4FF", desc: "Talk to PRISM. It listens, reasons, and speaks back — human cadence, not robot pace. Zero filler." },
  { icon: "⬡", label: "SCHEMATIC DATA",  color: "#00FF9C", desc: "Income and net worth render in wireframe schematic mode. Charts built from the same hex lattice as the orb itself." },
  { icon: "⬡", label: "60 NODE BRAIN",   color: "#7B2FFF", desc: "Five organ clusters. Each query lights the nodes doing the work. Watch the orb think — literally." },
  { icon: "⬡", label: "MEMORY",          color: "#00D4FF", desc: "Every conversation builds the next. PRISM grows with you. Context doesn't reset. Your digital mind expands." },
  { icon: "⬡", label: "FACTIONS",        color: "#FF6B6B", desc: "Connect with operators who share your mission. Workout. Founder. Creative. Tech. Coming soon." },
];

// ─── MAIN ─────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [email,   setEmail]   = useState("");
  const [sent,    setSent]    = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  const FONT = "'Courier New', monospace";
  const BG   = "#040810";
  const CYAN = "#00D4FF";

  const fade = (delay) => ({
    opacity:    visible ? 1 : 0,
    transform:  visible ? "translateY(0)" : "translateY(16px)",
    transition: `opacity 0.8s ${delay}s ease, transform 0.8s ${delay}s ease`,
  });

  return (
    <div style={{ background: BG, color: CYAN, fontFamily: FONT, minHeight: "100vh", overflowX: "hidden" }}>

      {/* NAV */}
      <nav style={{ padding: "14px 24px", borderBottom: "1px solid rgba(0,212,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(4,8,16,0.9)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100 }}>
        <span style={{ fontSize: 13, letterSpacing: 4, fontWeight: "bold" }}>P.R.I.S.M.</span>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 8, letterSpacing: 2, color: "rgba(0,212,255,0.35)" }}>BY A.R.C. INDUSTRIES</span>
          <button onClick={() => navigate("/app")} style={{ background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.4)", color: CYAN, padding: "6px 16px", fontSize: 9, letterSpacing: 2, cursor: "pointer", fontFamily: FONT }}>
            ENTER →
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ minHeight: "90vh", display: "flex", alignItems: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(0,212,255,0.04) 1px, transparent 1px)", backgroundSize: "40px 40px", pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 20% 50%, rgba(0,212,255,0.05) 0%, transparent 60%)", pointerEvents: "none" }} />

        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "60px 24px", display: "flex", alignItems: "center", gap: 60, flexWrap: "wrap", width: "100%" }}>
          {/* Orb */}
          <div style={{ flex: "0 1 360px", ...fade(0), filter: "drop-shadow(0 0 40px rgba(0,212,255,0.15))" }}>
            <LandingOrb />
          </div>

          {/* Copy */}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 8, letterSpacing: 4, color: "rgba(0,212,255,0.4)", marginBottom: 14, ...fade(0.15) }}>
              PERSISTENT REASONING & INTELLIGENT SYNTHESIS MATRIX
            </div>
            <h1 style={{ fontSize: "clamp(44px, 6vw, 76px)", fontWeight: "bold", letterSpacing: 8, margin: "0 0 20px", lineHeight: 1.05, ...fade(0.3) }}>
              P.R.I.S.M.
            </h1>
            <p style={{ fontSize: "clamp(16px, 2.2vw, 22px)", color: "rgba(0,212,255,0.7)", lineHeight: 1.55, margin: "0 0 12px", maxWidth: 480, ...fade(0.45) }}>
              A world without optionality is oppression dressed in plastic flowers.
            </p>
            <p style={{ fontSize: 13, color: "rgba(0,212,255,0.45)", lineHeight: 1.75, maxWidth: 460, margin: "0 0 36px", ...fade(0.6) }}>
              Want to track your life like a video game? Be a founder from the future?
              Find the world too bland for your personality?{" "}
              <span style={{ color: CYAN }}>Jump in.</span>
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", ...fade(0.75) }}>
              <button
                onClick={() => navigate("/app")}
                style={{ background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.55)", color: CYAN, padding: "13px 32px", fontSize: 11, letterSpacing: 2.5, cursor: "pointer", fontFamily: FONT, transition: "all 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,212,255,0.2)"; e.currentTarget.style.boxShadow = "0 0 24px rgba(0,212,255,0.2)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,212,255,0.1)"; e.currentTarget.style.boxShadow = "none"; }}
              >
                ENTER THE SYSTEM →
              </button>
              <button
                onClick={() => navigate("/login")}
                style={{ background: "transparent", border: "1px solid rgba(0,212,255,0.25)", color: "rgba(0,212,255,0.6)", padding: "13px 24px", fontSize: 11, letterSpacing: 2.5, cursor: "pointer", fontFamily: FONT, transition: "all 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,212,255,0.55)"; e.currentTarget.style.color = CYAN; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(0,212,255,0.25)"; e.currentTarget.style.color = "rgba(0,212,255,0.6)"; }}
              >
                SIGN IN
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* MANIFESTO */}
      <section style={{ padding: "100px 24px", borderTop: "1px solid rgba(0,212,255,0.08)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ fontSize: 8, letterSpacing: 3, color: "rgba(0,212,255,0.3)", marginBottom: 40 }}>// MANIFESTO</div>
          {[
            { text: "There is no pill for comparison.",             size: 26, color: CYAN,                   bold: true },
            { text: "You are your own biggest rival.",              size: 26, color: CYAN,                   bold: true },
            null,
            { text: "PRISM is for the person who looks at video games and says this is cool, sad it isn't real.", size: 15, color: "rgba(0,212,255,0.65)" },
            null,
            { text: "PRISM is for the Founder who thought they would get a world where their work gets filed away while they are going to a meeting.", size: 15, color: "rgba(0,212,255,0.65)" },
            null,
            { text: "PRISM is for the person who wakes up and feels poor.", size: 15, color: "rgba(0,212,255,0.65)" },
            null,
            { text: "$100. $3.5K. $10K. $3.9M. $100M.", size: 18, color: "#00FF9C", bold: true, spacing: 2 },
            { text: "It doesn't matter.", size: 18, color: "rgba(0,212,255,0.55)" },
            null,
            { text: "You have the same phone, the same AI, the same idea of what success looks like — but as an individual, your vision is entirely yours.", size: 15, color: "rgba(0,212,255,0.55)" },
            null,
            { text: "PRISM. Your companion. Your digital brain.", size: 20, color: CYAN, bold: true },
          ].map((line, i) =>
            line === null
              ? <div key={i} style={{ height: 18 }} />
              : <p key={i} style={{ fontSize: line.size, color: line.color, fontWeight: line.bold ? "bold" : "normal", letterSpacing: line.spacing || 0, lineHeight: 1.55, margin: "0 0 6px" }}>{line.text}</p>
          )}
        </div>
      </section>

      {/* FEATURES */}
      <section style={{ padding: "80px 24px", borderTop: "1px solid rgba(0,212,255,0.08)", background: "rgba(0,212,255,0.012)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ fontSize: 8, letterSpacing: 3, color: "rgba(0,212,255,0.3)", marginBottom: 44 }}>// SYSTEM CAPABILITIES</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 2 }}>
            {FEATURES.map((f, i) => (
              <div key={i}
                style={{ background: "rgba(4,8,16,0.85)", border: "1px solid rgba(0,212,255,0.07)", borderTop: `2px solid ${f.color}33`, padding: "26px 22px", transition: "all 0.22s", cursor: "default" }}
                onMouseEnter={e => { e.currentTarget.style.background = `${f.color}07`; e.currentTarget.style.borderColor = `${f.color}22`; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(4,8,16,0.85)"; e.currentTarget.style.borderColor = "rgba(0,212,255,0.07)"; }}
              >
                <div style={{ fontSize: 16, color: f.color, marginBottom: 8, opacity: 0.8 }}>{f.icon}</div>
                <div style={{ fontSize: 9, letterSpacing: 2.5, color: f.color, marginBottom: 10, fontWeight: "bold" }}>{f.label}</div>
                <p style={{ fontSize: 12, color: "rgba(0,212,255,0.5)", lineHeight: 1.65, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ARCHITECTURE NUMBERS */}
      <section style={{ padding: "80px 24px", borderTop: "1px solid rgba(0,212,255,0.08)" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 8, letterSpacing: 3, color: "rgba(0,212,255,0.3)", marginBottom: 20 }}>// ARCHITECTURE</div>
          <h2 style={{ fontSize: "clamp(18px, 2.8vw, 30px)", letterSpacing: 4, marginBottom: 22 }}>C60 BUCKMINSTERFULLERENE</h2>
          <p style={{ fontSize: 13, color: "rgba(0,212,255,0.5)", lineHeight: 1.75, marginBottom: 40 }}>
            The orb is not decoration. It is a 60-node geodesic mesh built from the same geometry as a carbon-60 molecule. Each node is a micro-agent. Each bond is a dual communication channel. The interface is the intelligence.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 36, flexWrap: "wrap" }}>
            {[["60","HEX NODES","#00D4FF"],["90","DUAL BONDS","#00FF9C"],["5","ORGAN CLUSTERS","#7B2FFF"],["3","EQUATIONS","#FFB800"]].map(([n,l,c]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 36, fontWeight: "bold", color: c }}>{n}</div>
                <div style={{ fontSize: 7, letterSpacing: 2, color: `${c}88`, marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "100px 24px", borderTop: "1px solid rgba(0,212,255,0.08)", background: "rgba(0,212,255,0.015)" }}>
        <div style={{ maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 8, letterSpacing: 3, color: "rgba(0,212,255,0.3)", marginBottom: 18 }}>// EARLY ACCESS</div>
          <h2 style={{ fontSize: "clamp(20px, 3.5vw, 38px)", letterSpacing: 3, marginBottom: 14 }}>YOUR SYSTEM IS READY.</h2>
          <p style={{ fontSize: 13, color: "rgba(0,212,255,0.45)", marginBottom: 36 }}>
            Launch into PRISM now, or join the list to be notified when the mobile app and faction system go live.
          </p>
          <button
            onClick={() => navigate("/app")}
            style={{ display: "block", width: "100%", background: "rgba(0,212,255,0.09)", border: "1px solid rgba(0,212,255,0.5)", color: CYAN, padding: "15px", fontSize: 12, letterSpacing: 3, cursor: "pointer", fontFamily: FONT, marginBottom: 14, transition: "all 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,212,255,0.18)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,212,255,0.09)"; }}
          >
            ENTER PRISM NOW — FREE
          </button>
          {!sent ? (
            <div style={{ display: "flex", gap: 0 }}>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && email.includes("@") && setSent(true)}
                placeholder="// your email for mobile launch"
                style={{ flex: 1, background: "rgba(0,8,20,0.9)", border: "1px solid rgba(0,212,255,0.18)", borderRight: "none", color: CYAN, padding: "9px 12px", fontSize: 10, fontFamily: FONT, outline: "none" }}
              />
              <button
                onClick={() => email.includes("@") && setSent(true)}
                style={{ background: "rgba(0,212,255,0.07)", border: "1px solid rgba(0,212,255,0.18)", color: "rgba(0,212,255,0.55)", padding: "9px 14px", fontSize: 9, letterSpacing: 1, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }}
              >
                NOTIFY ME
              </button>
            </div>
          ) : (
            <div style={{ padding: "10px", border: "1px solid rgba(0,255,156,0.3)", color: "#00FF9C", fontSize: 9, letterSpacing: 2 }}>
              ● LOGGED — YOU WILL HEAR FROM US
            </div>
          )}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ padding: "36px 24px", borderTop: "1px solid rgba(0,212,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 4, fontWeight: "bold", marginBottom: 4 }}>P.R.I.S.M.</div>
          <div style={{ fontSize: 7, letterSpacing: 2, color: "rgba(0,212,255,0.3)" }}>© 2026 A.R.C. INDUSTRIES LLC</div>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {["PRIVACY","TERMS","CONTACT"].map(l => (
            <span key={l} style={{ fontSize: 8, letterSpacing: 2, color: "rgba(0,212,255,0.3)", cursor: "pointer" }}>{l}</span>
          ))}
        </div>
        <div style={{ fontSize: 7, letterSpacing: 2, color: "rgba(0,212,255,0.2)" }}>BUILT IN AUGUSTA, GA · PRISM v7</div>
      </footer>

      <style>{`
        * { box-sizing: border-box; }
        html { scroll-behavior: smooth; background: #040810; }
        ::selection { background: rgba(0,212,255,0.2); }
        ::-webkit-scrollbar { width: 4px; background: #040810; }
        ::-webkit-scrollbar-thumb { background: rgba(0,212,255,0.2); }
        input::placeholder { color: rgba(0,212,255,0.2); }
      `}</style>
    </div>
  );
}
