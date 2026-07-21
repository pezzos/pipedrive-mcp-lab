import { expect, test } from "playwright/test";
import AxeBuilder from "@axe-core/playwright";

const userScenarios = ["disconnected", "connected", "reconnect", "replacement", "admission", "company-mismatch", "oauth-cancelled", "oauth-error", "conflict", "storage", "settings-readonly", "settings-mixed", "settings-error"];
const adminScenarios = ["admin-empty", "admin-typical", "admin-suspended", "admin-reconnect", "confirm-approve", "confirm-suspend", "confirm-resume", "confirm-force", "ticket-error", "density"];
const viewports = [{ width: 320, height: 812 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }];

const interactiveSelector = "a,button,input:not([type=hidden]),[tabindex]:not([tabindex='-1'])";

async function expectMinimumTargets(page: import("playwright/test").Page): Promise<void> {
  const failures = await page.locator(interactiveSelector).evaluateAll((nodes) => nodes.flatMap((node) => {
    const element = node as HTMLElement;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];
    return rect.width >= 44 && rect.height >= 44 ? [] : [{ tag: element.tagName, text: element.textContent?.trim(), width: rect.width, height: rect.height }];
  }));
  expect(failures).toEqual([]);
}

async function expectNoUncontainedOverflow(page: import("playwright/test").Page): Promise<void> {
  const violations = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const allowed = (element: Element) => Boolean(element.closest(".table-region"));
    const failures: Array<Record<string, unknown>> = [];
    if (document.documentElement.scrollWidth > viewportWidth + 1) failures.push({ tag: "HTML", scrollWidth: document.documentElement.scrollWidth, viewportWidth });
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      if (!(element instanceof HTMLElement) || allowed(element)) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = element.getBoundingClientRect();
      if (rect.right > viewportWidth + 1 || rect.left < -1 || element.scrollWidth > element.clientWidth + 1) {
        failures.push({ tag: element.tagName, className: element.className, left: rect.left, right: rect.right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, viewportWidth });
      }
    }
    return failures;
  });
  expect(violations).toEqual([]);
}

async function expectUnclippedCriticalContent(page: import("playwright/test").Page): Promise<void> {
  const failures = await page.locator(`h1,h2,${interactiveSelector}`).evaluateAll((nodes) => nodes.flatMap((node) => {
    const element = node as HTMLElement;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];
    const scroller = element.closest(".table-region");
    if (scroller && element !== scroller) return [];
    return rect.left >= -1 && rect.right <= innerWidth + 1 && (scroller || element.scrollWidth <= element.clientWidth + 1)
      ? [] : [{ tag: element.tagName, text: element.textContent?.trim(), left: rect.left, right: rect.right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }];
  }));
  expect(failures).toEqual([]);
}

async function expectReducedMotion(page: import("playwright/test").Page): Promise<void> {
  const failures = await page.locator("*").evaluateAll((nodes) => nodes.flatMap((node) => {
    const style = getComputedStyle(node);
    const durations = [...style.transitionDuration.split(","), ...style.animationDuration.split(",")].map((value) => value.trim());
    return durations.every((value) => value === "0s" || value === "0ms") ? [] : [{ tag: node.tagName, transitionDuration: style.transitionDuration, animationDuration: style.animationDuration }];
  }));
  expect(failures).toEqual([]);
}

async function expectContrast(page: import("playwright/test").Page): Promise<void> {
  const failures = await page.evaluate((selector) => {
    type Rgb = [number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const parse = (value: string): Rgb | undefined => {
      if (!context) return undefined;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const rgba = context.getImageData(0, 0, 1, 1).data;
      return rgba[3] === 0 ? undefined : [rgba[0], rgba[1], rgba[2]];
    };
    const linear = (channel: number) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (rgb: Rgb) => 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
    const ratio = (foreground: Rgb, background: Rgb) => {
      const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (light + 0.05) / (dark + 0.05);
    };
    const background = (element: Element): Rgb | undefined => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        const color = parse(getComputedStyle(current).backgroundColor);
        if (color) return color;
      }
      return undefined;
    };
    const samples = [
      [document.body, "body", 4.5],
      ...Array.from(document.querySelectorAll(".intro,.muted,dt,caption")).map((node) => [node, "muted", 4.5] as const),
      ...Array.from(document.querySelectorAll(".notice")).map((node) => [node, "status", 4.5] as const),
      ...Array.from(document.querySelectorAll("a,button")).map((node) => [node, "action", 4.5] as const),
    ] as Array<[Element, string, number]>;
    const failures: Array<Record<string, unknown>> = [];
    for (const [element, role, minimum] of samples) {
      const foreground = parse(getComputedStyle(element).color);
      const backdrop = background(element);
      const value = foreground && backdrop ? ratio(foreground, backdrop) : 0;
      if (value < minimum) failures.push({ role, text: element.textContent?.trim(), ratio: value, minimum });
    }
    for (const element of Array.from(document.querySelectorAll(selector))) {
      if (!(element instanceof HTMLElement) || element.hasAttribute("disabled") || element.getBoundingClientRect().width === 0 || element.getBoundingClientRect().height === 0) continue;
      element.focus();
      const style = getComputedStyle(element);
      const outline = parse(style.outlineColor);
      const backdrop = background(element.parentElement || document.body);
      const value = outline && backdrop ? ratio(outline, backdrop) : 0;
      if (style.outlineStyle === "none" || value < 3) failures.push({ role: "focus", tag: element.tagName, outlineStyle: style.outlineStyle, ratio: value, minimum: 3 });
    }
    return failures;
  }, interactiveSelector);
  expect(failures).toEqual([]);
}

