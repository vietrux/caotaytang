export const $ = (sel) => document.querySelector(sel);

export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === false || v == null) continue;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const k of kids) {
    if (k == null) continue;
    e.append(k.nodeType ? k : document.createTextNode(k));
  }
  return e;
};

let toastT;
export function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = (isErr ? 'Error: ' : '') + msg;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.textContent = ''; }, 2400);
}
