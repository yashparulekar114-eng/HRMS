-- The web app connects as `app_user`, a login role that is NOT the owner and cannot bypass RLS.
-- Create the role itself in the Neon console (it sets the password), then this migration wires it up.
-- Per request the app runs: BEGIN; SET LOCAL ROLE authenticated; set_config('request.jwt.claims', ..., true).
do $$ begin
  if exists (select from pg_roles where rolname = 'app_user') then
    grant authenticated to app_user;
    alter role app_user nobypassrls noinherit;
  end if;
end $$;
