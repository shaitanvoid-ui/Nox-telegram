import { test, expect, type Page, type APIResponse } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const chat = "/api/v1/chats/-1001001";
const destinations = [
  ["Модерация", "/moderation", "Модерация"],
  ["Astra Shield", "/shield", "Защита сообщества"],
  ["Intelligence", "/intelligence", "Разбор сигналов"],
  ["Studio", "/studio", "Сценарии"],
  ["Аналитика", "/analytics", "Аналитика"],
  ["Апелляции", "/appeals", "Апелляции"],
  ["Настройки", "/settings", "Настройки"],
  ["Обзор", "/", "Ваше сообщество."],
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
    "Ваше сообщество.",
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
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
  await navigate(page, "Модерация", "/moderation", "Модерация");
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
  const createdResponse = await created;
  expect(createdResponse.ok()).toBeTruthy();
  expect(await createdResponse.json()).toMatchObject({
    kind: "warn",
    reason,
    target_user_id: 1007,
    status: "applied",
  });
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

  await navigate(page, "Astra Shield", "/shield", "Защита сообщества");
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
  const sensitivity = page.getByRole("slider", {
    name: "Чувствительность",
    exact: true,
  });
  const previousSensitivity = Number(await sensitivity.inputValue());
  const nextSensitivity =
    previousSensitivity === 100
      ? previousSensitivity - 1
      : previousSensitivity + 1;
  await sensitivity.focus();
  await sensitivity.press(
    previousSensitivity === 100 ? "ArrowLeft" : "ArrowRight",
  );
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const savedShield = await read(
    await request.get(`http://127.0.0.1:8010${chat}/shield`, { headers }),
  );
  expect(
    savedShield.modules.find(
      (item: { key: string }) => item.key === "anti_spam",
    ).sensitivity,
  ).toBe(nextSensitivity);

  await navigate(page, "Studio", "/studio", "Сценарии");
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
  const rule = page.locator(".ap-rule").filter({ hasText: name });
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

  await navigate(page, "Настройки", "/settings", "Настройки");
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
  await navigate(page, "Обзор", "/", "Ваше сообщество.");
  await navigate(page, "Настройки", "/settings", "Настройки");
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Настройки");
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
    .getByRole("link", { name: "Astra Shield", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Доступ ограничен");
  await expect(page.getByRole("alert")).toContainText(
    "Тест: роль не разрешает доступ",
  );
  await expect(page.getByRole("switch")).toHaveCount(0);

  // A transport success is not proof that Telegram applied the action.
  // Explicitly simulate an ambiguous result and keep the interface honest.
  await navigate(page, "Модерация", "/moderation", "Модерация");
  const ambiguousCase = {
    id: "e2e-ambiguous-case",
    kind: "warn",
    reason: "E2E неоднозначный результат",
    target_name: "София",
    target_user_id: 1007,
    actor_name: "Демо-администратор",
    status: "unknown",
    created_at: new Date().toISOString(),
    expires_at: null,
  };
  await page.route(`**${chat}/cases`, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(ambiguousCase),
        })
      : route.continue(),
  );
  await page
    .getByRole("button", { name: "Новое действие", exact: true })
    .click();
  const creation = page.getByRole("dialog", { name: "Новое действие" });
  await creation.getByLabel("Участник", { exact: true }).selectOption("1007");
  await creation
    .getByLabel("Причина", { exact: false })
    .fill(ambiguousCase.reason);
  await creation.getByRole("button", { name: "Подтвердить действие" }).click();
  await expect(creation).toBeHidden();
  await expect(page.getByRole("alert")).toHaveText(
    "Действие не подтверждено. Статус: Нужна проверка. Проверьте историю перед повторной отправкой.",
  );
  await expect(
    page.getByText(
      "Действие сохранено в демонстрационной базе. Telegram не подключён.",
      { exact: true },
    ),
  ).toHaveCount(0);

  await page.route(`**${chat}/cases/*/revoke`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ambiguousCase),
    }),
  );
  await page
    .locator(".case-row")
    .getByRole("button", { name: /Отменить наказание/ })
    .first()
    .click();
  const revocation = page.getByRole("dialog");
  await revocation
    .getByRole("button", { name: "Отменить наказание", exact: true })
    .click();
  await expect(revocation).toBeHidden();
  await expect(page.getByRole("alert")).toHaveText(
    "Отмена не подтверждена. Статус: Нужна проверка. Проверьте историю перед повторной отправкой.",
  );
  await expect(
    page.getByText("Наказание отменено в демонстрационной базе.", {
      exact: true,
    }),
  ).toHaveCount(0);
});

test("real API: capture desktop and mobile dashboard screenshots", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  const directory = fileURLToPath(
    new URL("../../../docs/screenshots/", import.meta.url),
  );
  await mkdir(directory, { recursive: true });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Открыть демо-пространство" }),
  ).toBeVisible();
  await settle(page);
  await page.screenshot({
    path: `${directory}/welcome-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });
  await login(page);
  const artwork = page.locator(".nd-hero-art img");
  await expect(artwork).toBeVisible();
  await expect
    .poll(() =>
      artwork.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  const day = page.getByRole("slider", { name: "День на графике" });
  await day.focus();
  await day.press("Home");
  await expect(day).toHaveValue("0");
  await expect(
    page.getByRole("table", { name: "Сообщения и нарушения по дням" }),
  ).toHaveCount(1);
  await day.press("End");
  await day.evaluate((input: HTMLInputElement) => input.blur());
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await settle(page);
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
    await mobile.goto("/");
    await expect(
      mobile.getByRole("button", { name: "Открыть демо-пространство" }),
    ).toBeVisible();
    await settle(mobile);
    await mobile.screenshot({
      path: `${directory}/welcome-mobile.png`,
      fullPage: true,
      animations: "disabled",
    });
    await login(mobile);
    const capture = await mobile.screenshot({
      path: `${directory}/dashboard-mobile.png`,
      fullPage: false,
      animations: "disabled",
    });
    expect(capture.readUInt32BE(16)).toBe(390);
    await mobile.evaluate(() =>
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "instant",
      }),
    );
    const lastShortcut = mobile
      .getByRole("navigation", { name: "Быстрые действия" })
      .getByRole("link")
      .last();
    await expect(lastShortcut).toBeVisible();
    const shortcutBox = await lastShortcut.boundingBox();
    const dockBox = await mobile
      .getByRole("navigation", { name: "Мобильная навигация" })
      .boundingBox();
    expect(shortcutBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect(shortcutBox!.y + shortcutBox!.height).toBeLessThanOrEqual(
      dockBox!.y - 8,
    );
    await mobile.screenshot({
      path: `${directory}/mobile-navigation.png`,
      fullPage: false,
      animations: "disabled",
    });
  } finally {
    await mobileContext.close();
  }
});
