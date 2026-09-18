import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { GalleryDensityControl } from "./GalleryDensityControl";

function Harness(){
  const [value,setValue]=useState(4), [open,setOpen]=useState(false);
  return <I18nProvider><button>Outside</button><GalleryDensityControl value={value} open={open} onToggle={()=>setOpen(!open)} onClose={()=>setOpen(false)} onChange={setValue}/></I18nProvider>;
}
describe("gallery density control",()=>{
  it("offers semantic presets, an exact range, and bounded fine adjustment",async()=>{
    const user=userEvent.setup();render(<Harness/>);
    await user.click(screen.getByRole("button",{name:"网格密度"}));
    expect(screen.getByRole("dialog")).toHaveFocus();
    await user.click(screen.getByRole("button",{name:/紧凑/}));
    expect(screen.getByRole("slider")).toHaveValue("6");
    fireEvent.change(screen.getByRole("slider"),{target:{value:"8"}});
    expect(screen.getByRole("slider")).toHaveValue("8");
    expect(screen.getByRole("button",{name:"缩小缩略图"})).toBeDisabled();
    await user.click(screen.getByRole("button",{name:/宽松/}));
    expect(screen.getByRole("slider")).toHaveValue("3");
    expect(screen.getByRole("button",{name:"放大缩略图"})).toBeDisabled();
  });
  it("dismisses with Escape and restores the trigger focus",async()=>{
    const user=userEvent.setup();render(<Harness/>);
    const trigger=screen.getByRole("button",{name:"网格密度"});
    await user.click(trigger);await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();expect(trigger).toHaveFocus();
  });
  it("follows scroll without closing, but dismisses outside clicks",async()=>{
    const user=userEvent.setup();render(<Harness/>);
    await user.click(screen.getByRole("button",{name:"网格密度"}));
    fireEvent.scroll(window);expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Outside"}));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
