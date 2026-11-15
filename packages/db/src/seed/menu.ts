import type { Station } from '@app/shared';

export type SeedModifier = { name: string; surcharge: number };
export type SeedGroup = { name: string; min: number; max: number; modifiers: SeedModifier[] };
export type SeedDish = {
  name: string;
  category: string;
  /** kopecks */
  price: number;
  station: Station;
  stock: number | null;
  groups: SeedGroup[];
};

const mods = (...pairs: [string, number][]): SeedModifier[] =>
  pairs.map(([name, surcharge]) => ({ name, surcharge }));

const doneness: SeedGroup = {
  name: 'Doneness',
  min: 1,
  max: 1,
  modifiers: mods(['Rare', 0], ['Medium', 0], ['Well done', 0]),
};
const steakSauce: SeedGroup = {
  name: 'Sauce',
  min: 0,
  max: 1,
  modifiers: mods(['Pepper sauce', 2500], ['Mushroom sauce', 2500], ['Chimichurri', 2000]),
};
const pizzaSize: SeedGroup = {
  name: 'Size',
  min: 1,
  max: 1,
  modifiers: mods(['25 cm', 0], ['32 cm', 5000], ['40 cm', 10000]),
};
const pizzaExtras: SeedGroup = {
  name: 'Extras',
  min: 0,
  max: 3,
  modifiers: mods(
    ['Extra cheese', 3000],
    ['Mushrooms', 2000],
    ['Olives', 1500],
    ['Jalapeño', 1500],
  ),
};
const milk: SeedGroup = {
  name: 'Milk',
  min: 1,
  max: 1,
  modifiers: mods(['Regular', 0], ['Oat', 1500], ['Almond', 1500], ['Lactose-free', 1000]),
};
const syrup: SeedGroup = {
  name: 'Syrup',
  min: 0,
  max: 2,
  modifiers: mods(['Vanilla', 1000], ['Caramel', 1000], ['Hazelnut', 1000]),
};
const ice: SeedGroup = {
  name: 'Ice',
  min: 1,
  max: 1,
  modifiers: mods(['With ice', 0], ['No ice', 0]),
};
const burgerExtras: SeedGroup = {
  name: 'Add-ons',
  min: 0,
  max: 3,
  modifiers: mods(['Bacon', 3500], ['Cheddar', 2500], ['Fried egg', 2000], ['Avocado', 4000]),
};
const saladAdds: SeedGroup = {
  name: 'Add-ons',
  min: 0,
  max: 3,
  modifiers: mods(['Grilled chicken', 4500], ['Bacon', 3500], ['Parmesan', 2500]),
};
const sideChoice: SeedGroup = {
  name: 'Side',
  min: 1,
  max: 1,
  modifiers: mods(['Fries', 0], ['Mashed potatoes', 0], ['Grilled vegetables', 1500]),
};

const d = (
  category: string,
  name: string,
  price: number,
  station: Station = 'kitchen',
  groups: SeedGroup[] = [],
  stock: number | null = null,
): SeedDish => ({ category, name, price, station, stock, groups });

