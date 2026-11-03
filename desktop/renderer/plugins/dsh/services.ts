import type { Context } from '@deepseek-ai/cordis';
import { bindThemeController, presentColorScheme } from '../../shared/color-scheme';
import { isStaleThemeRestore, rememberClientTheme } from './theme-compat';

type Theme = { id: string; colorScheme: 'light' | 'dark'; tokens: Record<string, string> };
const read = (key: string, fallback: any) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const save = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { console.error(error); } };
/** Local presentation services. None of these pretends to own a Being session. */
export function installPresentationServices(ctx: Context) {
  const themes: Theme[] = [{ id: 'light', colorScheme: 'light', tokens: {} }, { id: 'dark', colorScheme: 'dark', tokens: {} }];
  const layers = new Map<string, Record<string, { light: string; dark: string }>>();
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = read('town.dsh.theme', document.documentElement.dataset.theme || 'system');
  let revision = 0, snapshot: any, applied: string[] = [];
  const fontSizes = read('town.dsh.fontSizes', { text: 14, code: 11, terminal: 13 });
  const fontFamilies = read('town.dsh.fontFamilies', { text: '', code: '', terminal: '' });
  const publish = () => {
    const base = themes.find(t => t.id === preference) ?? themes.find(t => t.id === (preference === 'system' ? media.matches ? 'dark' : 'light' : 'light'))!;
    const tokens = { ...base.tokens };
    for (const layer of layers.values()) for (const [key, modes] of Object.entries(layer)) tokens[key] = modes[base.colorScheme];
    snapshot = { preference, fontSizes: { ...fontSizes }, fontFamilies: { ...fontFamilies }, fontSize: fontSizes.text, active: { ...base, tokens }, themes: [...themes], revision: ++revision };
    if (document.body.hasAttribute('data-town-dsh')) {
    presentColorScheme(base.colorScheme);
    document.documentElement.dataset.dsThemeSource = preference === 'system' ? 'system' : base.colorScheme;
    document.body.toggleAttribute('data-town-dsh-theme', Object.keys(tokens).length > 0);
    for (const key of applied) document.body.style.removeProperty(key);
    applied = Object.keys(tokens);
    for (const [key, value] of Object.entries(tokens)) document.body.style.setProperty(key, value);
    for (const role of ['text', 'code', 'terminal']) {
      document.body.style.setProperty(`--dsh-${role === 'text' ? 'content' : role}-font-size`, fontSizes[role] + 'px');
      if (fontFamilies[role]) document.body.style.setProperty(`--dsh-font-family-${role}`, fontFamilies[role]); else document.body.style.removeProperty(`--dsh-font-family-${role}`);
    }
    window.dispatchEvent(new Event('town:appearance-changed'));
    }
    (ctx as any).emit('theme/change', snapshot);
  };
  const theme = {
    getTheme: () => snapshot,
    setTheme(id: string) { if (id !== 'system' && !themes.some(t => t.id === id)) throw new Error(`未知主题：${id}`); if (isStaleThemeRestore(id)) return; preference = id; save('town.dsh.theme', id); publish(); },
    register(def: Theme) {
      if (!def.id || def.id === 'system' || !['light', 'dark'].includes(def.colorScheme) || themes.some(t => t.id === def.id)) throw new Error(`无效或重复的主题：${def.id}`);
      themes.push({ ...def, tokens: { ...def.tokens } }); publish();
      return () => { const index = themes.findIndex(t => t.id === def.id); if (index < 0) return; themes.splice(index, 1); if (preference === def.id) preference = 'system'; publish(); };
    },
    overrideTokens(source: string, tokens: Record<string, { light: string; dark: string }>) {
      const layer = Object.fromEntries(Object.entries(tokens).map(([key, value]) => {
        if (!value || typeof value.light !== 'string' || typeof value.dark !== 'string') throw new Error(`主题 ${key} 需要 light/dark 值`);
        return [key, { ...value }];
      }));
      layers.delete(source); layers.set(source, layer); publish();
      return () => { if (layers.get(source) === layer) { layers.delete(source); publish(); } };
    },
    setFontSize(role: string | number, px?: number) { if (typeof role === 'number') { px = role; role = 'text'; } const limits: Record<string, [number, number]> = { text: [10, 22], code: [10, 16], terminal: [10, 20] }; if (!limits[role] || !Number.isInteger(px) || px! < limits[role][0] || px! > limits[role][1]) throw new Error('无效字体大小'); fontSizes[role] = px; save('town.dsh.fontSizes', fontSizes); publish(); },
    setFontFamily(role: string, family: string) { if (!['text', 'code', 'terminal'].includes(role) || typeof family !== 'string') throw new Error('无效字体'); fontFamilies[role] = family; save('town.dsh.fontFamilies', fontFamilies); publish(); },
    exportInspectTokens: () => Object.keys(snapshot.active.tokens).map(name => ({ name, cssVariable: name, description: 'Plugin theme token', valueType: 'CSS value', requiresLightAndDark: true })),
  };
  ctx.provide('theme', theme); media.addEventListener('change', publish); publish();
  ctx.effect(() => bindThemeController({ current: () => snapshot.active.colorScheme, select: id => { rememberClientTheme(id); theme.setTheme(id); }, active: () => document.body.hasAttribute('data-town-dsh') }));
  ctx.effect(() => () => media.removeEventListener('change', publish));

  const dictionaries = new Map<string, Map<string, Record<string, string>>>();
  const listeners = new Set<() => void>();
  const bound = new Map<string, (key: string, params?: Record<string, unknown>) => string>();
  type Language = { id: string; label: string; fallback?: string };
  const catalog = new Map<string, Language>([['zh', { id: 'zh', label: '中文', fallback: 'en' }], ['en', { id: 'en', label: 'English' }]]);
  const languagePattern = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i;
  let preferenceLocale: string | undefined = read('town.dsh.locale', undefined);
  const active = () => catalog.get(preferenceLocale?.toLowerCase() || '')?.id ?? [...navigator.languages, navigator.language].flatMap(tag => [catalog.get(tag.toLowerCase())?.id, catalog.get(tag.split('-')[0].toLowerCase())?.id]).find(Boolean) ?? 'en';
  let localeSnapshot = { active: active(), locales: [...catalog.values()], revision: 0 };
  const chain = () => { const result: string[] = []; let next: string | undefined = localeSnapshot.active.toLowerCase(); while (next && !result.includes(next)) { result.push(next); next = catalog.get(next)?.fallback?.toLowerCase(); } if (!result.includes('en')) result.push('en'); return result; };
  const localePublish = () => {
    const previous = localeSnapshot.active;
    localeSnapshot = { active: active(), locales: [...catalog.values()], revision: localeSnapshot.revision + 1 };
    document.documentElement.lang = localeSnapshot.active === 'zh' ? 'zh-CN' : localeSnapshot.active;
    for (const fn of [...listeners]) { try { fn(); } catch (error) { console.error(error); } }
    if (previous !== localeSnapshot.active) (ctx as any).emit('locale/change', localeSnapshot);
  };
  const locale = {
    getLocale: () => localeSnapshot, getSnapshot: () => localeSnapshot,
    subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
    setLocale(id: string) { const language = catalog.get(id.toLowerCase()); if (!language) throw new Error(`未知语言：${id}`); preferenceLocale = language.id; save('town.dsh.locale', preferenceLocale); localePublish(); },
    addLanguage(input: Language) {
      const key = input.id.toLowerCase(), fallback = catalog.get(input.fallback?.toLowerCase() || '');
      if (!languagePattern.test(input.id) || !input.label.trim() || catalog.has(key) || !fallback) throw new Error('无效语言或 fallback');
      const entry = { ...input, fallback: fallback.id }; catalog.set(key, entry); localePublish();
      return () => { if (catalog.get(key) === entry) { catalog.delete(key); localePublish(); } };
    },
    resolveText(text: string | Record<string, string>) { if (typeof text === 'string') return text; return chain().map(id => text[id]).find(value => value !== undefined) ?? text.en; },
    register(ns: string, languageOrTable: string | Record<string, Record<string, string>>, dictionary?: Record<string, string>) {
      const table = Object.entries(typeof languageOrTable === 'string' ? { [languageOrTable]: dictionary! } : languageOrTable).map(([id, dict]) => [id.toLowerCase(), dict] as const);
      const map = dictionaries.get(ns) ?? new Map(); dictionaries.set(ns, map);
      for (const [id] of table) if (!languagePattern.test(id) || map.has(id)) throw new Error(`无效或重复的语言字典：${ns}/${id}`);
      for (const [id, dict] of table) map.set(id, dict);
      localePublish();
      return () => { for (const [id, dict] of table) if (map.get(id) === dict) map.delete(id); localePublish(); };
    },
    bind(ns: string) {
      if (!bound.has(ns)) bound.set(ns, (key, params = {}) => {
        const lookup = (namespace: string) => chain().map(id => dictionaries.get(namespace)?.get(id)?.[key]).find(value => value !== undefined);
        const value = lookup(ns) ?? lookup('common') ?? key;
        return value.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
      });
      return bound.get(ns)!;
    },
  };
  ctx.provide('locale', locale); localePublish();
  return { theme, locale, refreshAppearance: publish };
}
