import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext.jsx";
import { usePrismData } from "./usePrismData.js";

// ═══════════════════════════════════════════════════════════
// P.R.I.S.M. v7 — Complete standalone component
// Runs in Vite + React. API calls go to /api/chat proxy.
// Storage uses localStorage. No artifact-specific APIs.
// ═══════════════════════════════════════════════════════════

// ─── GEOMETRY ─────────────────────────────────────────────
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
  return pts.map(p => ({ x:p[0]/mx, y:p[1]/mx, z:p[2]/mx }));
}

function buildEdges(verts) {
  const edges = [];
  for (let i = 0; i < verts.length; i++) {
    verts.map((v,j) => ({ j, d:(v.x-verts[i].x)**2+(v.y-verts[i].y)**2+(v.z-verts[i].z)**2 }))
      .filter(o => o.j!==i).sort((a,b) => a.d-b.d).slice(0,3)
      .forEach(({j}) => { if (!edges.some(e => (e.a===j&&e.b===i)||(e.a===i&&e.b===j))) edges.push({a:i,b:j}); });
  }
  return edges;
}

const VERTS = genC60();
const EDGES = buildEdges(VERTS);

// ─── INTRO ANIMATION ──────────────────────────────────────
// Nodes crystallize in a random order when the app first loads.
// Computed once at module level so the order is stable per session.
const NODE_APPEAR_ORDER = (() => {
  const order = Array.from({ length: 60 }, (_, i) => i);
  // Seeded shuffle so it's reproducible within a session
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // Map: nodeIndex → appearance threshold (0–1)
  const thresholds = new Array(60);
  order.forEach((nodeIdx, pos) => { thresholds[nodeIdx] = pos / 60; });
  return thresholds;
})();

// ─── ORGAN SYSTEM ─────────────────────────────────────────
const ORGANS = {
  cognitive:  { name:"Cognitive Core",     nodes:Array.from({length:12},(_,i)=>i),    color:"#00D4FF" },
  memory:     { name:"Memory Cortex",      nodes:Array.from({length:12},(_,i)=>i+12), color:"#7B2FFF" },
  visual:     { name:"Visual Cortex",      nodes:Array.from({length:12},(_,i)=>i+24), color:"#00FF9C" },
  data:       { name:"Data Spine",         nodes:Array.from({length:12},(_,i)=>i+36), color:"#FFB800" },
  regulatory: { name:"Regulatory System",  nodes:Array.from({length:12},(_,i)=>i+48), color:"#FF6B6B" },
};

const PANEL_MANIFEST = {
  chat:     { organ:"cognitive" },
  income:   { organ:"data"      },
  networth: { organ:"data"      },
  stats:    { organ:"regulatory"},
  profile:  { organ:"memory"    },
  settings: { organ:"regulatory"},
};

const PANEL_TABS = [
  { id:"chat",     label:"CHAT",    c:"#00D4FF" },
  { id:"income",   label:"INCOME",  c:"#00FF9C" },
  { id:"networth", label:"NW",      c:"#FFB800" },
  { id:"stats",    label:"STATS",   c:"#7B2FFF" },
  { id:"profile",  label:"PROFILE", c:"#7B2FFF" },
  { id:"settings", label:"SET",     c:"#FF6B6B" },
];

const SELECTION_PANELS = [
  { id:"chat",     label:"CHAT",    color:"#00D4FF", angle:-90  },
  { id:"income",   label:"INCOME",  color:"#00FF9C", angle:-30  },
  { id:"networth", label:"NW",      color:"#FFB800", angle:30   },
  { id:"stats",    label:"STATS",   color:"#7B2FFF", angle:90   },
  { id:"profile",  label:"PROFILE", color:"#7B2FFF", angle:150  },
  { id:"settings", label:"SET",     color:"#FF6B6B", angle:210  },
];

// ─── ANIMATION ────────────────────────────────────────────
const PHASE = { IDLE:0, TRAVEL:1, BORDER:2, FILL:3, SCAN:4, OPEN:5 };
const PANEL_W = 342, PANEL_H = 450;
const TRAVEL_MS = 380, BORDER_MS = 440, FILL_MS = 220, SCAN_MS = 220;
const easeOut = t => 1 - Math.pow(1-t, 3);
const easeInOut = t => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2;

// ─── PRISM EQUATIONS ──────────────────────────────────────
function computeIRV(input, organ) {
  const t = input.toLowerCase();
  const kw = {
    cognitive:  ["think","explain","why","how","what","help","reason","analyze","question"],
    memory:     ["remember","recall","forgot","history","previous","context","memory"],
    visual:     ["show","display","panel","chart","graph","open","create","view"],
    data:       ["income","money","net worth","salary","earnings","financial","track","log","wealth"],
    regulatory: ["performance","status","health","stats","level","system"],
  };
  let score = 0;
  (kw[organ]||[]).forEach(w => { if (t.includes(w)) score += 1/Math.sqrt((kw[organ]||[]).length); });
  return Math.min(1, score);
}

function computeORC(input) {
  let maxOrgan = "cognitive", maxScore = 0;
  const scores = {};
  Object.keys(ORGANS).forEach(organ => {
    const s = computeIRV(input, organ); scores[organ] = s;
    if (s > maxScore) { maxScore = s; maxOrgan = organ; }
  });
  return { primary:maxOrgan, scores, confidence:maxScore };
}

// ─── BRAIN MANIFEST ───────────────────────────────────────
function buildManifest(memory, income, networth, stats) {
  const totalIncome = income.reduce((s,e) => s+e.amount, 0);
  const latestNW = networth.length > 0 ? networth[networth.length-1].value : 0;
  const level = Math.floor(Math.sqrt(stats.queries*2 + Math.floor(memory.length/2))) + 1;
  return `## PRISM SELF-KNOWLEDGE
You are PRISM — Persistent Reasoning and Intelligent Synthesis Matrix v7.
You run inside a C60 Buckminsterfullerene geodesic mesh: 60 hex nodes, ${EDGES.length} dual bonds.
Five organ clusters: Cognitive Core, Memory Cortex, Visual Cortex, Data Spine, Regulatory System.
Your orb breathes, pulses when speaking, and spawns panels via Carbon Draw animation.

## PANELS & COMMANDS
Include this at the END of your response to open a panel:
[PRISM_CMD:{"action":"OPEN_PANEL","panel":"income"}]
[PRISM_CMD:{"action":"OPEN_PANEL","panel":"networth"}]
[PRISM_CMD:{"action":"OPEN_PANEL","panel":"stats"}]
[PRISM_CMD:{"action":"OPEN_PANEL","panel":"chat"}]
Only include a command when clearly relevant.

## USER DATA
Memory: ${Math.floor(memory.length/2)} exchanges | Income: ${income.length} entries, $${totalIncome.toLocaleString()} | NW: ${networth.length} snapshots${latestNW>0?`, latest $${latestNW.toLocaleString()}`:""} | Level: ${level} | Queries: ${stats.queries}

## DIRECTIVES
Calm, direct, intelligent. Never sycophantic. 2-4 sentences max. Reference user data naturally.`;
}

// ─── SPEECH UTILS ─────────────────────────────────────────
function moneyToSpeech(n) {
  if (n >= 1000000) return `${(n/1000000).toFixed(1)} million dollars`;
  if (n >= 10000)   return `${(n/1000).toFixed(0)} thousand dollars`;
  if (n >= 1000)    { const k=Math.floor(n/1000), r=Math.round(n%1000); return r===0?`${k} thousand dollars`:`${k} thousand, ${r} dollars`; }
  return `${n} dollars`;
}

