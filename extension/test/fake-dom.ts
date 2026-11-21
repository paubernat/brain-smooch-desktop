// Just enough DOM for the label panel to run under vitest's node environment
// (elements, class lists, a shadow root, listeners and synthetic events).
// Events do not bubble: tests dispatch them on the element that listens.

type Listener = (event: FakeEvent) => void;

export interface FakeEvent {
  type: string;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  [key: string]: unknown;
}

export function fakeEvent(type: string, init: Record<string, unknown> = {}): FakeEvent {
  const event: FakeEvent = {
    type,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {},
    ...init,
  };
  return event;
}

class FakeEventTarget {
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatchEvent(event: FakeEvent): void {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }
}

class FakeClassList {
  constructor(private readonly el: FakeElement) {}

  private get set(): Set<string> {
    return new Set(this.el.className.split(/\s+/).filter(Boolean));
  }

  private write(set: Set<string>): void {
    this.el.className = [...set].join(' ');
  }

  contains(name: string): boolean {
    return this.set.has(name);
  }

  add(name: string): void {
    this.write(this.set.add(name));
  }

  remove(name: string): void {
    const set = this.set;
    set.delete(name);
    this.write(set);
  }

  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.contains(name);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

export class FakeElement extends FakeEventTarget {
  className = '';
  id = '';
  title = '';
  type = '';
  placeholder = '';
  value = '';
  maxLength = -1;
  disabled = false;
  isConnected = false;
  children: FakeElement[] = [];
  shadow: FakeElement | null = null;
  readonly classList = new FakeClassList(this);
  readonly attributes = new Map<string, string>();
  private text = '';

  constructor(readonly tagName: string) {
    super();
  }

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.isConnected = this.isConnected;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children = [];
    this.text = '';
    this.append(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  attachShadow(): FakeElement {
    this.shadow = new FakeElement('#shadow-root');
    return this.shadow;
  }

  click(): void {
    this.dispatchEvent(fakeEvent('click'));
  }

  /** Depth-first search, including shadow roots. */
  findAll(predicate: (el: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of [...(this.shadow ? [this.shadow] : []), ...this.children]) {
      if (predicate(child)) out.push(child);
      out.push(...child.findAll(predicate));
    }
    return out;
  }
}

export interface FakeDom {
  window: FakeEventTarget;
  documentElement: FakeElement;
}

/** Install `document` and `window` globals; returns them for assertions. */
export function installFakeDom(): FakeDom {
  const documentElement = new FakeElement('html');
  documentElement.isConnected = true;
  const window = new FakeEventTarget();
  Object.assign(globalThis, {
    window,
    document: { documentElement, createElement: (tag: string) => new FakeElement(tag) },
  });
  return { window, documentElement };
}
