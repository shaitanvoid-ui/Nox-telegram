import { cloneElement } from "react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityChart } from "../src/components/dashboard/ActivityChart";
import { DashboardView } from "../src/components/dashboard/DashboardView";
import { ShieldRing } from "../src/components/dashboard/ShieldRing";
import type { Dashboard } from "../src/types";

// jsdom has no layout; retain real Recharts rendering with explicit chart dimensions.
vi.mock("recharts", async (importOriginal) => {
  const original = await importOriginal<typeof import("recharts")>();
  return {
    ...original,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<Record<string, unknown>>;
    }) => cloneElement(children, { width: 640, height: 180 }),
  };
});

const activity = [
  { label: "14 окт.", messages: 2600, violations: 3 },
  { label: "15 окт.", messages: 1450, violations: 0 },
  { label: "16 окт.", messages: 3200, violations: 2 },
];

const data: Dashboard = {
  stats: {
    members: 100,
    messages_today: 3200,
    actions_today: 2,
    protection_score: 99,
  },
  protection: { enabled: 8, total: 10 },
  activity,
  recent_cases: [],
  mode: "demo",
};

describe("data-driven Shield contour", () => {
  it("renders a complete circle for a single module instead of an invisible 360-degree SVG arc", () => {
    const view = render(<ShieldRing enabled={1} total={1} />);
    expect(
      screen.getByRole("img", { name: "Включено модулей защиты: 1 из 1" }),
    ).toBeInTheDocument();
    expect(
      view.container.querySelector("circle.nox-segment--on"),
    ).toHaveAttribute("r", "83");
  });

  it("clamps counts and handles an unconfigured contour without NaN", () => {
    const view = render(<ShieldRing enabled={15} total={10} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Включено модулей защиты: 10 из 10",
    );
    expect(view.container.querySelectorAll(".nox-segment--on")).toHaveLength(
      10,
    );
    view.rerender(<ShieldRing enabled={4} total={0} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Включено модулей защиты: 0 из 0",
    );
    expect(view.container.innerHTML).not.toContain("NaN");
    expect(view.container.querySelectorAll(".nox-segment--on")).toHaveLength(0);
  });
});

describe("independent activity scales and accessible day selection", () => {
  it("updates both values through the focusable day control and exposes all data as a table", async () => {
    const user = userEvent.setup();
    const view = render(<ActivityChart data={activity} />);
    const slider = screen.getByRole("slider", { name: "День на графике" });
    expect(slider).toHaveAttribute(
      "aria-valuetext",
      "16 окт.: сообщения — 3 200, нарушения — 2",
    );
    await user.tab();
    expect(slider).toHaveFocus();
    fireEvent.change(slider, { target: { value: "0" } });
    expect(slider).toHaveAttribute(
      "aria-valuetext",
      "14 окт.: сообщения — 2 600, нарушения — 3",
    );
    const readout = view.container.querySelector(".nox-chart-readout")!;
    expect(readout).toHaveTextContent("14 окт.");
    expect(readout).toHaveTextContent("2 600");
    expect(readout).toHaveTextContent("3");
    const table = screen.getByRole("table", {
      name: "Сообщения и нарушения по дням",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(screen.getByText("своя шкала: 0–3")).toBeInTheDocument();
  });

  it("uses independent identifiers for chart instances and keeps selection valid when the period shrinks", () => {
    const view = render(
      <>
        <ActivityChart data={activity} />
        <ActivityChart data={activity} />
      </>,
    );
    const sliders = screen.getAllByRole("slider");
    expect(sliders[0].id).not.toBe(sliders[1].id);
    const gradients = [
      ...view.container.querySelectorAll("linearGradient"),
    ].map((gradient) => gradient.id);
    expect(gradients).toHaveLength(2);
    expect(new Set(gradients).size).toBe(2);
    fireEvent.change(sliders[0], { target: { value: "2" } });
    view.rerender(
      <>
        <ActivityChart data={activity.slice(0, 1)} />
        <ActivityChart data={activity} />
      </>,
    );
    const resizedSliders = screen.getAllByRole("slider");
    expect(resizedSliders[0]).toHaveAttribute(
      "aria-valuetext",
      "14 окт.: сообщения — 2 600, нарушения — 3",
    );
    expect(resizedSliders[0]).toBeDisabled();
    expect(resizedSliders[1]).toHaveAttribute(
      "aria-valuetext",
      "16 окт.: сообщения — 3 200, нарушения — 2",
    );
  });

  it("distinguishes absent activity from measured zero violations", () => {
    const view = render(<ActivityChart data={[]} />);
    expect(screen.getByText("Пока нет данных за период")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    view.rerender(<ActivityChart data={[activity[1]]} />);
    expect(screen.getByRole("slider")).toHaveAttribute(
      "aria-valuetext",
      "15 окт.: сообщения — 1 450, нарушения — 0",
    );
  });

  it("localizes raw API month-day labels consistently without changing arbitrary labels", () => {
    const view = render(
      <ActivityChart
        data={[{ label: "10-16", messages: 11, violations: 1 }]}
      />,
    );
    expect(screen.getByRole("slider")).toHaveAttribute(
      "aria-valuetext",
      "16 окт.: сообщения — 11, нарушения — 1",
    );
    expect(
      within(screen.getByRole("table")).getByRole("rowheader"),
    ).toHaveTextContent("16 окт.");
    view.rerender(
      <ActivityChart
        data={[{ label: "Вчера", messages: 11, violations: 1 }]}
      />,
    );
    expect(screen.getByRole("slider")).toHaveAttribute(
      "aria-valuetext",
      "Вчера: сообщения — 11, нарушения — 1",
    );
  });
});

describe("dashboard facts and request states", () => {
  it("derives the enabled-module percentage from real counts and preserves actual navigation", () => {
    render(
      <MemoryRouter>
        <DashboardView
          communityName="NOX Community"
          status="success"
          data={data}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Включено 8 из 10 модулей защиты",
    );
    const metric = screen.getByText("Включено модулей").closest(".nox-metric")!;
    expect(metric).toHaveTextContent("80%");
    expect(metric).not.toHaveTextContent("99%");
    expect(
      screen.getByRole("link", { name: "Настроить Shield" }),
    ).toHaveAttribute("href", "/shield");
    expect(screen.getByRole("link", { name: /Апелляции/ })).toHaveAttribute(
      "href",
      "/appeals",
    );
    expect(screen.getByText("История пока чиста")).toBeInTheDocument();
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
  });

  it("offers retry on server failure, explains denied access, and represents loading honestly", async () => {
    const retry = vi.fn();
    const view = render(
      <DashboardView
        communityName="NOX"
        status="error"
        errorCode={503}
        onRetry={retry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Не удалось загрузить обзор",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить запрос" }),
    );
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(
      <DashboardView
        communityName="NOX"
        status="error"
        errorCode={403}
        onRetry={retry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Нет доступа к обзору");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.rerender(<DashboardView communityName="NOX" status="pending" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});
