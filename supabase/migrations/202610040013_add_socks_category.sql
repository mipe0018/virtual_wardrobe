-- Adds "socks" as an allowed wardrobe category. Non-destructive: existing rows
-- already satisfy the widened constraint.
alter table public.wardrobe_items
  drop constraint if exists wardrobe_items_category_check;

alter table public.wardrobe_items
  add constraint wardrobe_items_category_check check (category in (
    'tops', 'shirts', 'sweaters', 'jackets', 'dresses', 'skirts', 'pants',
    'shorts', 'socks', 'shoes', 'bags', 'jewelry', 'necklaces', 'earrings',
    'bracelets', 'watches', 'glasses', 'sunglasses', 'hats', 'hair-accessories',
    'accessories', 'other'
  ));
