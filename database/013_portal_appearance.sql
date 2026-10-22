-- Personal appearance for a member portal: a partial theme (palette, style, fonts, density, motion…) that
-- overrides the workspace appearance for that member on every device. NULL means "use the workspace theme".
alter table bugflow.portals add column if not exists appearance jsonb;
