import { test, expect, type Page, type APIResponse } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const chat = "/api/v1/chats/-1001001";
const destinations = [
  ["Модерация", "/moderation", "Порядок без шума"],
  ["NOX Shield", "/shield", "Спокойствие по умолчанию"],
  ["Intelligence", "/intelligence", "Контекст важнее совпадений"],
  ["Studio", "/studio", "Меньше рутины. Больше идей"],
  ["Аналитика", "/analytics", "За цифрами — люди"],
  ["Апелляции", "/appeals", "Каждый голос имеет значение"],
  ["Настройки", "/settings", "По вашим правилам"],
  ["Обзор", "/", "Включено 8 из 10 модулей защиты"],
] as const;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".loading-state")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  // ResponsiveContainer measures its new parent asynchronously after a route or resize.
  await page.waitForTimeout(500);
}

async function login(page: Page): Promise<string> {
  await page.goto("/");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/auth/demo") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Открыть демо-пространство" }).click();
  const session = await (await response).json();
  expect(session.mode).toBe("demo");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Включено 8 из 10 модулей защиты",
  );
  await expect(
    page.getByText("Telegram не подключён.", { exact: false }).first(),
  ).toBeVisible();
  await settle(page);
  return session.access_token as string;
}

async function navigate(
  page: Page,
  label: string,
  path: string,
  heading: string,
) {
  const sidebar = page.getByRole("navigation", {
    name: "Основная навигация",
    exact: true,
  });
  if (await sidebar.isVisible()) {
    await sidebar
      .getByRole("link", { name: label, exact: label !== "Intelligence" })
      .click();
  } else {
    await page
      .getByRole("navigation", { name: "Мобильная навигация" })
      .getByRole("button", { name: "Ещё" })
      .click();
    await page
      .getByRole("dialog", { name: "Навигация" })
      .getByRole("link", { name: label, exact: label !== "Intelligence" })
      .click();
  }
  await expect(page).toHaveURL(`http://127.0.0.1:5174${path}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    path === "/" ? heading : `${heading}.`,
  );
  await settle(page);
}

async function read(response: APIResponse) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("real API: warn, search, revoke, shield, automation preview, settings and persisted state", async ({
  page,
  request,
}) => {
  const token = await login(page);
  const headers = { Authorization: `Bearer ${token}` };
  const reason = `E2E проверка предупреждения ${Date.now()}`;
  await navigate(page, "Модерация", "/moderation", "Порядок без шума");
  await page
    .getByRole("button", { name: "Новое действие", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "Новое действие" });
  await modal.getByLabel("Участник", { exact: true }).selectOption("1007");
  await modal.getByLabel("Причина", { exact: false }).fill(reason);
  const created = page.waitForResponse(
    (r) => r.url().endsWith(`${chat}/cases`) && r.request().method() === "POST",
  );
  await modal.getByRole("button", { name: "Подтвердить действие" }).click();
  expect((await created).ok()).toBeTruthy();
  await expect(modal).toBeHidden();
  await page
    .getByRole("textbox", { name: "Поиск участников и действий" })
    .fill(reason);
  const row = page.locator(".case-row").filter({ hasText: reason });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Применено");
  await row.getByRole("button", { name: "Отменить наказание София" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Отменить наказание", exact: true })
    .click();
  await expect(row).toContainText("Отменено");
  await expect(row.getByRole("button")).toHaveCount(0);

  await navigate(page, "NOX Shield", "/shield", "Спокойствие по умолчанию");
  const antiSpam = page.getByRole("switch", {
    name: "Включить Anti-Spam",
    exact: true,
  });
  const wasEnabled = await antiSpam.getAttribute("aria-checked");
  await antiSpam.click();
  await expect(antiSpam).toHaveAttribute(
    "aria-checked",
    wasEnabled === "true" ? "false" : "true",
  );
  const shield = await read(
    await request.get(`http://127.0.0.1:8010${chat}/shield`, { headers }),
  );
  expect(
    shield.modules.find((item: { key: string }) => item.key === "anti_spam")
      .enabled,
  ).toBe(wasEnabled !== "true");
  await antiSpam.click();
  await expect(antiSpam).toHaveAttribute("aria-checked", wasEnabled!);
  await page
    .getByRole("button", { name: "Настройки Anti-Spam", exact: true })
    .click();
  await page
    .getByRole("slider", { name: "Чувствительность", exact: true })
    .focus();
  await page
    .getByRole("slider", { name: "Чувствительность", exact: true })
    .press("ArrowRight");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const savedShield = await read(
    await request.get(`http://127.0.0.1:8010${chat}/shield`, { headers }),
  );
  expect(
    savedShield.modules.find(
      (item: { key: string }) => item.key === "anti_spam",
    ).sensitivity,
  ).toBe(51);

  await navigate(page, "Studio", "/studio", "Меньше рутины. Больше идей");
  await page
    .getByRole("button", { name: "Создать сценарий", exact: true })
    .first()
    .click();
  const name = `E2E приветствие ${Date.now()}`;
  await page
    .getByRole("dialog")
    .getByLabel("Название", { exact: true })
    .fill(name);
  await page.getByRole("button", { name: "Предпросмотр" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Действия не выполнялись",
  );
  await page
    .getByRole("button", { name: "Сохранить сценарий", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const rule = page.locator(".rule-card").filter({ hasText: name });
  await expect(rule).toBeVisible();
  await rule.getByRole("switch").click();
  await expect(rule.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  const rules = await read(
    await request.get(`http://127.0.0.1:8010${chat}/automation`, { headers }),
  );
  expect(
    rules.items.find((item: { name: string }) => item.name === name).enabled,
  ).toBe(false);

  await navigate(page, "Настройки", "/settings", "По вашим правилам");
  const welcome = `E2E проверка сохранения ${Date.now()}`;
  await page
    .getByLabel("Приветственное сообщение", { exact: false })
    .fill(welcome);
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Настройки сохранены." }),
  ).toBeVisible();
  const settings = await read(
    await request.get(`http://127.0.0.1:8010${chat}/settings`, { headers }),
  );
  expect(settings.welcome_message).toBe(welcome);
  await navigate(page, "Обзор", "/", "Включено 8 из 10 модулей защиты");
  await navigate(page, "Настройки", "/settings", "По вашим правилам");
  await expect(
    page.getByLabel("Приветственное сообщение", { exact: false }),
  ).toHaveValue(welcome);
});

test("real API: desktop navigation and no horizontal overflow at all required widths", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [320, 360, 375, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [label, path, heading] of destinations) {
      await navigate(page, label, path, heading);
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(layout.document, `${path} at ${width}px`).toBeLessThanOrEqual(
        layout.viewport + 1,
      );
      expect(layout.body, `${path} body at ${width}px`).toBeLessThanOrEqual(
        layout.viewport + 1,
      );
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

test("error UI: explicit simulated API outage retries and a 403 remains a denial", async ({
  page,
}) => {
  await login(page);
  const route = `**${chat}/settings`;
  await page.route(route, (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "unavailable",
          message: "Тест: база данных временно недоступна",
        },
      }),
    }),
  );
  await page
    .getByRole("navigation", { name: "Основная навигация", exact: true })
    .getByRole("link", { name: "Настройки", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Не удалось загрузить данные",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Тест: база данных временно недоступна",
  );
  await page.unroute(route);
  await page.getByRole("button", { name: "Повторить запрос" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "По вашим правилам.",
  );
  await page.route(`**${chat}/shield`, (r) =>
    r.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "forbidden", message: "Тест: роль не разрешает доступ" },
      }),
    }),
  );
  await page
    .getByRole("navigation", { name: "Основная навигация", exact: true })
    .getByRole("link", { name: "NOX Shield", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Доступ ограничен");
  await expect(page.getByRole("alert")).toContainText(
    "Тест: роль не разрешает доступ",
  );
  await expect(page.getByRole("switch")).toHaveCount(0);
});

test("real API: capture desktop and mobile dashboard screenshots", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await login(page);
  const directory = fileURLToPath(
    new URL("../../../docs/screenshots/", import.meta.url),
  );
  await mkdir(directory, { recursive: true });
  const desktop = await page.screenshot({
    path: `${directory}/dashboard-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect(desktop.readUInt32BE(16)).toBe(1440);
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const mobile = await mobileContext.newPage();
    await login(mobile);
    const capture = await mobile.screenshot({
      path: `${directory}/dashboard-mobile.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(capture.readUInt32BE(16)).toBe(390);
  } finally {
    await mobileContext.close();
  }
});
