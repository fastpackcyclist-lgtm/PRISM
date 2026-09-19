-- P.R.I.S.M. — protect billing columns on profiles from client writes.
--
-- profiles_update_own (0001_init.sql) is a ROW-level policy: auth.uid() = id.
-- It says nothing about which columns a user is allowed to change on their
-- own row — so as soon as the app started reading plan_status to gate
-- anything, a signed-in user could call the Supabase client directly
-- (bypassing PRISM's UI entirely) and set their own plan_status to 'active',
-- for free, forever. Nothing enforced that today; the Profile phase is the
-- first time plan_status becomes visible/meaningful, so it's the right time
-- to close this before U-GEMS/Stripe gives it teeth.
--
-- Fix: a trigger, not a narrower policy — Postgres RLS has no column-level
-- granularity, but a BEFORE UPDATE trigger can silently revert the two
-- billing columns to their previous value unless the request is running as
-- service_role (which is what the future Stripe webhook handler will use,
-- and which bypasses RLS anyway — this trigger still fires for it and lets
-- it through unmodified).

create or replace function public.protect_billing_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    new.plan_status := old.plan_status;
    new.stripe_customer_id := old.stripe_customer_id;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_billing
  before update on public.profiles
  for each row execute function public.protect_billing_columns();
