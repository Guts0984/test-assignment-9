import { describe, expect, it } from 'vitest';
import type { ModifierGroup } from '@app/shared';
import { checkModifierSelection, groupByCategory, surchargeOf, toggleModifier } from './model';
import { steak } from '../../../test/utils';

const groups = steak().modifierGroups as ModifierGroup[];
const [doneness, extras] = groups as [ModifierGroup, ModifierGroup];
const ids = (g: ModifierGroup) => g.modifiers.map((m) => m.id);

describe('checkModifierSelection — pick min…max per group', () => {
  it('nothing selected: "exactly one" is violated (min), the optional group is fine', () => {
    const p = checkModifierSelection(groups, new Set());
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ groupId: doneness.id, kind: 'min', min: 1, max: 1 });
  });
  it('one doneness: valid', () => {
    expect(checkModifierSelection(groups, new Set([ids(doneness)[1]!]))).toEqual([]);
  });
  it('two donenesses: violates max', () => {
    const p = checkModifierSelection(groups, new Set([ids(doneness)[0]!, ids(doneness)[1]!]));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: 'max', groupId: doneness.id });
  });
  it('extras 0–3: boundaries 0, 3 ok; 4 fails', () => {
    const base = ids(doneness)[0]!;
    expect(checkModifierSelection(groups, new Set([base]))).toEqual([]);
    expect(checkModifierSelection(groups, new Set([base, ...ids(extras).slice(0, 3)]))).toEqual([]);
    const four = checkModifierSelection(groups, new Set([base, ...ids(extras)]));
    expect(four).toHaveLength(1);
    expect(four[0]).toMatchObject({ kind: 'max', groupId: extras.id, max: 3 });
  });
  it('reports every violated group', () => {
    const p = checkModifierSelection(groups, new Set(ids(extras)));
    expect(p.map((x) => [x.groupId, x.kind])).toEqual([
      [doneness.id, 'min'],
      [extras.id, 'max'],
    ]);
  });
  it('a dish without groups is always valid', () => {
    expect(checkModifierSelection([], new Set())).toEqual([]);
  });
});

describe('toggleModifier', () => {
  it('"exactly one" groups behave like radio buttons: a new choice replaces the old one', () => {
    let s = toggleModifier(groups, new Set(), ids(doneness)[0]!);
    s = toggleModifier(groups, s, ids(doneness)[2]!);
    expect([...s]).toEqual([ids(doneness)[2]]);
  });
  it('multi-choice groups toggle on and off and do not disturb other groups', () => {
    let s = toggleModifier(groups, new Set([ids(doneness)[0]!]), ids(extras)[0]!);
    s = toggleModifier(groups, s, ids(extras)[1]!);
    expect(s.size).toBe(3);
    s = toggleModifier(groups, s, ids(extras)[0]!);
    expect(s.has(ids(extras)[0]!)).toBe(false);
    expect(s.has(ids(doneness)[0]!)).toBe(true);
  });
  it('does not mutate its input and ignores unknown ids', () => {
    const before = new Set([ids(doneness)[0]!]);
    const after = toggleModifier(groups, before, 'nope');
    expect(after).not.toBe(before);
    expect([...after]).toEqual([...before]);
  });
});

describe('surchargeOf', () => {
  it('sums the selected modifiers only', () => {
    expect(surchargeOf(groups, new Set())).toBe(0);
    expect(surchargeOf(groups, new Set([ids(extras)[0]!, ids(extras)[1]!]))).toBe(5500);
    expect(surchargeOf(groups, new Set(ids(extras)))).toBe(9500);
  });
});

describe('groupByCategory', () => {
  it('groups, sorts categories and dishes', () => {
    const dish = (name: string, category: string) => ({ ...steak(), id: name, name, category });
    const out = groupByCategory([dish('b', 'Soups'), dish('a', 'Soups'), dish('c', 'Mains')]);
    expect(out.map((g) => g.category)).toEqual(['Mains', 'Soups']);
    expect(out[1]!.dishes.map((d) => d.name)).toEqual(['a', 'b']);
  });
});
