-- P.R.I.S.M. — user-chosen accent color, persisted per user.
-- Stored as a bare "R, G, B" triple (no rgba() wrapper) so it can be
-- interpolated directly into CSS custom property usage:
-- rgba(var(--prism-accent-rgb), 0.12). Default matches the app's
-- existing fixed cyan, so nobody's view changes until they pick one.

alter table public.settings
  add column accent_rgb text not null default '0, 212, 255';
