import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SafeReleaseNotes } from "./SafeReleaseNotes";

describe("release-note rendering", () => {
  it("renders useful Markdown without executing HTML, images or unsafe links", () => {
    const { container } = render(<SafeReleaseNotes body={'### Changes\n- `asset_id`\n- [Docs](https://example.com/docs)\n- [Unsafe](javascript:alert)\n<img src="https://example.com/track" onerror="alert(1)">\n![remote](https://example.com/image.png)'} />);
    expect(screen.getByRole("heading", { name: "Changes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
    expect(container.querySelector("img,script,iframe")).toBeNull();
    expect(container.querySelector("code")).toHaveTextContent("asset_id");
  });
});
