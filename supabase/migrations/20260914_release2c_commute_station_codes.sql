alter table public.commutes
  add column if not exists origin_crs text,
  add column if not exists destination_crs text;

update public.commutes
set
  origin_crs = case
    when lower(trim(origin_station)) = 'hatfield peverel' then 'HAP'
    when lower(trim(origin_station)) in ('london liverpool street', 'liverpool street') then 'LST'
    else origin_crs
  end,
  destination_crs = case
    when lower(trim(destination_station)) = 'hatfield peverel' then 'HAP'
    when lower(trim(destination_station)) in ('london liverpool street', 'liverpool street') then 'LST'
    else destination_crs
  end
where origin_crs is null or destination_crs is null;

alter table public.commutes
  drop constraint if exists commutes_origin_crs_format,
  add constraint commutes_origin_crs_format
    check (origin_crs is null or origin_crs ~ '^[A-Z]{3}$'),
  drop constraint if exists commutes_destination_crs_format,
  add constraint commutes_destination_crs_format
    check (destination_crs is null or destination_crs ~ '^[A-Z]{3}$');

comment on column public.commutes.origin_crs is
  'National Rail three-letter CRS code used for exact-service monitoring.';
comment on column public.commutes.destination_crs is
  'National Rail three-letter CRS code used for exact-service monitoring.';

