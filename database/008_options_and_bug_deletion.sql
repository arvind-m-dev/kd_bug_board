alter table bugflow.bugs add column if not exists deleted_at timestamptz;
insert into bugflow.settings(key,value) values('dropdown_options','{"modules":[],"environments":["Development","Staging","Production"],"devices":[]}'::jsonb) on conflict (key) do nothing;
