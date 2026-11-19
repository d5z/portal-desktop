const palettes = ['teal', 'indigo', 'clay', 'blue'] as const;
const initials = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function beingMonogram(name: string, id: string) {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  const palette = palettes[(hash >>> 0) % palettes.length];
  const initial = initials.segment(name)[Symbol.iterator]().next().value?.segment;
  return { initial, palette };
}
