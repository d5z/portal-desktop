import { describe, expect, it } from 'vitest';
import { mergeHistoryRow, normalizeHistoryRows } from '../desktop/renderer/chat/services/history-cache';

describe('durable history rows', () => {
  it('retains readable cached content when a later snapshot is blank, and accepts a repaired reply', () => {
    const previous = { seq: 2, role: 'assistant', content: 'saved reply', scene_id: 'room' };
    for (const content of ['', ' \n ']) {
      expect(mergeHistoryRow(previous, { seq: 2, role: 'assistant', content })).toEqual(previous);
    }
    expect(mergeHistoryRow(previous, { ...previous, content: 'repaired reply' }).content).toBe('repaired reply');
    expect(normalizeHistoryRows([{ seq: 3, role: 'assistant', content: '' }])).toHaveLength(1);
  });
  it('orders by seq, preserves distinct equal text, and merges duplicate metadata', () => {
    expect(normalizeHistoryRows([
      { seq: 3, role: 'being', content: 'same' },
      { seq: 1, role: 'user', content: 'question', scene_id: 'room', scene_meta: { scene_label: 'Room' } },
      { seq: 2, role: 'being', content: 'same' },
      { seq: 1, role: 'user', content: 'question' },
    ])).toEqual([
      { seq: 1, role: 'user', content: 'question', scene_id: 'room', scene_label: 'Room' },
      { seq: 2, role: 'being', content: 'same' },
      { seq: 3, role: 'being', content: 'same' },
    ]);
  });
  it('accepts role-less protocol markers but rejects malformed rows before computing a cursor', () => {
    expect(normalizeHistoryRows([
      null, { seq: 9999, role: 'user' }, { seq: -1, role: 'being', content: 'invalid' },
      { seq: 5000, content: 'missing role' },
      { seq: 2, from: 'system', type: 'marker', content: '[breath yielded]' },
    ])).toEqual([{ seq: 2, role: 'system', from: 'system', type: 'marker', content: '[breath yielded]' }]);
  });
});
