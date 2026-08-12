import "@testing-library/jest-dom/vitest";

const storage = new Map<string, string>();

const testLocalStorage: Storage = {
  get length() {
    return storage.size;
  },
  clear() {
    storage.clear();
  },
  getItem(key: string) {
    return storage.get(key) ?? null;
  },
  key(index: number) {
    return Array.from(storage.keys())[index] ?? null;
  },
  removeItem(key: string) {
    storage.delete(key);
  },
  setItem(key: string, value: string) {
    storage.set(key, value);
  }
};

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: testLocalStorage
});

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: testLocalStorage
});

if (typeof HTMLElement.prototype.scrollTo !== "function") {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: () => undefined
  });
}
