import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { ImageRecord } from "../../types/universal-gallery";
import { loadDecodedImage } from "../../utils/imageLoading";
import { ImageDetailModal } from "./ImageDetailModal";

const {confirm}=vi.hoisted(()=>({confirm:vi.fn().mockResolvedValue(false)}));
vi.mock("../shared/ConfirmDialog",()=>({useConfirm:()=>({confirm})}));
vi.mock("../shared/ToastViewport",()=>({useToast:()=>({pushToast:vi.fn()})}));
vi.mock("../../utils/imageLoading",()=>({loadDecodedImage:vi.fn(),preferredScrollBehavior:()=>"instant"}));
vi.mock("../../services/galleryApi",()=>({galleryApi:{
  getImageMetadata:vi.fn().mockResolvedValue({filename:"a.png",state:{},metadata:{},workflow:null,artist_prompts:[],summary:{positive_prompt:"",negative_prompt:"",size:"",seed:null,steps:null,sampler:"",cfg:null,scheduler:"",denoise:null}}),
  listVariantGroups:vi.fn().mockResolvedValue({groups:[]}),prewarmFingerprints:vi.fn().mockResolvedValue({}),
}}));
const image=(name:string):ImageRecord=>({filename:`${name}.png`,relative_path:`${name}.png`,subfolder:"",url:`/${name}.png`,original_url:`/${name}.png`,thumb_url:`/${name}-thumb.png`,size:100,created_at:1,favorite:false,pinned:false,boards:[],category:"",title:"",notes:""});
function propsFor(photo=image("a")) {return {image:photo,navigation:null,onClose:vi.fn(),onSaveState:vi.fn(),onRenameFile:vi.fn(),onDeleteFile:vi.fn(),onOpenWorkflow:vi.fn(),onApplyLoraStack:vi.fn(),onNavigate:vi.fn()};}
beforeEach(()=>{
  vi.mocked(loadDecodedImage).mockReset();confirm.mockReset().mockResolvedValue(false);
  localStorage.setItem("universal-extractor-locale","en");
  HTMLElement.prototype.scrollIntoView=vi.fn();
});
describe("lightbox image handoff",()=>{
  it("keeps a preview until decoded and ignores a late response after navigation",async()=>{
    const pending:Array<{resolve:(ready:boolean)=>void;signal:AbortSignal}>=[];
    vi.mocked(loadDecodedImage).mockImplementation((_url,signal)=>new Promise(resolve=>pending.push({resolve,signal})));
    const props=propsFor();const wrap=(photo:ImageRecord)=><I18nProvider><ImageDetailModal {...props} image={photo}/></I18nProvider>;
    const {container,rerender}=render(wrap(image("a")));
    expect(container.querySelector(".ue-lightbox-media img")).toHaveAttribute("src","/a-thumb.png");
    rerender(wrap(image("b")));
    expect(pending[0].signal.aborted).toBe(true);
    await act(async()=>pending[1].resolve(true));
    expect(container.querySelector(".ue-lightbox-media img")).toHaveAttribute("src","/b.png");
    await act(async()=>pending[0].resolve(true));
    expect(container.querySelector(".ue-lightbox-media img")).toHaveAttribute("src","/b.png");
    expect(container.querySelector(".ue-lightbox-loading")).not.toBeInTheDocument();
  });
  it("shows a translated error and retries with a cache-busting URL",async()=>{
    vi.mocked(loadDecodedImage).mockResolvedValueOnce(false).mockResolvedValue(true);
    const {container}=render(<I18nProvider><ImageDetailModal {...propsFor()}/></I18nProvider>);
    fireEvent.click(await screen.findByRole("button",{name:"Retry image"}));
    await waitFor(()=>expect(container.querySelector(".ue-lightbox-media img")).toHaveAttribute("src","/a.png?_retry=1"));
  });
  it("never closes past an unsaved-change rejection",async()=>{
    vi.mocked(loadDecodedImage).mockResolvedValue(true);
    const props=propsFor();render(<I18nProvider><ImageDetailModal {...props}/></I18nProvider>);
    await waitFor(()=>expect(screen.queryByText("Loading image…")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button",{name:"Pin"}));
    fireEvent.click(screen.getByRole("button",{name:"Close detail"}));
    await waitFor(()=>expect(confirm).toHaveBeenCalled());expect(props.onClose).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button",{name:"Close detail"}));
    await waitFor(()=>expect(props.onClose).toHaveBeenCalledTimes(1));
  });
});
