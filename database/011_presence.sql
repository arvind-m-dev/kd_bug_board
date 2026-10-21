-- Live presence for member portals: an open portal keeps online_until a little in the future
-- (heartbeat every 30 s); closing it sets online_until to now so the member shows offline at once.
alter table bugflow.portals add column if not exists online_until timestamptz;
