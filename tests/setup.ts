import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined") {
  if (!window.HTMLElement.prototype.scrollIntoView) {
    // @ts-ignore - jsdom has no scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = function () {};
  }
}
