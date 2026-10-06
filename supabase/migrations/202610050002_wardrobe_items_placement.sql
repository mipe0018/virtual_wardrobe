-- Per-item placement overrides produced by the wardrobe placement editor.
-- Non-destructive: the column is added as NULL for every existing row, and
-- NULL means "use the existing clothingPlacement()/anchor defaults". No rows
-- are rewritten. PK, FK, triggers, grants and RLS policies are untouched — the
-- existing owner SELECT and UPDATE policies on wardrobe_items already cover
-- the new column.

alter table public.wardrobe_items
  add column if not exists placement jsonb;

comment on column public.wardrobe_items.placement is
  'Placement override {anchor,x,y,scale} saved by the placement editor; NULL = existing category default.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wardrobe_items_placement_check'
      and conrelid = 'public.wardrobe_items'::regclass
  ) then
    alter table public.wardrobe_items
      add constraint wardrobe_items_placement_check
      check (
        placement is null
        or (
          jsonb_typeof(placement) = 'object'
          and placement ? 'anchor'
          and placement ? 'x'
          and placement ? 'y'
          and placement ? 'scale'
          and (placement - 'anchor' - 'x' - 'y' - 'scale') = '{}'::jsonb
          and jsonb_typeof(placement -> 'anchor') = 'text'
          and (placement ->> 'anchor') in (
            'head', 'face', 'ears', 'neck', 'shoulders', 'torso', 'waist',
            'hips', 'left-hand', 'right-hand', 'knees', 'ankles', 'feet',
            'full-body', 'dress'
          )
          and (
            case when jsonb_typeof(placement -> 'x') = 'number'
              then (placement ->> 'x')::numeric between -60 and 60
              else false end
          )
          and (
            case when jsonb_typeof(placement -> 'y') = 'number'
              then (placement ->> 'y')::numeric between -60 and 60
              else false end
          )
          and (
            case when jsonb_typeof(placement -> 'scale') = 'number'
              then (placement ->> 'scale')::numeric between 0.4 and 2
              else false end
          )
        )
      );
  end if;
end $$;
