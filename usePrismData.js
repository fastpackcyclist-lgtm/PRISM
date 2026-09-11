import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { DEMO_INCOME, DEMO_NW, DEMO_STATS } from "./demoData.js";

const todayLabel = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const mapIncomeRow = (r) => ({ amount: r.amount, source: r.source, value: r.value, label: r.label, timestamp: r.occurred_at });
const mapNWRow = (r) => ({ value: r.value, label: r.label, timestamp: r.occurred_at });

// Owns every piece of state PRISM.jsx used to read straight out of localStorage:
// memory, stats, income/net-worth entries, profile, and settings. `user` is
// undefined while Supabase auth is still resolving, null once resolved
// signed-out, or a user object once signed in — those are three distinct
// states, and the fetch effect below must not run until the first is over
// (otherwise a query could fire with a null user_id, or demo data could
// flash and then get overwritten).
//
// Demo branch (no `userId`) is byte-identical to PRISM.jsx's original
// localStorage code — that's the regression check for "signed-out behavior
// is unchanged." Authenticated branch mirrors the same shapes against
// Supabase tables defined in supabase/migrations/0001_init.sql.
export function usePrismData(user) {
  const [memory,        setMemory]        = useState([]);
  const [memCount,      setMemCount]      = useState(0);
  const [stats,         setStats]         = useState(DEMO_STATS);
  const [incomeEntries, setIncome]        = useState(DEMO_INCOME);
  const [nwEntries,     setNW]            = useState(DEMO_NW);
  const [isDemoMode,    setIsDemoMode]    = useState(true);

  const [profileName,   setProfileName]   = useState("Operator");
  const [profileTitle,  setProfileTitle]  = useState("OPERATOR");
  const [profileAvatar, setProfileAvatar] = useState(null);
  const [voiceRate,     setVoiceRate]     = useState(0.82);
  const [showWireframe, setShowWireframe] = useState(true);
  const [voiceIdx,      setVoiceIdx]      = useState(-1);

  const save = useCallback((key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }, []);

  // undefined = auth still resolving, null = signed out, string = signed in.
  // Keyed this way (not on the `user` object itself) so a token refresh —
  // which can hand back a new object for the same identity — doesn't
  // trigger a redundant refetch.
  const userId = user === undefined ? undefined : (user ? user.id : null);

  useEffect(() => {
    if (userId === undefined) return; // still resolving — never guess demo mode here

    if (!userId) {
      // ── Demo mode ──
      // Reset to defaults first: this branch also runs after a sign-out
      // (userId going from a real id back to null), not just on first load,
      // so state left over from an authenticated session must not leak into
      // the demo view. From here down, the localStorage reads are otherwise
      // unchanged from the original component.
      setMemory([]); setMemCount(0); setStats(DEMO_STATS);
      setIncome(DEMO_INCOME); setNW(DEMO_NW); setIsDemoMode(true);
      setProfileName("Operator"); setProfileTitle("OPERATOR"); setProfileAvatar(null);
      setVoiceRate(0.82); setShowWireframe(true); setVoiceIdx(-1);
      try {
        const m=localStorage.getItem("prism-mem");    if(m){const p=JSON.parse(m);setMemory(p);setMemCount(Math.floor(p.length/2));}
        const s=localStorage.getItem("prism-stats");  if(s) setStats(JSON.parse(s));
        const i=localStorage.getItem("prism-income"); if(i){const d=JSON.parse(i);if(d.length>0){setIncome(d);setIsDemoMode(false);}}
        const n=localStorage.getItem("prism-nw");     if(n){const d=JSON.parse(n);if(d.length>0) setNW(d);}
        const pr=localStorage.getItem("prism-profile"); if(pr){const p=JSON.parse(pr);setProfileName(p.name||"Operator");setProfileTitle(p.title||"OPERATOR");setProfileAvatar(p.avatar||null);}
        const st=localStorage.getItem("prism-settings"); if(st){const p=JSON.parse(st);setVoiceRate(p.voiceRate||0.82);setShowWireframe(p.showWireframe!==false);setVoiceIdx(p.voiceIdx??-1);}
      } catch (e) {}
      return;
    }

    // ── Authenticated — pull everything from Postgres ──
    let cancelled = false;
    (async () => {
      const [profileRes, statsRes, incomeRes, nwRes, settingsRes, memRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).single(),
        supabase.from("stats").select("*").eq("user_id", userId).single(),
        supabase.from("income_entries").select("*").eq("user_id", userId).order("occurred_at", { ascending: true }),
        supabase.from("networth_entries").select("*").eq("user_id", userId).order("occurred_at", { ascending: true }),
        supabase.from("settings").select("*").eq("user_id", userId).single(),
        supabase.from("chat_memory").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(40),
      ]);
      if (cancelled) return;

      if (profileRes.data) {
        setProfileName(profileRes.data.name || "Operator");
        setProfileTitle(profileRes.data.title || "OPERATOR");
        setProfileAvatar(profileRes.data.avatar_url || null);
      }
      if (statsRes.data) {
        setStats({ queries: statsRes.data.queries, sessions: statsRes.data.sessions, streak: statsRes.data.streak, uptime: statsRes.data.uptime });
      }
      if (settingsRes.data) {
        setVoiceRate(settingsRes.data.voice_rate ?? 0.82);
        setShowWireframe(settingsRes.data.show_wireframe !== false);
        setVoiceIdx(settingsRes.data.voice_idx ?? -1);
      }
      if (memRes.data) {
        const chronological = [...memRes.data].reverse().map((r) => ({ role: r.role, content: r.content }));
        setMemory(chronological);
        setMemCount(Math.floor(chronological.length / 2));
      }

      const incomeRows = incomeRes.data || [];
      const nwRows = nwRes.data || [];

      if (incomeRows.length === 0 && nwRows.length === 0) {
        // No real rows yet — one-time opportunistic import of this device's
        // local data, if any. Chat memory is intentionally not imported.
        let importedIncome = null, importedNW = null;
        try {
          const li = localStorage.getItem("prism-income");
          const ln = localStorage.getItem("prism-nw");
          const localIncome = li ? JSON.parse(li) : [];
          const localNW = ln ? JSON.parse(ln) : [];
          if (localIncome.length > 0 || localNW.length > 0) {
            const ok = window.confirm(
              `Import ${localIncome.length} income entries and ${localNW.length} net worth entries from this device into your account?`
            );
            if (ok) {
              if (localIncome.length > 0) {
                const { data } = await supabase.from("income_entries").insert(
                  localIncome.map((e) => ({ user_id: userId, amount: e.amount, source: e.source, value: e.value, label: e.label, occurred_at: e.timestamp }))
                ).select();
                importedIncome = (data || []).map(mapIncomeRow);
              }
              if (localNW.length > 0) {
                const { data } = await supabase.from("networth_entries").insert(
                  localNW.map((e) => ({ user_id: userId, value: e.value, label: e.label, occurred_at: e.timestamp }))
                ).select();
                importedNW = (data || []).map(mapNWRow);
              }
              localStorage.removeItem("prism-income");
              localStorage.removeItem("prism-nw");
            }
          }
        } catch (e) {}

        if (importedIncome || importedNW) {
          setIncome(importedIncome || []);
          setNW(importedNW || []);
          setIsDemoMode(false);
        } else {
          setIncome(DEMO_INCOME);
          setNW(DEMO_NW);
          setIsDemoMode(true);
        }
      } else {
        setIncome(incomeRows.map(mapIncomeRow));
        setNW(nwRows.map(mapNWRow));
        setIsDemoMode(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // ── Profile / settings ──
  const saveProfile = useCallback((name, title, avatar) => {
    if (!userId) { save("prism-profile", { name, title, avatar }); return; }
    supabase.from("profiles").update({ name, title, avatar_url: avatar, updated_at: new Date().toISOString() }).eq("id", userId).then(() => {});
  }, [userId, save]);

  const saveSettings = useCallback((rate, wireframe, idx) => {
    if (!userId) { save("prism-settings", { voiceRate: rate, showWireframe: wireframe, voiceIdx: idx }); return; }
    supabase.from("settings").update({ voice_rate: rate, show_wireframe: wireframe, voice_idx: idx, updated_at: new Date().toISOString() }).eq("user_id", userId).then(() => {});
  }, [userId, save]);

  // ── Income / net worth (called with the raw form values, same as the panel inputs) ──
  const addIncome = useCallback((amountStr, source) => {
    const amt = parseFloat(amountStr);
    if (!amt || !source) return;
    const now = new Date();
    const entry = { amount: amt, source, value: amt, label: todayLabel(now), timestamp: now.toISOString() };

    if (!userId) {
      const updated = [...incomeEntries, entry];
      setIncome(updated); save("prism-income", updated); setIsDemoMode(false);
      return;
    }
    // Don't carry the DEMO_INCOME fallback into a user's first real entry.
    const base = isDemoMode ? [] : incomeEntries;
    setIncome([...base, entry]); setIsDemoMode(false);
    supabase.from("income_entries").insert({ user_id: userId, amount: amt, source, value: amt, label: entry.label, occurred_at: entry.timestamp }).then(() => {});
  }, [userId, incomeEntries, isDemoMode, save]);

  const addNW = useCallback((amountStr) => {
    const amt = parseFloat(amountStr);
    if (!amt) return;
    const now = new Date();
    const entry = { value: amt, label: todayLabel(now), timestamp: now.toISOString() };

    if (!userId) {
      const updated = [...nwEntries, entry];
      setNW(updated); save("prism-nw", updated); setIsDemoMode(false);
      return;
    }
    const base = isDemoMode ? [] : nwEntries;
    setNW([...base, entry]); setIsDemoMode(false);
    supabase.from("networth_entries").insert({ user_id: userId, value: amt, label: entry.label, occurred_at: entry.timestamp }).then(() => {});
  }, [userId, nwEntries, isDemoMode, save]);

  // ── One call per completed chat exchange: appends memory + bumps queries ──
  const appendExchange = useCallback((userText, prismText) => {
    const newMem = [...memory, { role: "user", content: userText }, { role: "prism", content: prismText }];
    setMemory(newMem);
    setMemCount(Math.floor(newMem.length / 2));
    const ns = { ...stats, queries: stats.queries + 1 };
    setStats(ns);

    if (!userId) {
      save("prism-mem", newMem.slice(-40));
      save("prism-stats", ns);
      return;
    }
    supabase.from("chat_memory").insert([
      { user_id: userId, role: "user", content: userText },
      { user_id: userId, role: "prism", content: prismText },
    ]).then(() => {});
    supabase.from("stats").update({ queries: ns.queries, updated_at: new Date().toISOString() }).eq("user_id", userId).then(() => {});
  }, [userId, memory, stats, save]);

  const clearMemory = useCallback(() => {
    setMemory([]); setMemCount(0);
    if (!userId) { save("prism-mem", []); return; }
    supabase.from("chat_memory").delete().eq("user_id", userId).then(() => {});
  }, [userId, save]);

  // Demo-only — wipes the DEMO_INCOME/DEMO_NW fallback display. For an
  // authenticated user with no rows yet, "cleared" is already the state;
  // there's nothing in Postgres to remove.
  const clearDemo = useCallback(() => {
    if (userId) return;
    setIncome([]); setNW([]); setIsDemoMode(false);
    save("prism-income", []); save("prism-nw", []);
  }, [userId, save]);

  return {
    memory, memCount, stats, incomeEntries, nwEntries, isDemoMode,
    profileName, setProfileName, profileTitle, setProfileTitle, profileAvatar, setProfileAvatar,
    voiceRate, setVoiceRate, showWireframe, setShowWireframe, voiceIdx, setVoiceIdx,
    saveProfile, saveSettings, addIncome, addNW, appendExchange, clearMemory, clearDemo,
  };
}
