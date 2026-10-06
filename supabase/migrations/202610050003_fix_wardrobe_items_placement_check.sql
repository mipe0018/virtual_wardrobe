-- Fix JSONB anchor type validation.
-- PostgreSQL returns "string" for a JSONB string value, not "text".

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
    AND ((placement - 'anchor' - 'x' - 'y' - 'scale') = '{}'::jsonb)

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
  )
);
