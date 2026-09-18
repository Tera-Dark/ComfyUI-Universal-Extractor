import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { GalleryFilterMenu } from "./GalleryFilterMenu";

function setup(){
  localStorage.setItem("universal-extractor-locale","en");
  const props={total:12,activeFilterControlCount:1,categories:[],selectedCategory:"",dateFrom:"",dateTo:"",favoritesOnly:true,selectedColorFamily:"",colorIndexStatus:null,sortBy:"filename",sortOrder:"asc",onClose:vi.fn(),onOpenCategoryPicker:vi.fn(),onCategoryChange:vi.fn(),onDateFromChange:vi.fn(),onDateToChange:vi.fn(),onFavoritesOnlyChange:vi.fn(),onColorFamilyChange:vi.fn(),onSortByChange:vi.fn(),onSortOrderChange:vi.fn(),onPageChange:vi.fn()};
  render(<I18nProvider><GalleryFilterMenu {...props}/></I18nProvider>);
  return props;
}
describe("filter and sort independence",()=>{
  it("clears filters without silently changing sorting",()=>{
    const props=setup();fireEvent.click(screen.getByRole("button",{name:"Clear filters"}));
    expect(props.onFavoritesOnlyChange).toHaveBeenCalledWith(false);
    expect(props.onPageChange).toHaveBeenCalledWith(1);
    expect(props.onSortByChange).not.toHaveBeenCalled();expect(props.onSortOrderChange).not.toHaveBeenCalled();
  });
  it("offers a separate explicit reset for sort order",()=>{
    const props=setup();fireEvent.click(screen.getByRole("button",{name:"Reset sorting"}));
    expect(props.onSortByChange).toHaveBeenCalledWith("created_at");
    expect(props.onSortOrderChange).toHaveBeenCalledWith("desc");
    expect(props.onFavoritesOnlyChange).not.toHaveBeenCalled();
  });
  it("focuses the dialog and dismisses with Escape",()=>{
    const props=setup();const dialog=screen.getByRole("dialog");expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog,{key:"Escape"});expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
