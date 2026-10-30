import {describe,it,expect} from 'vitest';
import {firstAfter} from '../desktop/renderer/chat/models/scroll-position';

describe('ordered message boundaries',()=>{
  it('counts messages below the viewport, including a partially visible last bubble',()=>{
    const bottoms=[60,140,500,900];
    const below=(edge:number)=>bottoms.length-firstAfter(bottoms.length,edge,i=>bottoms[i]);
    expect(below(0)).toBe(4);
    expect(below(140)).toBe(2);
    expect(below(750)).toBe(1);
    expect(below(900)).toBe(0);
    expect(firstAfter(0,0,()=>{throw Error('empty');})).toBe(0);
  });
  it('handles equal positions and keeps geometry reads logarithmic for long histories',()=>{
    const positions=[10,10,10,30];
    expect(firstAfter(4,10,i=>positions[i])).toBe(3);
    let reads=0;
    expect(firstAfter(10000,4999,i=>{reads++;return i;})).toBe(5000);
    expect(reads).toBeLessThanOrEqual(14);
  });
});
