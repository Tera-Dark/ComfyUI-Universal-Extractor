import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import type { VariantGroup } from "../../types/universal-gallery";
import { VariantGroupsView } from "./VariantGroupsView";

const image = {
  filename: "series_00001.png",
  relative_path: "series_00001.png",
  subfolder: "",
  url: "/image",
  original_url: "/image",
  thumb_url: "/thumb",
  size: 123,
  created_at: 100,
  favorite: false,
  pinned: false,
  boards: [],
  category: "",
  title: "",
  notes: "",
};

const group: VariantGroup = {
  id: "filename_series:demo",
  type: "filename_series",
  title: "series",
  count: 2,
  cover_image: image,
  latest_created_at: 100,
  confidence: 0.72,
  images_preview: [image, { ...image, filename: "series_00002.png", relative_path: "series_00002.png" }],
};

describe("VariantGroupsView", () => {
  it("renders variant groups and opens the selected group", async () => {
    const user = userEvent.setup();
    const onOpenGroup = vi.fn();
    render(
      <I18nProvider>
        <VariantGroupsView
          groups={[group]}
          selectedType=""
          status={{ total: 3, indexed: 2, pending: 1, failed: 0, last_error: "", version: "1" }}
          loading={false}
          error=""
          onTypeChange={vi.fn()}
          onRefresh={vi.fn()}
          onOpenGroup={onOpenGroup}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("变体整理")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /series/ }));
    expect(onOpenGroup).toHaveBeenCalledWith(group);
  });

  it("shows empty and loading states without throwing", () => {
    const { rerender } = render(
      <I18nProvider>
        <VariantGroupsView
          groups={[]}
          selectedType=""
          status={null}
          loading={false}
          error=""
          onTypeChange={vi.fn()}
          onRefresh={vi.fn()}
          onOpenGroup={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("还没有变体组")).toBeInTheDocument();

    rerender(
      <I18nProvider>
        <VariantGroupsView
          groups={[]}
          selectedType=""
          status={null}
          loading
          error=""
          onTypeChange={vi.fn()}
          onRefresh={vi.fn()}
          onOpenGroup={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getAllByText("正在分析变体...").length).toBeGreaterThan(0);
  });
});
