import { $ } from './util.js';

const s = {
  cfg: null,
  preview: { autoPatterns: [], bodyPatternCount: 0 },
  dirty: false,
};

export const getCfg = () => s.cfg;
export const setCfg = (v) => { s.cfg = v; };

export const getPreview = () => s.preview;
export const setPreview = (v) => { s.preview = v; };

export const isDirty = () => s.dirty;
export function markDirty(v) {
  s.dirty = v;
  $('#save-bar').classList.toggle('on', v);
}