/** 60 dishes in 11 categories. A few have limited stock to make the stop-list demo-able. */
export const MENU: SeedDish[] = [
  d('Starters', 'Bruschetta', 14000),
  d('Starters', 'Beef carpaccio', 24000),
  d('Starters', 'Cheese plate', 28000),
  d('Starters', 'Garlic bread', 8000),
  d('Starters', 'Stuffed mushrooms', 16000),
  d('Starters', 'Chicken wings', 19000, 'kitchen', [
    {
      name: 'Sauce',
      min: 1,
      max: 1,
      modifiers: mods(['BBQ', 0], ['Buffalo', 0], ['Honey mustard', 0]),
    },
  ]),

  d('Salads', 'Caesar salad', 19000, 'kitchen', [saladAdds]),
  d('Salads', 'Greek salad', 16000),
  d('Salads', 'Caprese', 18000),
  d('Salads', 'Tuna salad', 21000),
  d('Salads', 'Beetroot and goat cheese', 17000),

  d('Soups', 'Borscht', 12000, 'kitchen', [
    { name: 'Extras', min: 0, max: 2, modifiers: mods(['Sour cream', 1500], ['Pampushky', 2000]) },
  ]),
  d('Soups', 'Mushroom cream soup', 13000),
  d('Soups', 'Tomato soup', 11000),
  d('Soups', 'Chicken noodle soup', 11500),
  d('Soups', 'Fish soup', 15000),

  d('Mains', 'Ribeye steak', 62000, 'kitchen', [doneness, steakSauce, sideChoice], 20),
  d('Mains', 'Chicken Kyiv', 24000, 'kitchen', [sideChoice]),
  d('Mains', 'Salmon fillet', 38000, 'kitchen', [], 12),
  d('Mains', 'Pork ribs', 33000, 'kitchen', [sideChoice]),
  d('Mains', 'Lamb chops', 54000, 'kitchen', [doneness], 5),
  d('Mains', 'Duck breast', 36000),
  d('Mains', 'Beef stroganoff', 28000),
  d('Mains', 'Vegetable curry', 21000),
  d('Mains', 'Burger', 22000, 'kitchen', [doneness, burgerExtras]),

  d('Pasta', 'Carbonara', 21000),
  d('Pasta', 'Bolognese', 20000),
  d('Pasta', 'Penne arrabbiata', 17000),
  d('Pasta', 'Seafood linguine', 29000),
  d('Pasta', 'Pesto gnocchi', 19500),
  d('Pasta', 'Lasagna', 22000),

  d('Pizza', 'Margherita', 17000, 'kitchen', [pizzaSize, pizzaExtras]),
  d('Pizza', 'Pepperoni', 20000, 'kitchen', [pizzaSize, pizzaExtras]),
  d('Pizza', 'Four cheese', 22000, 'kitchen', [pizzaSize]),
  d('Pizza', 'Hawaiian', 20500, 'kitchen', [pizzaSize]),
  d('Pizza', 'Vegetarian', 19000, 'kitchen', [pizzaSize, pizzaExtras]),

  d('Desserts', 'Tiramisu', 12000),
  d('Desserts', 'Cheesecake', 11500),
  d('Desserts', 'Chocolate fondant', 13500, 'kitchen', [], 8),
  d('Desserts', 'Ice cream', 8000, 'kitchen', [
    {
      name: 'Flavour',
      min: 1,
      max: 2,
      modifiers: mods(['Vanilla', 0], ['Chocolate', 0], ['Strawberry', 0]),
    },
  ]),
  d('Desserts', 'Apple strudel', 10500),

  d('Soft drinks', 'Cola', 5000, 'bar', [ice]),
  d('Soft drinks', 'Lemonade', 6500, 'bar', [ice]),
  d('Soft drinks', 'Orange juice', 7000, 'bar'),
  d('Soft drinks', 'Sparkling water', 4000, 'bar'),
  d('Soft drinks', 'Still water', 3500, 'bar'),
  d('Soft drinks', 'Iced tea', 6000, 'bar', [ice]),

  d('Coffee', 'Espresso', 5000, 'bar'),
  d('Coffee', 'Americano', 5500, 'bar', [syrup]),
  d('Coffee', 'Cappuccino', 7000, 'bar', [milk, syrup]),
  d('Coffee', 'Latte', 7500, 'bar', [milk, syrup]),

  d('Beer and wine', 'Lager draft 0.5 l', 8500, 'bar'),
  d('Beer and wine', 'IPA 0.33 l', 9500, 'bar'),
  d('Beer and wine', 'Red wine glass', 12000, 'bar'),
  d('Beer and wine', 'White wine glass', 12000, 'bar'),
  d('Beer and wine', 'Prosecco glass', 14000, 'bar'),

  d('Cocktails', 'Mojito', 16000, 'bar'),
  d('Cocktails', 'Aperol Spritz', 17000, 'bar'),
  d('Cocktails', 'Old Fashioned', 19000, 'bar'),
  d('Cocktails', 'Margarita', 16500, 'bar'),
];

export const WAITERS = [
  ['waiter1', 'Olena Kovalenko'],
  ['waiter2', 'Andriy Melnyk'],
  ['waiter3', 'Iryna Bondarenko'],
  ['waiter4', 'Taras Shevchuk'],
  ['waiter5', 'Maria Tkachenko'],
] as const;
export const COOKS = [
  ['cook1', 'Petro Lysenko'],
  ['cook2', 'Sofia Savchenko'],
] as const;
export const MANAGER = ['manager', 'Oksana Kravchenko'] as const;

/** 20 tables: seats cycle 2,2,4,4,4,6,8. */
export const TABLE_SEATS = Array.from(
  { length: 20 },
  (_, i) => [2, 2, 4, 4, 4, 6, 8][i % 7] as number,
);
