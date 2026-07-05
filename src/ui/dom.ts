// Tiny DOM helpers. Build elements with `el(tag, attrs, ...children)` rather than
// innerHTML string concatenation (except the deliberate `html:` escape hatch).

export function $(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

export function $all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel));
}

type ElChild = Node | string | null | undefined;
type ElAttrs = Record<string, string | ((e: Event) => void)>;

export function el(
  tag: string,
  attrs?: ElAttrs | null,
  ...children: Array<ElChild | ElChild[]>
): HTMLElement {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (k === 'class') e.className = v as string;
      else if (k === 'html') e.innerHTML = v as string;
      else if (k.startsWith('on') && typeof v === 'function')
        e.addEventListener(k.slice(2), v as EventListener);
      else e.setAttribute(k, v as string);
    }
  }
  children.flat().forEach((c) => {
    if (c === null || c === undefined) return;
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  });
  return e;
}

export function setSpin(id: string, on: boolean): void {
  const elx = document.getElementById(id);
  if (!elx) return;
  elx.classList.toggle('spinning', !!on);
}