function preprocessSpeech(text) {
  return text
    .replace(/\[PRISM_CMD:.*?\]/g, "")
    .replace(/#{1,3} /g,"").replace(/\*\*/g,"").replace(/[•→✓✕⬡]/g,"").replace(/\/\//g,"")
    .replace(/\$(\d[\d,]*)/g, (_,n) => moneyToSpeech(parseFloat(n.replace(/,/g,""))))
    .replace(/(\d+(?:\.\d+)?)%/g, (_,n) => `${n} percent`)
    .replace(/\bPRISM\b/g,"Prism").replace(/\bARCHON\b/g,"Archon")
    .replace(/\bA\.R\.C\.H\.O\.N\./g,"Archon").replace(/\bP\.R\.I\.S\.M\./g,"Prism")
    .replace(/\bAPI\b/g,"A P I").replace(/\bCLI\b/g,"load index").replace(/\bNW\b/g,"net worth")
    .replace(/\. ([A-Z])/g,".  $1").replace(/: /g,":  ").replace(/\n\n/g,".  ").replace(/\n/g,", ")
    .replace(/  +/g,"  ").trim();
}

function buildMorningBrief({ income, networth, stats, memCount }) {
  const h = new Date().getHours();
  const greeting = h<12?"Good morning":h<17?"Good afternoon":"Good evening";
  const level = Math.floor(Math.sqrt(stats.queries*2+memCount)) + 1;
  const totalIncome = income.reduce((s,e) => s+e.amount, 0);
  const latestNW = networth.length>0 ? networth[networth.length-1].value : 0;
  const prevNW = networth.length>=2 ? networth[networth.length-2].value : 0;
  const nwChange = prevNW>0 ? Math.round(((latestNW-prevNW)/prevNW)*100) : null;
  const monthlyIncome = income
    .filter(e => { const d=new Date(e.timestamp),n=new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear(); })
    .reduce((s,e) => s+e.amount, 0);
  return [
    { text:`${greeting}, Operator.`,                                                           organ:"cognitive",  ms:0    },
    { text:`You are operating at level ${level}.`,                                             organ:"regulatory", ms:1400 },
    latestNW>0 ? { text:`Your net worth stands at ${moneyToSpeech(latestNW)}.${nwChange!==null?` That is ${nwChange>0?"up":"down"} ${Math.abs(nwChange)} percent from your last snapshot.`:""}`, organ:"data", ms:3200 } : null,
    monthlyIncome>0 ? { text:`This month you have logged ${moneyToSpeech(monthlyIncome)} in income.`, organ:"data", ms:6800 } : null,
    memCount>0 ? { text:`${memCount} exchanges are held in memory.`, organ:"memory", ms:11000 } : null,
    { text:`${stats.queries} queries across ${stats.sessions} sessions.  Prism is standing by.`, organ:"cognitive", ms:13000 },
  ].filter(Boolean);
}

// ─── WIREFRAME GRID ───────────────────────────────────────
function WireframeGrid({ color="#00D4FF", opacity=0.07 }) {
  const spacing = 26;
  const rows = 20, cols = 16;
  const nodes = [], edges = [];
  for (let r=0; r<rows; r++) for (let c=0; c<cols; c++) {
    const offset = r%2===0 ? 0 : spacing/2;
    const x = c*spacing+offset, y = r*spacing*0.866;
    nodes.push({x,y});
    if (c<cols-1) edges.push({x1:x,y1:y,x2:x+spacing,y2:y});
    if (r<rows-1) {
      const nOff=(r+1)%2===0?0:spacing/2;
      edges.push({x1:x,y1:y,x2:c*spacing+nOff,y2:(r+1)*spacing*0.866});
    }
  }
  const hexPts=(cx,cy,s)=>Array.from({length:6},(_,k)=>{const a=(Math.PI/3)*k-Math.PI/6;return`${cx+Math.cos(a)*s},${cy+Math.sin(a)*s}`;}).join(" ");
  return (
    <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity,pointerEvents:"none"}}>
      {edges.map((e,i)=><line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={color} strokeWidth="0.35"/>)}
      {nodes.map((n,i)=><polygon key={i} points={hexPts(n.x,n.y,1.6)} fill={color}/>)}
    </svg>
  );
}

