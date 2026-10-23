import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ConfirmProvider } from "../shared/ConfirmDialog";
import { LibraryEntryEditorModal } from "./LibraryEntryEditorModal";
import { LibraryWorkspace } from "./LibraryWorkspace";

vi.mock("../shared/ToastViewport", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));
const wrap = (element: ReactNode) => render(<I18nProvider><ConfirmProvider>{element}</ConfirmProvider></I18nProvider>);
const props = (extra: Partial<Parameters<typeof LibraryWorkspace>[0]> = {}): Parameters<typeof LibraryWorkspace>[0] => ({
  libraries: [{ filename: "Test.json", count: 1, size: 20 }], activeLibraryName: "Test.json", entries: [{ name: "Soft daylight", source_index: 0 }],
  page: 1, totalPages: 1, totalEntries: 1, editorValue: "[]", isEditing: false, isDirty: false, isLoading: false, isRefreshing: false, isSubmitting: false,
  error: null, statusMessage: "", validationIssues: [], canUseRawEditor: true, searchTerm: "", onSearchClear: vi.fn(), onSearchChange: vi.fn(),
  onEditorValueChange: vi.fn(), onPageChange: vi.fn(), onStartEditing: vi.fn(), onCancelEditing: vi.fn(), onFormatEditor: vi.fn(), onSaveLibrary: vi.fn(),
  onRefresh: vi.fn(), onExportLibrary: vi.fn(), onImportLibrary: vi.fn().mockResolvedValue(true), onSaveEntry: vi.fn().mockResolvedValue(true), onDeleteEntry: vi.fn().mockResolvedValue(true), ...extra,
});

describe("library content-first workspace", () => {
  it("shows entries and inline search before optional help", async () => {
    wrap(<LibraryWorkspace {...props()} />);
    expect(screen.getByRole("heading", { name: "Soft daylight" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "搜索当前词库中的词条..." })).toBeVisible();
    const help = screen.getByText("先看条目规模，再决定用单条编辑还是整库 JSON 编辑。");
    expect(help).not.toBeVisible();
    await userEvent.click(screen.getByText("词库概览与使用说明")); expect(help).toBeVisible();
  });
  it("distinguishes filtered-out entries from an empty library and offers a clear action", async () => {
    const onSearchClear = vi.fn();
    wrap(<LibraryWorkspace {...props({ entries: [], totalEntries: 0, searchTerm: "missing", onSearchClear })} />);
    expect(screen.getByRole("heading", { name: "没有匹配的词条" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "这个词库还是空的" })).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: "清空搜索" }).at(-1)!);
    expect(onSearchClear).toHaveBeenCalledOnce();
  });
  it("keeps an edited entry after cancelling Escape, then closes only after explicit discard", async () => {
    const onClose = vi.fn();
    wrap(<LibraryEntryEditorModal open title="Edit entry" initialEntry={{ name: "old" }} isSubmitting={false} onClose={onClose} onSave={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Edit entry" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: '{"name":"new"}' } });
    fireEvent.keyDown(dialog, { key: "Escape" });
    const confirmation = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirmation).getByRole("button", { name: "取消" }));
    expect(onClose).not.toHaveBeenCalled(); expect(within(dialog).getByRole("textbox")).toHaveValue('{"name":"new"}');
    fireEvent.keyDown(dialog, { key: "Escape" });
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "放弃修改" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