for (const scenario of [...userScenarios, ...adminScenarios]) test(`actual ${scenario} renderer has a complete security envelope and WCAG 2.2 AA`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(viewports[1]);
  const response = await page.goto(`/${scenario}`);
  const headers = response?.headers() ?? {};
  expect(headers["content-type"]).toBe("text/html; charset=utf-8");
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["content-security-policy"]).toBe("default-src 'none'; style-src 'nonce-fixture-nonce'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  const styles = page.locator("style[nonce]");
  await expect(styles).toHaveCount(1);
  expect(await styles.evaluate((node) => (node as HTMLStyleElement).nonce)).toBe("fixture-nonce");
  expect(await page.locator("script,img,link[rel=stylesheet],link[rel=preload][as=font],[style]").count()).toBe(0);
  expect(await page.locator("form").evaluateAll((forms) => forms.every((form) => new URL(form.getAttribute("action") || "/", location.origin).origin === location.origin))).toBeTruthy();
  expect(await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).toMatchObject({ violations: [] });
  await expectReducedMotion(page);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  expect(await page.locator(":focus").evaluate((node) => getComputedStyle(node).outlineStyle !== "none")).toBeTruthy();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport); await page.goto(`/${scenario}`);
    await expectNoUncontainedOverflow(page);
    await expectMinimumTargets(page);
  }
});

test("actual renderer matrix has 44px targets, keyboard operation, text resize, reduced motion and only named table overflow", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport); await page.goto("/density");
    await expectNoUncontainedOverflow(page);
    await expectMinimumTargets(page);
  }
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/settings-mixed");
  expect(await page.locator("input[type=checkbox]").count()).toBeGreaterThan(0);
  const box = page.locator("input[type=checkbox]").first(); await box.focus(); const before = await box.isChecked(); await page.keyboard.press("Space"); expect(await box.isChecked()).toBe(!before);
  await page.goto("/confirm-force"); await page.getByRole("link", { name: "Annuler" }).press("Enter");
  await page.goto("/density"); await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expectNoUncontainedOverflow(page);
});

test("representative pages complete keyboard traversal without a focus trap", async ({ page }) => {
  for (const scenario of ["connected", "settings-mixed", "admin-typical", "confirm-force"]) {
    await page.goto(`/${scenario}`);
    const focusableIndexes = await page.locator(interactiveSelector).evaluateAll((nodes) => nodes.flatMap((node, index) => {
      const element = node as HTMLElement;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 && !element.hasAttribute("disabled") ? [index] : [];
    }));
    expect(focusableIndexes.length).toBeGreaterThan(1);
    for (const expectedIndex of focusableIndexes) {
      await page.keyboard.press("Tab");
      const focusedIndex = await page.evaluate((selector) => Array.from(document.querySelectorAll(selector)).indexOf(document.activeElement as Element), interactiveSelector);
      expect(focusedIndex).toBe(expectedIndex);
      const focus = page.locator(":focus");
      await expect(focus).toBeVisible();
      expect(await focus.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
    }
    await page.keyboard.press("Tab");
    const cycledIndex = await page.evaluate((selector) => Array.from(document.querySelectorAll(selector)).indexOf(document.activeElement as Element), interactiveSelector);
    expect([focusableIndexes[0], -1]).toContain(cycledIndex);
  }
});

test("browser zoom, contrast, reduced motion, named overflow and trusted force target are evidenced", async ({ page }) => {
  await page.goto("/confirm-force");
  const forceTarget = page.locator("section.panel p").first();
  await expect(forceTarget).toContainText(`${"u".repeat(308)}@example.invalid`);
  await expect(forceTarget).toContainText(`${"a".repeat(63)}.pipedrive.com`);
  await expect(forceTarget).toContainText("Connectée");
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/settings-mixed");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--moss").includes("oklch"))).toBeTruthy();
  await expectReducedMotion(page);
  await expectContrast(page);
  await page.goto("/density");
  for (const scenario of ["connected", "settings-mixed", "storage", "density"]) {
    await page.setViewportSize({ width: 320, height: 812 }); await page.goto(`/${scenario}`);
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    try {
      await expectNoUncontainedOverflow(page);
      await expectUnclippedCriticalContent(page);
      await expectMinimumTargets(page);
    } finally {
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    }
  }
});