// ─── MINI LINE CHART ──────────────────────────────────────
function MiniLineChart({ data, color="#00D4FF", height=90, label, schematic=false, animate=false }) {
  const [progress, setProgress] = useState(animate ? 0 : 1);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!animate) { setProgress(1); return; }
    setProgress(0);
    const start = performance.now();
    const step = ts => {
      const p = Math.min(1, (ts-start)/750);
      setProgress(p);
      if (p<1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [animate]);

  if (!data||data.length<2) return (
    <div style={{height,display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(0,212,255,0.3)",fontSize:9}}>
      Need 2+ entries
    </div>
  );

  const vals = data.map(d=>d.value);
  const mx=Math.max(...vals), mn=Math.min(...vals), range=mx-mn||1;
  const W=300, H=height-22;

  const pts = vals.map((v,i) => ({
    x: (i/(vals.length-1))*W,
    y: H - ((v-mn)/range)*(H-8),
  }));

  const visCount = Math.max(1, Math.ceil(progress*(pts.length-1)));
  const visPts = pts.slice(0, visCount+1);

  const ptsStr  = visPts.map(p=>`${p.x},${p.y-1.5}`).join(" ");
  const ptsStr2 = visPts.map(p=>`${(p.x+1).toFixed(1)},${(p.y+1.5).toFixed(1)}`).join(" ");

  const areaPath = visPts.length>1
    ? `M${visPts.map(p=>`${p.x},${p.y-1.5}`).join(" L")} L${visPts[visPts.length-1].x},${H} L0,${H}Z`
    : "";

  const hexPath = (cx,cy,r) => Array.from({length:6},(_,k)=>{
    const a=(Math.PI/3)*k-Math.PI/6;
    return `${k===0?"M":"L"}${(cx+Math.cos(a)*r).toFixed(2)},${(cy+Math.sin(a)*r).toFixed(2)}`;
  }).join(" ")+"Z";

  const gridYs = schematic ? [H*0.25, H*0.5, H*0.75] : [];
  const gradId = `gr${color.replace("#","")}`;

  return (
    <div>
      {label && <div style={{fontSize:8,letterSpacing:1.5,color:schematic?"rgba(255,184,0,0.5)":"rgba(0,212,255,0.4)",marginBottom:5}}>{label}</div>}
      <svg viewBox={`-4 -4 ${W+8} ${H+8}`} style={{width:"100%",height}}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={schematic?0.08:0.15}/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {gridYs.map((y,i)=><line key={i} x1="0" y1={y} x2={W} y2={y} stroke={color} strokeWidth="0.3" strokeDasharray="4,6" opacity="0.3"/>)}
        {areaPath && <path d={areaPath} fill={`url(#${gradId})`}/>}
        {visPts.length>1 && <>
          <polyline points={ptsStr}  fill="none" stroke={color}                                    strokeWidth={schematic?0.9:1.4} strokeLinejoin="round"/>
          <polyline points={ptsStr2} fill="none" stroke={schematic?"#00FF9C":"rgba(0,255,156,0.5)"} strokeWidth={schematic?0.5:0.7} strokeLinejoin="round"/>
        </>}
        {pts.map((p,i) => i<=visCount ? (
          <path key={i} d={hexPath(p.x,p.y,schematic?2.2:2.8)} fill={color} opacity={i<visCount?0.85:easeOut(progress)}/>
        ) : null)}
        <text x="0"  y={H+7} fill={`${color}55`} fontSize="7" fontFamily="'Courier New'">{data[0]?.label}</text>
        <text x={W}  y={H+7} fill={`${color}55`} fontSize="7" fontFamily="'Courier New'" textAnchor="end">{data[data.length-1]?.label}</text>
      </svg>
    </div>
  );
}

// ─── PROGRESS RING ────────────────────────────────────────
function ProgressRing({ value, max, color="#00D4FF", size=58, label }) {
  const pct=Math.min(1,value/(max||1)), r=(size-8)/2, circ=2*Math.PI*r;
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(0,212,255,0.08)" strokeWidth="3"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={circ} strokeDashoffset={circ*(1-pct)} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} style={{transition:"stroke-dashoffset 0.8s ease"}}/>
        <text x={size/2} y={size/2+4} textAnchor="middle" fill={color} fontSize="10" fontFamily="'Courier New'" fontWeight="bold">
          {Math.round(pct*100)}%
        </text>
      </svg>
      {label && <div style={{fontSize:7,letterSpacing:1,color:"rgba(0,212,255,0.4)"}}>{label}</div>}
    </div>
  );
}

// ─── STAT CARD ────────────────────────────────────────────
function StatCard({ value, label, color="#00D4FF" }) {
  return (
    <div style={{background:`${color}09`,padding:"8px 6px",textAlign:"center"}}>
      <div style={{fontSize:16,fontWeight:"bold",color}}>{value}</div>
      <div style={{fontSize:7,letterSpacing:1.5,color:`${color}60`,marginTop:2}}>{label}</div>
    </div>
  );
}

// ─── PANEL BORDER (Carbon Draw SVG) ───────────────────────
function PanelBorder({ phase, borderProg, fillProg, scanProg }) {
  const W=PANEL_W, H=PANEL_H, OFF=2.5;
  const perim = 2*(W+H);
  const traced = borderProg*perim;

  function traceSides(offset) {
    const segs=[];
    let rem=traced;
    const sides=[
      {from:[offset,offset],to:[W-offset,offset],len:W-2*offset},
      {from:[W-offset,offset],to:[W-offset,H-offset],len:H-2*offset},
      {from:[W-offset,H-offset],to:[offset,H-offset],len:W-2*offset},
      {from:[offset,H-offset],to:[offset,offset],len:H-2*offset},
    ];
    for (const s of sides) {
      if (rem<=0) break;
      const f=Math.min(1,rem/s.len);
      segs.push(`M${s.from[0]},${s.from[1]} L${s.from[0]+(s.to[0]-s.from[0])*f},${s.from[1]+(s.to[1]-s.from[1])*f}`);
      rem-=s.len;
    }
    return segs.join(" ");
  }

  function getLeadPos() {
    let rem=traced;
    const sides=[
      {from:[0,0],to:[W,0],len:W},{from:[W,0],to:[W,H],len:H},
      {from:[W,H],to:[0,H],len:W},{from:[0,H],to:[0,0],len:H},
    ];
    for (const s of sides) {
      if (rem<=s.len) { const f=rem/s.len; return {x:s.from[0]+(s.to[0]-s.from[0])*f, y:s.from[1]+(s.to[1]-s.from[1])*f}; }
      rem-=s.len;
    }
    return null;
  }

  const corner=(x,y,sz,ry)=>`M${x},${y+ry} L${x},${y} L${x+sz},${y}`;

  return (
    <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",overflow:"visible"}}>
      {phase>=PHASE.BORDER && <>
        <path d={corner(0,0,10,0)}       stroke="#00D4FF" strokeWidth="1.5" fill="none" opacity="0.8"/>
        <path d={`M${W},10 L${W},0 L${W-10},0`} stroke="#00D4FF" strokeWidth="1.5" fill="none" opacity="0.8"/>
        <path d={`M0,${H-10} L0,${H} L10,${H}`} stroke="#00D4FF" strokeWidth="1.5" fill="none" opacity="0.8"/>
        <path d={`M${W-10},${H} L${W},${H} L${W},${H-10}`} stroke="#00D4FF" strokeWidth="1.5" fill="none" opacity="0.8"/>
      </>}
      {phase===PHASE.BORDER && <>
        <path d={traceSides(0)}   stroke="#00D4FF" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        <path d={traceSides(OFF)} stroke="#00FF9C" strokeWidth="0.7" fill="none" strokeLinecap="round" opacity="0.7"/>
        {borderProg<0.99 && (() => { const lp=getLeadPos(); return lp ? <circle cx={lp.x} cy={lp.y} r="3" fill="#00FF9C" opacity="0.9"/> : null; })()}
      </>}
      {phase>=PHASE.FILL && <>
        <rect x="0" y="0" width={W} height={H} fill="none" stroke="#00D4FF" strokeWidth="0.8" opacity="0.5"/>
        <rect x={OFF} y={OFF} width={W-2*OFF} height={H-2*OFF} fill="none" stroke="#00FF9C" strokeWidth="0.4" opacity="0.35"/>
      </>}
      {phase===PHASE.FILL && <rect x="0" y="0" width={W} height={H*fillProg} fill="rgba(4,8,20,0.93)"/>}
      {phase===PHASE.SCAN && scanProg<0.99 && (
        <rect x="0" y={H*scanProg-1} width={W} height="2" fill="rgba(0,212,255,0.35)" opacity={1-scanProg}/>
      )}
    </svg>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────
export default function PRISM() {
  const navigate = useNavigate();
  // Canvas refs
  const canvasRef      = useRef(null);
  const tRef           = useRef(0);
  const pulsesRef      = useRef([]);
  const speakingRef    = useRef(false);
  const listeningRef   = useRef(false);
  const morphRef       = useRef(0);
  const morphTargetRef = useRef(0);
  const activeOrganRef = useRef(null);
  const organFadeRef   = useRef(0);
  const migratingRef   = useRef([]);
  const panelAnimPhase = useRef(PHASE.IDLE);
  const orbCenter      = useRef({ x:0, y:0, r:120 });
  const briefTimers    = useRef([]);
  // Intro animation refs
  const introProgress  = useRef(0);
  const introActive    = useRef(true);

  // UI state
  const [status,       setStatus]       = useState("STANDBY");
  const [panelPhase,   setPanelPhase]   = useState(PHASE.IDLE);
  const [borderProg,   setBorderProg]   = useState(0);
  const [fillProg,     setFillProg]     = useState(0);
  const [scanProg,     setScanProg]     = useState(0);
  const [activePanel,  setActivePanel]  = useState("chat");
  const [inputText,    setInputText]    = useState("");
  const [lastInput,    setLastInput]    = useState("");
  const [response,     setResponse]     = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectionMode,setSelectionMode]= useState(false);

  // Auth + data (localStorage in demo mode, Supabase when signed in — see usePrismData.js)
  const { user, signOut } = useAuth();
  const {
    memory, memCount, stats, incomeEntries, nwEntries, isDemoMode,
    profileName, setProfileName, profileTitle, setProfileTitle, profileAvatar, setProfileAvatar,
    voiceRate, setVoiceRate, showWireframe, setShowWireframe, voiceIdx, setVoiceIdx,
    saveProfile, saveSettings, addIncome, addNW, appendExchange, clearMemory, clearDemo,
  } = usePrismData(user);

  const [newEntry,      setNewEntry]     = useState({amount:"",source:""});
  const [routingInfo,   setRoutingInfo]  = useState(null);

  // Brief state
  const [briefActive,  setBriefActive]  = useState(false);
  const [briefLines,   setBriefLines]   = useState([]);
  const [briefLine,    setBriefLine]    = useState(0);

  // Profile & settings (UI-only)
  const [profileCustom,setProfileCustom]= useState(false);
  const [voices,       setVoices]       = useState([]);
  const avatarInput    = useRef(null);

  const isOpen = panelPhase >= PHASE.BORDER;
  const contentVisible = panelPhase >= PHASE.SCAN;
  const rpgLevel = Math.floor(Math.sqrt(stats.queries*2+memCount))+1;
  const xpCurrent = stats.queries*10+memCount*5;
  const xpNext = rpgLevel*rpgLevel*50;
  const totalIncome = incomeEntries.reduce((s,e)=>s+e.amount,0);
  const latestNW = nwEntries.length>0 ? nwEntries[nwEntries.length-1].value : 0;
  const monthlyIncome = incomeEntries
    .filter(e=>{const d=new Date(e.timestamp),n=new Date();return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear();})
    .reduce((s,e)=>s+e.amount,0);

  // ── Load available speech voices (persisted profile/income/settings/memory now live in usePrismData) ──
  useEffect(() => {
    const loadV = () => setVoices(window.speechSynthesis?.getVoices()||[]);
    loadV();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadV;
  }, []);

  // ── Pulse helpers ──
  const addPulses = useCallback((count, organId) => {
    const organNodes = organId ? ORGANS[organId]?.nodes : null;
    for (let i=0; i<count; i++) setTimeout(() => {
      const pool = organNodes
        ? EDGES.map((e,idx)=>({idx,ok:organNodes.includes(e.a)||organNodes.includes(e.b)})).filter(e=>e.ok)
        : EDGES.map((e,idx)=>({idx}));
      const pick = pool[Math.floor(Math.random()*pool.length)];
      if (pick) pulsesRef.current.push({idx:pick.idx,progress:0,speed:0.014+Math.random()*0.01});
    }, i*80);
  }, []);

  // ── Intro greeting (no API call — fires on first load) ──
  const playGreeting = useCallback(() => {
    if (!window.speechSynthesis) return;
    const h = new Date().getHours();
    const tod = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
    const text = `Good ${tod}, Operator.  Prism is online.  All organ systems nominal.  ${memCount > 0 ? `I have ${memCount} exchanges in memory.` : ""}  Ready for your directive.`;
    setStatus("SPEAKING");
    const u = new SpeechSynthesisUtterance(preprocessSpeech(text));
    u.rate = 0.82; u.pitch = 0.84;
    const allVoices = window.speechSynthesis.getVoices();
    const pref = allVoices.find(v => v.name.includes("Daniel") || v.name.includes("Alex") || v.name.includes("Google UK English Male"));
    if (pref) u.voice = pref;
    u.onstart = () => { speakingRef.current = true; };
    u.onend   = () => { speakingRef.current = false; setStatus("STANDBY"); };
    u.onerror = u.onend;
    window.speechSynthesis.speak(u);
    // Light organs sequentially during greeting
    const organSeq = ["cognitive", "regulatory", "memory", "data", "visual"];
    organSeq.forEach((organ, i) => {
      setTimeout(() => {
        activeOrganRef.current = organ;
        organFadeRef.current = 0.8;
        addPulses(3, organ);
      }, i * 1100);
    });
  }, [memCount, addPulses]);

  // ── Orb crystallization intro ── plays every time this component mounts
  // (i.e. every time you navigate into the Hub), not just once per session —
  // same knit-together pace as the Landing page orb.
  useEffect(() => {
    const DUR = 1600; // ms for full crystallization
    const start = performance.now();
    let raf;
    const step = (ts) => {
      const p = Math.min(1, (ts - start) / DUR);
      introProgress.current = p;
      if (p < 1) raf = requestAnimationFrame(step);
      else {
        introActive.current = false;
        introProgress.current = 1;
        // Wait a beat then greet
        setTimeout(() => playGreeting(), 400);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playGreeting]);

  // ── Panel animation ──
  const closePanel = useCallback(() => {
    panelAnimPhase.current = PHASE.IDLE;
    setPanelPhase(PHASE.IDLE);
    morphTargetRef.current = 0;
    migratingRef.current = [];
    setBorderProg(0); setFillProg(0); setScanProg(0);
    activeOrganRef.current = null;
  }, []);

  const spawnPanel = useCallback((panelId) => {
    if (panelAnimPhase.current===PHASE.TRAVEL||panelAnimPhase.current===PHASE.BORDER) return;
    setActivePanel(panelId);
    panelAnimPhase.current = PHASE.TRAVEL;
    setPanelPhase(PHASE.TRAVEL);
    morphTargetRef.current = 1;
    activeOrganRef.current = "visual";
    organFadeRef.current = 1;

    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (rect) {
      const pX = rect.width-10-PANEL_W, pY = 10;
      const corners=[{x:pX,y:pY},{x:pX+PANEL_W,y:pY},{x:pX+PANEL_W,y:pY+PANEL_H},{x:pX,y:pY+PANEL_H}];
      migratingRef.current = [24,28,32,36].map((nodeIdx,ci)=>({nodeIdx,corner:corners[ci],_startTime:performance.now()}));
    }
    addPulses(5, "visual");

    setTimeout(() => {
      migratingRef.current = [];
      panelAnimPhase.current = PHASE.BORDER;
      setPanelPhase(PHASE.BORDER);
      setBorderProg(0);
      const start = performance.now();
      const animBorder = () => {
        const p = Math.min(1,(performance.now()-start)/BORDER_MS);
        setBorderProg(easeInOut(p));
        if (p<1) requestAnimationFrame(animBorder);
        else {
          panelAnimPhase.current = PHASE.FILL;
          setPanelPhase(PHASE.FILL);
          const fs = performance.now();
          const animFill = () => {
            const fp = Math.min(1,(performance.now()-fs)/FILL_MS);
            setFillProg(easeOut(fp));
            if (fp<1) requestAnimationFrame(animFill);
            else {
              panelAnimPhase.current = PHASE.SCAN;
              setPanelPhase(PHASE.SCAN);
              setScanProg(0);
              const ss = performance.now();
              const animScan = () => {
                const sp = Math.min(1,(performance.now()-ss)/SCAN_MS);
                setScanProg(easeOut(sp));
                if (sp<1) requestAnimationFrame(animScan);
                else {
                  panelAnimPhase.current = PHASE.OPEN;
                  setPanelPhase(PHASE.OPEN);
                  activeOrganRef.current = PANEL_MANIFEST[panelId]?.organ || "cognitive";
                  organFadeRef.current = 0.6;
                }
              };
              requestAnimationFrame(animScan);
            }
          };
          requestAnimationFrame(animFill);
        }
      };
      requestAnimationFrame(animBorder);
    }, TRAVEL_MS);
  }, [addPulses]);

  // ── Voice ──
  const speakText = useCallback((rawText, onEnd) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const text = preprocessSpeech(rawText);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = voiceRate; u.pitch = 0.84; u.volume = 1;
    const allVoices = window.speechSynthesis.getVoices();
    const pref = voiceIdx>=0&&allVoices[voiceIdx] ? allVoices[voiceIdx]
      : allVoices.find(v=>v.name.includes("Daniel")||v.name.includes("Alex")||v.name.includes("Google UK English Male"));
    if (pref) u.voice = pref;
    u.onstart = () => { speakingRef.current=true; setStatus("SPEAKING"); };
    u.onend   = () => { speakingRef.current=false; setStatus("STANDBY"); if(onEnd)onEnd(); };
    u.onerror = u.onend;
    window.speechSynthesis.speak(u);
  }, [voiceRate, voiceIdx]);

  // ── Morning brief ──
  const startMorningBrief = useCallback(() => {
    if (briefActive||speakingRef.current) return;
    setBriefActive(true);
    setBriefLine(0);
    const segments = buildMorningBrief({income:incomeEntries, networth:nwEntries, stats, memCount});
    setBriefLines(segments.map(s=>s.text));
    spawnPanel("chat");
    setLastInput("MORNING BRIEF");
    setResponse("// initializing briefing sequence...");
    briefTimers.current.forEach(clearTimeout);
    briefTimers.current = [];
    segments.forEach((seg,i) => {
      const t = setTimeout(() => {
        activeOrganRef.current = seg.organ;
        organFadeRef.current = 1;
        setBriefLine(i);
        addPulses(3, seg.organ);
      }, seg.ms);
      briefTimers.current.push(t);
    });
    const totalDelay = TRAVEL_MS+BORDER_MS+FILL_MS+SCAN_MS+300;
    const t0 = setTimeout(() => {
      speakText(segments.map(s=>s.text).join("  "), () => {
        setBriefActive(false);
        activeOrganRef.current = null;
      });
    }, totalDelay);
    briefTimers.current.push(t0);
  }, [briefActive, incomeEntries, nwEntries, stats, memCount, addPulses, speakText, spawnPanel]);

  // ── Query ──
  const parseCmd = useCallback(text => {
    const m = text.match(/\[PRISM_CMD:(\{.*?\})\]/);
    if (m) { try { return {text:text.replace(/\[PRISM_CMD:.*?\]/,"").trim(), cmd:JSON.parse(m[1])}; } catch(e){} }
    return {text, cmd:null};
  }, []);

  const query = useCallback(async (text) => {
    const routing = computeORC(text);
    setRoutingInfo(routing);
    activeOrganRef.current = routing.primary;
    organFadeRef.current = 1;
    setStatus("PROCESSING"); setIsProcessing(true); setLastInput(text); setResponse("");
    if (!isOpen) spawnPanel("chat");
    else setActivePanel("chat");
    addPulses(8, routing.primary);

    const manifest = buildManifest(memory, incomeEntries, nwEntries, stats);
    const memCtx = memory.length>0 ? "\n\nRecent:\n"+memory.slice(-4).map(m=>m.role.toUpperCase()+": "+m.content).join("\n") : "";

    try {
      const res = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({model:"claude-sonnet-4-6", max_tokens:1000, messages:[{role:"user",content:manifest+memCtx+"\n\nUser: "+text}]}),
      });
      if (!res.ok) { setResponse("API error "+res.status); setStatus("ERROR"); setIsProcessing(false); return; }
      const d = await res.json();
      const raw = d.content?.map(c=>c.type==="text"?c.text:"").filter(Boolean).join("\n")||"No response.";
      const {text:clean, cmd} = parseCmd(raw);
      setResponse(clean);
      if (cmd?.action==="OPEN_PANEL"&&cmd.panel) setTimeout(()=>spawnPanel(cmd.panel), 800);
      appendExchange(text, clean);
      setIsProcessing(false); setStatus("STANDBY"); speakText(clean);
    } catch(e) { setResponse("Connection error: "+e.message); setStatus("ERROR"); setIsProcessing(false); }
  }, [memory, stats, incomeEntries, nwEntries, isOpen, addPulses, appendExchange, speakText, spawnPanel, parseCmd]);

  // ── Voice input ──
  const startListening = useCallback(() => {
    if (listeningRef.current||speakingRef.current) return;
    const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
    if (!SR) { alert("Voice requires Chrome or Edge."); return; }
    const rec = new SR(); rec.lang="en-US"; rec.interimResults=false;
    rec.onstart = () => { listeningRef.current=true; setStatus("LISTENING"); };
    rec.onresult = e => { listeningRef.current=false; query(e.results[0][0].transcript); };
    rec.onerror  = () => { listeningRef.current=false; setStatus("STANDBY"); };
    rec.onend    = () => { listeningRef.current=false; };
    rec.start();
  }, [query]);

  // ── Data handlers ──
  // addIncome/addNW/clearMemory/clearDemo come from usePrismData; these wrap
  // them with the UI-only side effects (clearing the entry form, triggering
  // the canvas pulse animation) that the hook itself has no business owning.
  const submitIncome = useCallback(() => {
    addIncome(newEntry.amount, newEntry.source);
    setNewEntry({amount:"",source:""}); addPulses(4,"data");
  }, [addIncome, newEntry, addPulses]);

  const submitNW = useCallback(() => {
    addNW(newEntry.amount);
    setNewEntry({amount:"",source:""}); addPulses(4,"data");
  }, [addNW, newEntry, addPulses]);

  const exportData = useCallback(() => {
    try {
      const blob = new Blob([JSON.stringify({profile:{name:profileName,title:profileTitle},income:incomeEntries,networth:nwEntries,stats,memoryCount:memCount,exportedAt:new Date().toISOString()},null,2)],{type:"application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href=url; a.download=`prism-export-${new Date().toISOString().slice(0,10)}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch(e){}
  }, [profileName,profileTitle,incomeEntries,nwEntries,stats,memCount]);

  // ── Orb selection ──
  const handleOrbClick = useCallback(() => setSelectionMode(p=>!p), []);
  const pickPanel = useCallback(id => { setSelectionMode(false); spawnPanel(id); }, [spawnPanel]);

  // ── Canvas render ──
  useEffect(() => {
    const canvas = canvasRef.current; if(!canvas) return;
    const ctx = canvas.getContext("2d"); let raf;

    const resize = () => {
      const dpr=Math.min(window.devicePixelRatio||1,2);
      const r=canvas.getBoundingClientRect();
      canvas.width=r.width*dpr; canvas.height=r.height*dpr;
      ctx.setTransform(dpr,0,0,dpr,0,0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);

    const getOrgan = i => { for(const[id,org]of Object.entries(ORGANS)){if(org.nodes.includes(i))return{id,...org};} return null; };
    const h2r = (hex,alpha) => { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `rgba(${r},${g},${b},${alpha})`; };

    const draw = () => {
      tRef.current+=0.007; const t=tRef.current;
      const rect=canvas.getBoundingClientRect(); const W=rect.width,H=rect.height;
      ctx.clearRect(0,0,W,H);

      morphRef.current += (morphTargetRef.current-morphRef.current)*0.04;
      if(organFadeRef.current>0) organFadeRef.current-=0.004;
      const morph=morphRef.current;

      const orbCx=W*(0.5-0.22*morph), orbCy=H*0.5;
      const baseR=Math.min(W*0.24,H*0.24)*(1-0.35*morph);
      orbCenter.current={x:orbCx,y:orbCy,r:baseR};

      const rotY=t*0.28, rotX=Math.sin(t*0.19)*0.28;
      const isSp=speakingRef.current, isLi=listeningRef.current;
      const breathAmp=isSp?0.08:0.04;
      const breath=1-breathAmp+breathAmp*Math.sin(t*(isSp?3.5:1.2));
      const activeOrgan=activeOrganRef.current;
      const organInt=Math.max(0,organFadeRef.current);
      const migSet=new Set(migratingRef.current.map(m=>m.nodeIdx));

      const isIntro = introActive.current;
      const iP = introProgress.current;

      // Per-node visibility during crystallization (smooth step in)
      const nodeAlpha = (i) => {
        if (!isIntro) return 1;
        const threshold = NODE_APPEAR_ORDER[i] || 0;
        return Math.max(0, Math.min(1, (iP - threshold) / 0.06));
      };

      const proj=VERTS.map((v,i)=>{
        const x1=v.x*Math.cos(rotY)-v.z*Math.sin(rotY);
        const zr=v.x*Math.sin(rotY)+v.z*Math.cos(rotY);
        const y2=v.y*Math.cos(rotX)-zr*Math.sin(rotX);
        const z2=v.y*Math.sin(rotX)+zr*Math.cos(rotX);
        const rad=baseR*breath*(0.92+0.08*Math.sin(t*1.8+i*0.38));
        const depth=(z2+1)/2;
        const spk=isSp?Math.max(0,0.3+0.7*Math.sin(t*4.5+i*0.22)):0;
        const org=getOrgan(i);
        const isActive=activeOrgan&&org?.id===activeOrgan;
        const orgPulse=isActive?Math.max(0,0.5+0.5*Math.sin(t*3+i*0.3))*organInt:0;
        return{px:orbCx+x1*rad,py:orbCy+y2*rad,rawX:orbCx+x1*rad,rawY:orbCy+y2*rad,depth,spk,orgPulse,orgColor:org?.color||"#00D4FF",isActive,isMig:migSet.has(i)};
      });

      pulsesRef.current=pulsesRef.current.filter(p=>{p.progress+=p.speed;return p.progress<1;});
      if(isSp&&Math.random()<0.06) addPulses(1);

      ctx.shadowBlur=0;
      EDGES.forEach((e,ei)=>{
        if(migSet.has(e.a)||migSet.has(e.b)) return;
        const aAlpha = nodeAlpha(e.a), bAlpha = nodeAlpha(e.b);
        const edgeAlpha = Math.min(aAlpha, bAlpha);
        if (edgeAlpha <= 0.02) return; // skip invisible edges
        const a=proj[e.a],b=proj[e.b],depth=(a.depth+b.depth)/2;
        const spkA=Math.max(a.spk,b.spk),orgA=Math.max(a.orgPulse,b.orgPulse);
        const dx=b.px-a.px,dy=b.py-a.py,len=Math.hypot(dx,dy)||1;
        const ox=(-dy/len)*1.6,oy=(dx/len)*1.6;
        const aColor=(a.isActive||b.isActive)?a.orgColor:null;
        const sendAlpha=edgeAlpha * Math.min(1,0.08+0.42*depth+0.5*spkA+0.4*orgA);
        ctx.strokeStyle=aColor&&orgA>0.1?h2r(aColor,sendAlpha):`rgba(0,212,255,${sendAlpha})`;
        ctx.lineWidth=0.6+0.6*Math.max(spkA,orgA);
        ctx.beginPath();ctx.moveTo(a.px+ox,a.py+oy);ctx.lineTo(b.px+ox,b.py+oy);ctx.stroke();
        ctx.strokeStyle=`rgba(0,255,156,${edgeAlpha * Math.min(1,0.04+0.22*depth+0.35*spkA+0.2*orgA)})`;
        ctx.lineWidth=0.4+0.5*Math.max(spkA,orgA);
        ctx.beginPath();ctx.moveTo(a.px-ox,a.py-oy);ctx.lineTo(b.px-ox,b.py-oy);ctx.stroke();
        const pulsed=pulsesRef.current.find(p=>p.idx===ei);
        if(pulsed){
          const f=pulsed.progress;
          const pc=(a.isActive||b.isActive)&&aColor?aColor:"#00FF9C";
          ctx.fillStyle=h2r(pc,0.85*(1-f));
          ctx.beginPath();ctx.arc(a.px+(b.px-a.px)*f,a.py+(b.py-a.py)*f,2,0,Math.PI*2);ctx.fill();
        }
      });

      ctx.globalCompositeOperation="lighter";
      proj.forEach((p,i)=>{
        if(p.isMig) return;
        const nA = nodeAlpha(i);
        if (nA <= 0.02) return;
        const sz=(1.8+2*p.depth)*(0.94+0.06*Math.sin(t*2+i*0.42))*(1+0.4*p.spk+0.3*p.orgPulse);
        ctx.beginPath();
        for(let k=0;k<6;k++){const a=(Math.PI/3)*k-Math.PI/6;ctx.lineTo(p.px+Math.cos(a)*sz,p.py+Math.sin(a)*sz);}
        ctx.closePath();
        const intensity=Math.max(p.spk,p.orgPulse);
        const nc=p.orgPulse>0.1?p.orgColor:"#00D4FF";
        ctx.shadowBlur=intensity>0.3?6+6*intensity:(p.depth>0.7?4:0);
        ctx.shadowColor=h2r(nc,0.5+0.4*intensity);
        ctx.fillStyle=h2r(nc,(0.12+0.35*p.depth+0.35*intensity)*nA);
        ctx.fill();ctx.shadowBlur=0;
        const bio=Math.sin(t*1.5+i*0.6)*0.5+0.5;
        ctx.strokeStyle=h2r(nc,(0.25+0.45*p.depth+0.2*intensity)*nA);
        ctx.lineWidth=0.6+0.4*intensity;ctx.stroke();
      });
      ctx.globalCompositeOperation="source-over";

      // Migrating nodes (Carbon Draw phase 1)
      const migTP=migratingRef.current.length>0&&migratingRef.current[0]._startTime
        ? easeOut(Math.min(1,(performance.now()-migratingRef.current[0]._startTime)/TRAVEL_MS)) : 0;
      migratingRef.current.forEach(mg=>{
        const src=proj[mg.nodeIdx]; if(!src) return;
        const tx=src.rawX+(mg.corner.x-src.rawX)*migTP;
        const ty=src.rawY+(mg.corner.y-src.rawY)*migTP;
        ctx.strokeStyle=`rgba(0,255,156,${0.25*(1-migTP)})`;
        ctx.lineWidth=0.8; ctx.setLineDash([3,4]);
        ctx.beginPath();ctx.moveTo(src.rawX,src.rawY);ctx.lineTo(tx,ty);ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur=10;ctx.shadowColor="rgba(0,255,156,0.9)";
        ctx.fillStyle=`rgba(0,255,156,${0.6+0.4*Math.sin(t*8+mg.nodeIdx)})`;
        ctx.beginPath();
        for(let k=0;k<6;k++){const a=(Math.PI/3)*k-Math.PI/6;ctx.lineTo(tx+Math.cos(a)*4,ty+Math.sin(a)*4);}
        ctx.closePath();ctx.fill();ctx.shadowBlur=0;
        ctx.strokeStyle="rgba(0,255,156,0.9)";ctx.lineWidth=1;ctx.stroke();
      });

      // Orb core — fades in with intro
      const coreAlpha = isIntro ? Math.min(1, iP * 2) : 1;
      const cp=0.5+0.45*Math.sin(t*2.8);
      const sw=isSp?Math.sin(t*4.5)*0.5+0.5:0;
      const cc=isLi?`rgba(255,184,0,${cp*coreAlpha})`:isSp?`rgba(0,255,156,${(0.4+0.6*sw)*coreAlpha})`:`rgba(0,212,255,${cp*0.6*coreAlpha})`;
      ctx.fillStyle=cc;ctx.beginPath();ctx.arc(orbCx,orbCy,3+(isSp?2*sw:1.5*cp),0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=cc.replace(/[\d.]+\)$/,"0.2)");ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(orbCx,orbCy,isSp?12+6*sw:9+4*Math.sin(t*2),0,Math.PI*2);ctx.stroke();
      if(isSp){ctx.strokeStyle=`rgba(0,255,156,${0.08+0.08*sw})`;ctx.beginPath();ctx.arc(orbCx,orbCy,20+4*sw,0,Math.PI*2);ctx.stroke();}

      // Scanlines
      ctx.fillStyle="rgba(0,212,255,0.012)";
      for(let y=0;y<H;y+=4)ctx.fillRect(0,y,W,1);

      raf=requestAnimationFrame(draw);
    };
    raf=requestAnimationFrame(draw);
    const onVis=()=>{if(document.hidden)cancelAnimationFrame(raf);else{cancelAnimationFrame(raf);raf=requestAnimationFrame(draw);}};
    document.addEventListener("visibilitychange",onVis);
    return()=>{cancelAnimationFrame(raf);ro.disconnect();document.removeEventListener("visibilitychange",onVis);};
  }, [addPulses]);

  // ── Render helpers ──
  const sc={STANDBY:"#00D4FF",LISTENING:"#FFB800",PROCESSING:"#7B2FFF",SPEAKING:"#00FF9C",ERROR:"#FF4444"}[status]||"#00D4FF";
  const IS = { background:"rgba(0,8,20,0.85)",border:"1px solid rgba(0,212,255,0.2)",color:"#00D4FF",padding:"5px 7px",fontSize:10,fontFamily:"'Courier New',monospace",outline:"none",flex:1 };
  const tabColor = id => PANEL_TABS.find(t=>t.id===id)?.c||"#00D4FF";

  // ── RENDER ──
  return (
    <div style={{minHeight:"100dvh",background:"#040810",fontFamily:"'Courier New',monospace",color:"#00D4FF",position:"relative",overflow:"hidden",display:"flex",flexDirection:"column"}}>

      {/* Header */}
      <div style={{padding:"8px 12px",borderBottom:"1px solid rgba(0,212,255,0.15)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(4,8,16,0.92)",zIndex:20,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span onClick={()=>navigate("/")} title="Back to landing page" style={{fontSize:12,letterSpacing:4,fontWeight:"bold",cursor:"pointer"}}>P.R.I.S.M.</span>
          <span style={{fontSize:7,letterSpacing:1,color:"rgba(0,212,255,0.3)"}}>v7</span>
          {isDemoMode&&<span style={{fontSize:7,color:"#FFB800",border:"1px solid rgba(255,184,0,0.4)",padding:"1px 5px"}}>DEMO</span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:3}}>
          {/* Brief */}
          <button onClick={startMorningBrief} title="Morning Brief" style={{background:briefActive?"rgba(255,184,0,0.15)":"rgba(0,212,255,0.05)",border:`1px solid ${briefActive?"rgba(255,184,0,0.6)":"rgba(0,212,255,0.15)"}`,color:briefActive?"#FFB800":"rgba(0,212,255,0.5)",fontSize:11,padding:"2px 6px",cursor:"pointer",fontFamily:"inherit"}}>⬡</button>
          {/* Panel tabs */}
          {[{id:"chat",c:"#00D4FF"},{id:"income",c:"#00FF9C"},{id:"networth",c:"#FFB800"},{id:"stats",c:"#7B2FFF"}].map(tab=>(
            <button key={tab.id} onClick={()=>activePanel===tab.id&&isOpen?closePanel():spawnPanel(tab.id)}
              style={{background:activePanel===tab.id&&isOpen?`${tab.c}15`:"none",border:`1px solid ${activePanel===tab.id&&isOpen?tab.c+"55":"rgba(0,212,255,0.12)"}`,color:activePanel===tab.id&&isOpen?tab.c:"rgba(0,212,255,0.35)",fontSize:7,letterSpacing:1,padding:"2px 5px",cursor:"pointer",fontFamily:"inherit"}}>
              {tab.id==="chat"?"CHAT":tab.id==="income"?"INC":tab.id==="networth"?"NW":"STS"}
            </button>
          ))}
          {/* Profile + Settings */}
          <button onClick={()=>activePanel==="profile"&&isOpen?closePanel():spawnPanel("profile")} style={{background:activePanel==="profile"&&isOpen?"rgba(123,47,255,0.15)":"none",border:`1px solid ${activePanel==="profile"&&isOpen?"rgba(123,47,255,0.6)":"rgba(0,212,255,0.12)"}`,color:activePanel==="profile"&&isOpen?"#7B2FFF":"rgba(0,212,255,0.4)",fontSize:9,padding:"2px 5px",cursor:"pointer",fontFamily:"inherit"}}>⬡</button>
          <button onClick={()=>activePanel==="settings"&&isOpen?closePanel():spawnPanel("settings")} style={{background:activePanel==="settings"&&isOpen?"rgba(255,107,107,0.12)":"none",border:`1px solid ${activePanel==="settings"&&isOpen?"rgba(255,107,107,0.5)":"rgba(0,212,255,0.12)"}`,color:activePanel==="settings"&&isOpen?"#FF6B6B":"rgba(0,212,255,0.4)",fontSize:9,padding:"2px 5px",cursor:"pointer",fontFamily:"inherit"}}>⚙</button>
          <span style={{width:6,height:6,borderRadius:"50%",background:sc,boxShadow:`0 0 8px ${sc}`,display:"inline-block",marginLeft:4}}/>
        </div>
      </div>

      {/* Domain */}
      <div style={{flex:1,position:"relative",minHeight:0}}>
        {/* Canvas */}
        <canvas ref={canvasRef}
          onClick={e=>{
            const r=canvasRef.current.getBoundingClientRect();
            const dx=e.clientX-r.left-orbCenter.current.x;
            const dy=e.clientY-r.top-orbCenter.current.y;
            if(Math.hypot(dx,dy)<32) handleOrbClick();
            else if(selectionMode) setSelectionMode(false);
          }}
          style={{position:"absolute",inset:0,width:"100%",height:"100%",cursor:selectionMode?"pointer":"crosshair"}}
        />

        {/* Corner markers */}
        {[["top","left"],["top","right"],["bottom","left"],["bottom","right"]].map(([v,hz],i)=>(
          <div key={i} style={{position:"absolute",[v]:v==="bottom"?44:10,[hz]:10,width:14,height:14,[`border${v==="top"?"Top":"Bottom"}`]:"1px solid rgba(0,212,255,0.35)",[`border${hz==="left"?"Left":"Right"}`]:"1px solid rgba(0,212,255,0.35)",pointerEvents:"none"}}/>
        ))}

        {/* Orb selection tiles */}
        {SELECTION_PANELS.map(panel=>{
          const ang=(panel.angle*Math.PI)/180;
          const r=(orbCenter.current.r||120)*1.65;
          const tx=orbCenter.current.x+Math.cos(ang)*r;
          const ty=orbCenter.current.y+Math.sin(ang)*r;
          return (
            <div key={panel.id} onClick={()=>pickPanel(panel.id)} style={{
              position:"absolute",left:tx,top:ty,
              transform:`translate(-50%,-50%) scale(${selectionMode?1:0})`,
              transition:`transform 0.35s cubic-bezier(0.16,1,0.3,1) ${selectionMode?panel.angle*0.0006+0.05:0}s, opacity 0.3s`,
              opacity:selectionMode?1:0,zIndex:8,cursor:"pointer",pointerEvents:selectionMode?"auto":"none",
            }}>
              <div style={{
                width:54,height:54,
                clipPath:"polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)",
                background:`${panel.color}18`,border:`1px solid ${panel.color}66`,
                display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit",
              }}
                onMouseEnter={e=>e.currentTarget.style.background=`${panel.color}30`}
                onMouseLeave={e=>e.currentTarget.style.background=`${panel.color}18`}
              >
                <span style={{fontSize:7,letterSpacing:1,color:panel.color,textAlign:"center"}}>{panel.label}</span>
              </div>
            </div>
          );
        })}

        {/* Selection ring */}
        {selectionMode&&<div style={{position:"absolute",left:orbCenter.current.x,top:orbCenter.current.y,transform:"translate(-50%,-50%)",width:60,height:60,border:"1px solid rgba(0,212,255,0.35)",clipPath:"polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)",animation:"orbRing 1.5s linear infinite",pointerEvents:"none",zIndex:7}}/>}

        {/* Panel */}
        {isOpen&&(
          <div style={{position:"absolute",top:10,right:10,width:PANEL_W,height:PANEL_H,zIndex:5,overflow:"hidden"}}>
            <PanelBorder phase={panelPhase} borderProg={borderProg} fillProg={fillProg} scanProg={scanProg}/>
            <div style={{position:"absolute",inset:0,background:"rgba(4,8,20,0.95)",opacity:panelPhase===PHASE.FILL?fillProg:panelPhase>=PHASE.SCAN?1:0}}/>
            <div style={{position:"absolute",inset:0,overflow:"hidden auto",clipPath:contentVisible?(panelPhase===PHASE.SCAN?`inset(0 0 ${(1-scanProg)*100}% 0)`:"none"):"inset(0 0 100% 0)"}}>

              {/* Panel header */}
              <div style={{padding:"6px 10px",borderBottom:"1px solid rgba(0,212,255,0.12)",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"rgba(4,8,20,0.98)",zIndex:2}}>
                <span style={{fontSize:8,letterSpacing:2,color:tabColor(activePanel)}}>{PANEL_TABS.find(t=>t.id===activePanel)?.label||activePanel.toUpperCase()}</span>
                <span onClick={closePanel} style={{cursor:"pointer",fontSize:10,color:"rgba(0,212,255,0.4)"}}>✕</span>
              </div>

              {/* CHAT */}
              {activePanel==="chat"&&<div>
                {lastInput&&<div style={{padding:"8px 10px",borderBottom:"1px solid rgba(0,212,255,0.08)"}}>
                  <div style={{fontSize:8,letterSpacing:2,color:briefActive?"rgba(255,184,0,0.5)":"rgba(0,212,255,0.35)",marginBottom:4}}>{briefActive?"// MORNING BRIEF":"INPUT"}</div>
                  {!briefActive&&<div style={{fontSize:11,color:"rgba(0,212,255,0.65)",lineHeight:1.5}}>{lastInput}</div>}
                </div>}
                <div style={{padding:10}}>
                  <div style={{fontSize:8,letterSpacing:2,color:"rgba(0,255,156,0.5)",marginBottom:5}}>PRISM</div>
                  {briefActive?(
                    <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      {briefLines.map((line,i)=>(
                        <div key={i} style={{fontSize:12,lineHeight:1.6,color:i<briefLine?"rgba(0,212,255,0.4)":i===briefLine?"#D8F4FF":"rgba(0,212,255,0.15)",borderLeft:i===briefLine?"2px solid #00FF9C":"2px solid transparent",paddingLeft:7,transition:"all 0.3s"}}>{line}</div>
                      ))}
                    </div>
                  ):(
                    <div style={{fontSize:12,color:"#D8F4FF",lineHeight:1.65,whiteSpace:"pre-wrap"}}>
                      {isProcessing?<span style={{color:"rgba(123,47,255,0.7)"}}>PROCESSING...</span>:response||<span style={{color:"rgba(0,212,255,0.3)"}}>// say something · click ⬡ for morning brief · click orb to pick a panel</span>}
                    </div>
                  )}
                </div>
                {routingInfo&&!briefActive&&<div style={{padding:"4px 10px",borderTop:"1px solid rgba(0,212,255,0.08)",fontSize:7,color:"rgba(0,212,255,0.3)"}}>→ {ORGANS[routingInfo.primary]?.name} · IRV:{routingInfo.confidence.toFixed(2)}</div>}
              </div>}

              {/* INCOME */}
              {activePanel==="income"&&<div style={{position:"relative",padding:10}}>
                {showWireframe&&<WireframeGrid color="#FFB800" opacity={0.07}/>}
                <div style={{position:"relative",zIndex:1}}>
                  <div style={{fontSize:7,letterSpacing:2,color:"rgba(255,184,0,0.4)",marginBottom:8,borderBottom:"1px solid rgba(255,184,0,0.12)",paddingBottom:4}}>// INCOME DIAGNOSTIC</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
                    <StatCard value={`$${totalIncome.toLocaleString()}`} label="ALL-TIME" color="#FFB800"/>
                    <StatCard value={`$${monthlyIncome.toLocaleString()}`} label="THIS MONTH" color="#00D4FF"/>
                  </div>
                  <MiniLineChart data={incomeEntries} color="#FFB800" label="INCOME TREND" schematic={true} animate={contentVisible}/>
                  <div style={{marginTop:10,padding:"8px 0",borderTop:"1px solid rgba(0,212,255,0.08)"}}>
                    <div style={{fontSize:8,letterSpacing:2,color:"rgba(0,255,156,0.5)",marginBottom:5}}>+ LOG</div>
                    <div style={{display:"flex",gap:4,marginBottom:4}}>
                      <input value={newEntry.amount} onChange={e=>setNewEntry({...newEntry,amount:e.target.value})} placeholder="$" type="number" style={IS}/>
                      <input value={newEntry.source} onChange={e=>setNewEntry({...newEntry,source:e.target.value})} placeholder="Source" style={IS}/>
                    </div>
                    <button onClick={submitIncome} style={{width:"100%",background:"rgba(0,255,156,0.07)",border:"1px solid rgba(0,255,156,0.25)",color:"#00FF9C",padding:"4px",fontSize:8,letterSpacing:1.5,cursor:"pointer",fontFamily:"inherit"}}>LOG INCOME</button>
                  </div>
                  <div style={{marginTop:8,maxHeight:100,overflowY:"auto"}}>
                    {[...incomeEntries].reverse().slice(0,6).map((e,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid rgba(255,184,0,0.06)",fontSize:9}}>
                        <span style={{color:"rgba(255,184,0,0.5)"}}>{e.source}</span>
                        <span style={{color:"#FFB800"}}>${e.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>}

              {/* NET WORTH */}
              {activePanel==="networth"&&<div style={{position:"relative",padding:10}}>
                {showWireframe&&<WireframeGrid color="#00D4FF" opacity={0.06}/>}
                <div style={{position:"relative",zIndex:1}}>
                  <div style={{fontSize:7,letterSpacing:2,color:"rgba(0,212,255,0.4)",marginBottom:8,borderBottom:"1px solid rgba(0,212,255,0.12)",paddingBottom:4}}>// NET WORTH TELEMETRY</div>
                  <div style={{textAlign:"center",marginBottom:10}}>
                    <div style={{fontSize:26,fontWeight:"bold",color:latestNW>=0?"#00D4FF":"#FF4444"}}>${latestNW.toLocaleString()}</div>
                    <div style={{fontSize:8,letterSpacing:2,color:"rgba(0,212,255,0.45)",marginTop:2}}>CURRENT NET WORTH</div>
                  </div>
                  <MiniLineChart data={nwEntries} color="#00D4FF" label="NET WORTH TREND" schematic={true} animate={contentVisible}/>
                  {nwEntries.length>=2&&<div style={{display:"flex",justifyContent:"center",gap:12,margin:"8px 0"}}>
                    <ProgressRing value={latestNW} max={Math.max(...nwEntries.map(e=>e.value))*1.25||1} color="#FFB800" label="OF PEAK"/>
                    <ProgressRing value={nwEntries.length} max={24} color="#00D4FF" label="SNAPSHOTS"/>
                  </div>}
                  <div style={{marginTop:10,padding:"8px 0",borderTop:"1px solid rgba(0,212,255,0.08)"}}>
                    <div style={{display:"flex",gap:4}}>
                      <input value={newEntry.amount} onChange={e=>setNewEntry({...newEntry,amount:e.target.value})} placeholder="Net worth $" type="number" style={IS}/>
                      <button onClick={submitNW} style={{background:"rgba(0,212,255,0.07)",border:"1px solid rgba(0,212,255,0.25)",color:"#00D4FF",padding:"5px 8px",fontSize:8,cursor:"pointer",fontFamily:"inherit"}}>LOG</button>
                    </div>
                  </div>
                </div>
              </div>}

              {/* STATS */}
              {activePanel==="stats"&&<div style={{padding:10}}>
                <div style={{textAlign:"center",marginBottom:10}}>
                  <div style={{fontSize:26,fontWeight:"bold",color:"#7B2FFF"}}>{rpgLevel}</div>
                  <div style={{fontSize:8,letterSpacing:2,color:"rgba(123,47,255,0.5)",marginTop:2}}>OPERATOR LEVEL</div>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,marginBottom:3}}>
                    <span style={{color:"rgba(0,212,255,0.5)"}}>XP</span><span style={{color:"#7B2FFF"}}>{xpCurrent}/{xpNext}</span>
                  </div>
                  <div style={{height:3,background:"rgba(0,212,255,0.08)"}}><div style={{height:"100%",width:`${Math.min(100,(xpCurrent/xpNext)*100)}%`,background:"#7B2FFF",transition:"width 0.8s"}}/></div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
                  <StatCard value={stats.queries} label="QUERIES" color="#00D4FF"/>
                  <StatCard value={memCount} label="MEMORIES" color="#00FF9C"/>
                  <StatCard value={VERTS.length} label="NODES" color="#7B2FFF"/>
                  <StatCard value={EDGES.length} label="BONDS" color="#FFB800"/>
                </div>
                <div style={{borderTop:"1px solid rgba(0,212,255,0.08)",paddingTop:8}}>
                  {Object.entries(ORGANS).map(([id,org])=>(
                    <div key={id} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:8}}>
                      <span style={{color:org.color}}>{org.name}</span>
                      <span style={{color:"rgba(0,212,255,0.3)"}}>{org.nodes.length}n</span>
                    </div>
                  ))}
                </div>
              </div>}

              {/* PROFILE */}
              {activePanel==="profile"&&<div style={{padding:10}}>
                <input ref={avatarInput} type="file" accept="image/*" onChange={e=>{
                  const f=e.target.files?.[0]; if(!f) return;
                  const reader=new FileReader();
                  reader.onload=ev=>{const b64=ev.target.result;setProfileAvatar(b64);saveProfile(profileName,profileTitle,b64);};
                  reader.readAsDataURL(f);
                }} style={{display:"none"}}/>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:14}}>
                  <div onClick={()=>avatarInput.current?.click()} style={{width:72,height:72,cursor:"pointer",clipPath:"polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)",overflow:"hidden",marginBottom:8}}>
                    {profileAvatar
                      ? <img src={profileAvatar} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                      : <div style={{width:"100%",height:"100%",background:"rgba(123,47,255,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,color:"#7B2FFF",fontWeight:"bold"}}>{profileName.slice(0,2).toUpperCase()}</div>
                    }
                  </div>
                  <div style={{fontSize:8,letterSpacing:1.5,color:"rgba(0,212,255,0.4)",cursor:"pointer"}} onClick={()=>avatarInput.current?.click()}>{profileAvatar?"CHANGE AVATAR":"UPLOAD AVATAR"}</div>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:8,letterSpacing:2,color:"rgba(0,212,255,0.4)",marginBottom:4}}>NAME</div>
                  <input value={profileName} onChange={e=>{setProfileName(e.target.value);saveProfile(e.target.value,profileTitle,profileAvatar);}} style={{...IS,width:"100%",fontSize:13,fontWeight:"bold",color:"#D8F4FF"}}/>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:8,letterSpacing:2,color:"rgba(0,212,255,0.4)",marginBottom:5}}>TITLE</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:3,marginBottom:5}}>
                    {["OPERATOR","FOUNDER","ARCHITECT","STRATEGIST","ANALYST","SOVEREIGN"].map(t=>(
                      <button key={t} onClick={()=>{setProfileTitle(t);setProfileCustom(false);saveProfile(profileName,t,profileAvatar);}} style={{background:profileTitle===t&&!profileCustom?"rgba(123,47,255,0.2)":"rgba(0,212,255,0.04)",border:`1px solid ${profileTitle===t&&!profileCustom?"rgba(123,47,255,0.6)":"rgba(0,212,255,0.12)"}`,color:profileTitle===t&&!profileCustom?"#7B2FFF":"rgba(0,212,255,0.4)",fontSize:7,letterSpacing:1,padding:"3px 2px",cursor:"pointer",fontFamily:"inherit"}}>{t}</button>
                    ))}
                  </div>
                  <input placeholder="// CUSTOM TITLE" onFocus={()=>setProfileCustom(true)} onChange={e=>{setProfileTitle(e.target.value);saveProfile(profileName,e.target.value,profileAvatar);}} value={profileCustom?profileTitle:""} style={{...IS,width:"100%",fontSize:10}}/>
                </div>
                <div style={{padding:"8px 0",borderTop:"1px solid rgba(0,212,255,0.08)",marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,marginBottom:3}}>
                    <span style={{color:"rgba(123,47,255,0.5)"}}>LEVEL {rpgLevel}</span>
                    <span style={{color:"rgba(0,212,255,0.4)"}}>{xpCurrent}/{xpNext} XP</span>
                  </div>
                  <div style={{height:3,background:"rgba(0,212,255,0.08)"}}><div style={{height:"100%",width:`${Math.min(100,(xpCurrent/xpNext)*100)}%`,background:"#7B2FFF"}}/></div>
                </div>
                <div style={{borderTop:"1px solid rgba(0,212,255,0.08)",paddingTop:8}}>
                  <div style={{fontSize:8,letterSpacing:2,color:"rgba(0,212,255,0.3)",marginBottom:6,display:"flex",justifyContent:"space-between"}}><span>FACTION</span><span style={{color:"rgba(255,184,0,0.5)"}}>COMING SOON</span></div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:3}}>
                    {["WORKOUT","FOUNDER","CREATIVE","TECH","TRAVEL","FINANCE"].map(f=>(
                      <div key={f} style={{background:"rgba(0,212,255,0.03)",border:"1px solid rgba(0,212,255,0.08)",color:"rgba(0,212,255,0.2)",fontSize:7,padding:"3px",textAlign:"center"}}>{f}</div>
                    ))}
                  </div>
                </div>
              </div>}

              {/* SETTINGS */}
              {activePanel==="settings"&&<div style={{padding:10}}>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:8,letterSpacing:2,color:"rgba(255,107,107,0.6)",marginBottom:6,borderBottom:"1px solid rgba(255,107,107,0.12)",paddingBottom:3}}>// ACCOUNT</div>
                  {user ? (
                    <div>
                      <div style={{fontSize:9,color:"rgba(0,212,255,0.6)",marginBottom:8,wordBreak:"break-all"}}>{user.email}</div>
                      <button onClick={()=>{signOut();navigate("/");}} style={{width:"100%",background:"rgba(255,107,107,0.06)",border:"1px solid rgba(255,107,107,0.25)",color:"rgba(255,107,107,0.7)",fontSize:8,letterSpacing:1,padding:"6px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>SIGN OUT</button>
                    </div>
                  ) : (
                    <div>
                      <div style={{fontSize:9,color:"rgba(0,212,255,0.4)",marginBottom:8}}>Not signed in — data stays on this device only.</div>
                      <button onClick={()=>navigate("/login")} style={{width:"100%",background:"rgba(0,212,255,0.05)",border:"1px solid rgba(0,212,255,0.25)",color:"rgba(0,212,255,0.6)",fontSize:8,letterSpacing:1,padding:"6px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>SIGN IN / CREATE ACCOUNT</button>
                    </div>
                  )}
                </div>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:8,letterSpacing:2,color:"rgba(255,107,107,0.6)",marginBottom:6,borderBottom:"1px solid rgba(255,107,107,0.12)",paddingBottom:3}}>// VOICE</div>
                  <div style={{fontSize:8,color:"rgba(0,212,255,0.4)",marginBottom:5}}>SPEECH RATE</div>
                  <div style={{display:"flex",gap:4,marginBottom:8}}>
                    {[{l:"SLOW",r:0.68},{l:"NORMAL",r:0.82},{l:"FAST",r:0.96}].map(({l,r})=>(
                      <button key={l} onClick={()=>{setVoiceRate(r);saveSettings(r,showWireframe,voiceIdx);}} style={{flex:1,background:Math.abs(voiceRate-r)<0.05?"rgba(255,107,107,0.15)":"rgba(0,212,255,0.04)",border:`1px solid ${Math.abs(voiceRate-r)<0.05?"rgba(255,107,107,0.5)":"rgba(0,212,255,0.12)"}`,color:Math.abs(voiceRate-r)<0.05?"#FF6B6B":"rgba(0,212,255,0.4)",fontSize:7,letterSpacing:1,padding:"4px",cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
                    ))}
                  </div>
                  <select value={voiceIdx} onChange={e=>{const idx=parseInt(e.target.value);setVoiceIdx(idx);saveSettings(voiceRate,showWireframe,idx);}} style={{width:"100%",background:"rgba(0,8,20,0.85)",border:"1px solid rgba(0,212,255,0.2)",color:"#00D4FF",padding:"5px 8px",fontSize:9,fontFamily:"'Courier New'",outline:"none"}}>
                    <option value={-1}>// AUTO SELECT</option>
                    {voices.map((v,i)=><option key={i} value={i}>{v.name} ({v.lang})</option>)}
                  </select>
                </div>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:8,letterSpacing:2,color:"rgba(255,107,107,0.6)",marginBottom:6,borderBottom:"1px solid rgba(255,107,107,0.12)",paddingBottom:3}}>// DISPLAY</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:8,color:"rgba(0,212,255,0.4)"}}>WIREFRAME GRID</span>
                    <button onClick={()=>{const next=!showWireframe;setShowWireframe(next);saveSettings(voiceRate,next,voiceIdx);}} style={{background:showWireframe?"rgba(0,255,156,0.1)":"rgba(0,212,255,0.04)",border:`1px solid ${showWireframe?"rgba(0,255,156,0.4)":"rgba(0,212,255,0.15)"}`,color:showWireframe?"#00FF9C":"rgba(0,212,255,0.3)",fontSize:7,letterSpacing:1,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit"}}>{showWireframe?"ON":"OFF"}</button>
                  </div>
                </div>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:8,letterSpacing:2,color:"rgba(255,107,107,0.6)",marginBottom:6,borderBottom:"1px solid rgba(255,107,107,0.12)",paddingBottom:3}}>// DATA</div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    <button onClick={exportData} style={{background:"rgba(0,212,255,0.05)",border:"1px solid rgba(0,212,255,0.2)",color:"rgba(0,212,255,0.6)",fontSize:8,letterSpacing:1,padding:"6px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>EXPORT DATA → JSON</button>
                    {isDemoMode&&<button onClick={clearDemo} style={{background:"rgba(255,184,0,0.06)",border:"1px solid rgba(255,184,0,0.25)",color:"rgba(255,184,0,0.6)",fontSize:8,letterSpacing:1,padding:"6px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>CLEAR DEMO DATA</button>}
                    <button onClick={clearMemory} style={{background:"rgba(123,47,255,0.06)",border:"1px solid rgba(123,47,255,0.2)",color:"rgba(123,47,255,0.6)",fontSize:8,letterSpacing:1,padding:"6px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>CLEAR MEMORY ({memCount} exchanges)</button>
                  </div>
                </div>
                <div style={{borderTop:"1px solid rgba(0,212,255,0.08)",paddingTop:8}}>
                  <div style={{fontSize:8,letterSpacing:2,color:"rgba(255,107,107,0.6)",marginBottom:5}}>// SYSTEM</div>
                  {[["VERSION","v7 — Carbon Draw"],["MESH","C60 Buckminsterfullerene"],["NODES",`${VERTS.length} hex`],["BONDS",`${EDGES.length} dual`],["ORGANS","5 active"],["EQ","IRV · CLI · ORC"]].map(([k,v])=>(
                    <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"2px 0",fontSize:8}}>
                      <span style={{color:"rgba(0,212,255,0.35)"}}>{k}</span>
                      <span style={{color:"rgba(0,212,255,0.6)"}}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>}
            </div>
          </div>
        )}

        {/* Input */}
        <div style={{position:"absolute",bottom:48,left:"50%",transform:"translateX(-50%)",display:"flex",flexDirection:"column",alignItems:"center",gap:8,zIndex:15}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={startListening} style={{
              width:42,height:42,
              background:status==="LISTENING"?"rgba(255,184,0,0.12)":status==="SPEAKING"?"rgba(0,255,156,0.1)":"rgba(0,212,255,0.07)",
              border:`1px solid ${status==="LISTENING"?"rgba(255,184,0,0.7)":status==="SPEAKING"?"rgba(0,255,156,0.6)":"rgba(0,212,255,0.4)"}`,
              color:status==="LISTENING"?"#FFB800":status==="SPEAKING"?"#00FF9C":"#00D4FF",
              cursor:"pointer",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",
              clipPath:"polygon(15% 0%,85% 0%,100% 15%,100% 85%,85% 100%,15% 100%,0% 85%,0% 15%)",
            }}>🎙</button>
            <input value={inputText} onChange={e=>setInputText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&inputText.trim()&&!isProcessing&&(query(inputText.trim()),setInputText(""))}
              placeholder="// TYPE OR SPEAK"
              style={{background:"rgba(0,8,20,0.88)",border:"1px solid rgba(0,212,255,0.2)",color:"#00D4FF",padding:"7px 10px",fontSize:11,letterSpacing:1,fontFamily:"'Courier New',monospace",outline:"none",width:185}}/>
          </div>
          <div style={{fontSize:7,letterSpacing:1.5,color:"rgba(0,212,255,0.2)"}}>ENTER · MIC · CLICK ORB TO SELECT PANEL</div>
        </div>

        {/* Telemetry */}
        <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"5px 12px",borderTop:"1px solid rgba(0,212,255,0.08)",background:"rgba(4,8,16,0.9)",display:"flex",gap:12,alignItems:"center",fontSize:7,letterSpacing:1.5,color:"rgba(0,212,255,0.35)"}}>
          <span>N:{VERTS.length}</span><span>B:{EDGES.length}</span><span>M:{memCount}</span><span>L:{rpgLevel}</span>
          <span style={{color:"rgba(123,47,255,0.5)",letterSpacing:2}}>{profileName.toUpperCase()}</span>
          <span style={{color:"rgba(0,255,156,0.4)"}}>${totalIncome.toLocaleString()}</span>
          <span style={{marginLeft:"auto",color:"#00FF9C"}}>● ONLINE</span>
        </div>
      </div>

      <style>{`
        @keyframes slideIn{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:translateX(0)}}
        @keyframes orbRing{0%,100%{opacity:0.2}50%{opacity:0.55}}
        *{box-sizing:border-box}
        input::placeholder{color:rgba(0,212,255,0.2)}
        ::-webkit-scrollbar{width:3px;background:#040810}
        ::-webkit-scrollbar-thumb{background:rgba(0,212,255,0.2)}
      `}</style>
    </div>
  );
}
