-- Free X/Y placement scaling: allow OPTIONAL scaleX/scaleY on wardrobe_items.placement.
-- New file; 202610050002 and 202610050003 are immutable history and are NOT edited.
--
-- Contract:
--   legacy      : {anchor,x,y,scale}                       -> still valid (no backfill)
--   free scaling: {anchor,x,y,scale,scaleX,scaleY}         -> both axes required together
--   anything else (unknown keys, a single axis)            -> still rejected
--   scaleX/scaleY range = same range as scale (0.4 .. 2)
--
-- Existing rows only ever contain the four legacy keys, so every existing row
-- satisfies this CHECK unchanged. Semantics are identical to
-- 202610050003_fix_wardrobe_items_placement_check.sql apart from the optional
-- axis keys.

ALTER TABLE public.wardrobe_items
DROP CONSTRAINT IF EXISTS wardrobe_items_placement_check;

ALTER TABLE public.wardrobe_items
ADD CONSTRAINT wardrobe_items_placement_check
CHECK (
  placement IS NULL
  OR (
    jsonb_typeof(placement) = 'object'
    AND placement ? 'anchor'
    AND placement ? 'x'
    AND placement ? 'y'
    AND placement ? 'scale'

    -- Unknown keys are still rejected: after removing the four required keys
    -- the only tolerated residue is exactly {scaleX,scaleY} (or nothing).
    AND (
      (placement - 'anchor' - 'x' - 'y' - 'scale') = '{}'::jsonb
      OR (placement - 'anchor' - 'x' - 'y' - 'scale' - 'scaleX' - 'scaleY') = '{}'::jsonb
    )

    -- Both optional axes or neither — never a single axis alone.
    AND ((placement ? 'scaleX') = (placement ? 'scaleY'))

    AND jsonb_typeof(placement -> 'anchor') = 'string'

    AND (placement ->> 'anchor') = ANY (
      ARRAY[
        'head',
        'face',
        'ears',
        'neck',
        'shoulders',
        'torso',
        'waist',
        'hips',
        'left-hand',
        'right-hand',
        'knees',
        'ankles',
        'feet',
        'full-body',
        'dress'
      ]
    )

    AND CASE
      WHEN jsonb_typeof(placement -> 'x') = 'number'
      THEN (placement ->> 'x')::numeric >= -60
        AND (placement ->> 'x')::numeric <= 60
      ELSE false
    END

    AND CASE
      WHEN jsonb_typeof(placement -> 'y') = 'number'
      THEN (placement ->> 'y')::numeric >= -60
        AND (placement ->> 'y')::numeric <= 60
      ELSE false
    END

    AND CASE
      WHEN jsonb_typeof(placement -> 'scale') = 'number'
      THEN (placement ->> 'scale')::numeric >= 0.4
        AND (placement ->> 'scale')::numeric <= 2
      ELSE false
    END

    -- Optional axes use the same range as scale, validated only when present.
    AND CASE
      WHEN placement ? 'scaleX' AND jsonb_typeof(placement -> 'scaleX') = 'number'
      THEN (placement ->> 'scaleX')::numeric >= 0.4
        AND (placement ->> 'scaleX')::numeric <= 2
      WHEN placement ? 'scaleX' THEN false
      ELSE true
    END

    AND CASE
      WHEN placement ? 'scaleY' AND jsonb_typeof(placement -> 'scaleY') = 'number'
      THEN (placement ->> 'scaleY')::numeric >= 0.4
        AND (placement ->> 'scaleY')::numeric <= 2
      WHEN placement ? 'scaleY' THEN false
      ELSE true
    END
  )
);

COMMENT ON COLUMN public.wardrobe_items.placement IS
  'Placement override {anchor,x,y,scale[,scaleX,scaleY]} saved by the placement editor; NULL = existing category default. scale = canonical proportional scale; optional scaleX/scaleY = free X/Y scaling (stored together, same 0.4-2 range).';
