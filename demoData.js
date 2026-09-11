// ─── DEMO DATA ────────────────────────────────────────────
// Fallback content shown in demo mode (no login) and to authenticated
// users who haven't logged any real data yet. Lives outside PRISM.jsx/
// usePrismData.js to avoid a circular import between the two.
export const DEMO_INCOME = [
  {amount:1800,source:"Freelance Dev",   value:1800,label:"4/3", timestamp:"2026-04-03T10:00:00Z"},
  {amount:2500,source:"SFT Command",     value:2500,label:"4/15",timestamp:"2026-04-15T10:00:00Z"},
  {amount:3200,source:"SFT Command",     value:3200,label:"5/10",timestamp:"2026-05-10T10:00:00Z"},
  {amount:4100,source:"PRISM Beta",      value:4100,label:"6/5", timestamp:"2026-06-05T10:00:00Z"},
  {amount:5400,source:"PRISM Revenue",   value:5400,label:"7/8", timestamp:"2026-07-08T10:00:00Z"},
  {amount:6200,source:"PRISM Revenue",   value:6200,label:"9/1", timestamp:"2026-09-01T10:00:00Z"},
];
export const DEMO_NW = [
  {value:800,  label:"4/1",timestamp:"2026-04-01T10:00:00Z"},
  {value:2100, label:"5/1",timestamp:"2026-05-01T10:00:00Z"},
  {value:4800, label:"6/1",timestamp:"2026-06-01T10:00:00Z"},
  {value:8500, label:"7/1",timestamp:"2026-07-01T10:00:00Z"},
  {value:15800,label:"9/1",timestamp:"2026-09-01T10:00:00Z"},
];
export const DEMO_STATS = { queries:47, sessions:12, streak:8, uptime:180 };
