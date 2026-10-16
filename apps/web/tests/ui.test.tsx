import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../src/api";
import { Button, ErrorState, Field, Modal, Switch } from "../src/components/ui";

describe("accessible controls", () => {
  it("exposes switch state and changes it with the keyboard", async () => {
    const user = userEvent.setup();
    function Example() {
      const [checked, setChecked] = useState(false);
      return (
        <Switch label="Anti-Flood" checked={checked} onChange={setChecked} />
      );
    }
    render(<Example />);
    const control = screen.getByRole("switch", { name: "Anti-Flood" });
    expect(control).toHaveAttribute("aria-checked", "false");
    await user.tab();
    await user.keyboard(" ");
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("prevents changes while a switch request is pending", async () => {
    const changed = vi.fn();
    render(<Switch label="Anti-Spam" checked onChange={changed} disabled />);
    await userEvent.click(screen.getByRole("switch"));
    expect(changed).not.toHaveBeenCalled();
  });

  it("prevents duplicate submissions while a button is loading", async () => {
    const submit = vi.fn();
    render(
      <Button loading onClick={submit}>
        Сохранить
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(submit).not.toHaveBeenCalled();
  });

  it("distinguishes authorization denial from a recoverable server failure", async () => {
    const retry = vi.fn();
    const view = render(
      <ErrorState error={new ApiError(403, "Чат недоступен")} retry={retry} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Доступ ограничен");
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить запрос" }),
    );
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<ErrorState error={new ApiError(503, "База недоступна")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Не удалось загрузить данные",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("modal keyboard lifecycle", () => {
  it("traps focus, closes on Escape and restores focus and page scrolling", async () => {
    const user = userEvent.setup();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Открыть</button>
          {open && (
            <Modal title="Подтвердить действие" onClose={() => setOpen(false)}>
              <input aria-label="Причина" />
              <button onClick={() => setOpen(false)}>Подтвердить</button>
            </Modal>
          )}
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Открыть" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Подтвердить действие" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.body.style.overflow).toBe("hidden");
    const first = screen.getByRole("button", { name: "Закрыть окно" });
    const last = screen.getByRole("button", { name: "Подтвердить" });
    expect(first).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on the backdrop and ignores clicks inside the dialog", () => {
    const close = vi.fn();
    render(
      <Modal title="Проверка" onClose={close}>
        <p>Контекст решения</p>
      </Modal>,
    );
    fireEvent.click(screen.getByText("Контекст решения"));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("modal editing", () => {
  it("keeps keyboard focus while parent state and close callbacks change", async () => {
    const user = userEvent.setup();
    function Example() {
      const [value, setValue] = useState("");
      return (
        <Modal title="Причина действия" onClose={() => undefined}>
          <input
            aria-label="Текст причины"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Modal>
      );
    }
    render(<Example />);
    const input = screen.getByRole("textbox", { name: "Текст причины" });
    await user.click(input);
    await user.type(input, "Повторяющийся спам");
    expect(input).toHaveValue("Повторяющийся спам");
    expect(input).toHaveFocus();
  });
});

describe("form field names", () => {
  it("keeps a select label independent of options and exposes its hint separately", () => {
    render(
      <Field label="Участник" hint="Выберите пользователя чата">
        <select defaultValue="">
          <option value="">Выберите участника</option>
          <option value="1007">София</option>
        </select>
      </Field>,
    );
    const select = screen.getByLabelText("Участник", { exact: true });
    expect(select).toHaveAccessibleName("Участник");
    expect(select).toHaveAccessibleDescription("Выберите пользователя чата");
  });
});
