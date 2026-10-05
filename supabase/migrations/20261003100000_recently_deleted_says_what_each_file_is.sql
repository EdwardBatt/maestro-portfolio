-- ADR-0134 d.9 (I72.17) — Recently deleted says what each deleted item is.
--
-- `library_recently_deleted` returned the name only, so the screen guessed the kind from the name: a
-- deleted LINK ("Masters on Drive") has no extension and was badged "FILE". The list now returns the
-- row's `content_type` and `link_url`, the same two the folder and search lists badge from. The return
-- type changes, so the function is dropped and recreated with the same body and the same grant.
begin;

drop function if exists public.library_recently_deleted(uuid);

create function public.library_recently_deleted(p_client uuid)
returns table (id uuid, name text, folder_path text, deleted_at timestamptz, deleted_by_name text, purge_on date,
               content_type text, link_url text)
language sql stable set search_path = public, app, extensions as $$
  select a.id, a.name, app.library_folder_path(a.folder_id), a.deleted_at,
         (select u.display_name from user_profiles u where u.id = a.deleted_by),
         (a.deleted_at + interval '30 days')::date,
         a.content_type, a.link_url
    from assets a
    join asset_folders f on f.id = a.folder_id
   where f.client_id = p_client and a.deleted_at is not null
     and app.library_may_delete(a.id)
   order by a.deleted_at desc
$$;

revoke execute on function public.library_recently_deleted(uuid) from public, anon;
grant execute on function public.library_recently_deleted(uuid) to authenticated;

commit;
