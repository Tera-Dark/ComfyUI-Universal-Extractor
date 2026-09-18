import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDecodedImage, preferredScrollBehavior } from "./imageLoading";

class FakeImage {
  static instances:FakeImage[]=[];
  onload:(()=>Promise<void>)|null=null;
  onerror:(()=>void)|null=null;
  src="";
  decoding="";
  decode=vi.fn().mockResolvedValue(undefined);
  constructor(){FakeImage.instances.push(this);}
}
beforeEach(()=>{FakeImage.instances=[];vi.stubGlobal("Image",FakeImage);});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("decoded image handoff",()=>{
  it("does not report ready until decode completes",async()=>{
    let finishDecode!:()=>void;
    const pending=loadDecodedImage("/photo.png",new AbortController().signal);
    const image=FakeImage.instances[0];
    image.decode.mockImplementation(()=>new Promise<void>(resolve=>{finishDecode=resolve;}));
    const onload=image.onload!();
    let ready=false;void pending.then(()=>{ready=true;});
    await Promise.resolve();expect(ready).toBe(false);
    finishDecode();await onload;expect(await pending).toBe(true);
    expect(image.onload).toBeNull();
  });
  it("aborts stale navigation even when decoding finishes later",async()=>{
    let finishDecode!:()=>void;
    const controller=new AbortController();
    const pending=loadDecodedImage("/old.png",controller.signal);
    const image=FakeImage.instances[0];
    image.decode.mockImplementation(()=>new Promise<void>(resolve=>{finishDecode=resolve;}));
    const onload=image.onload!();controller.abort();
    expect(await pending).toBe(false);expect(image.src).toBe("");
    finishDecode();await onload;expect(await pending).toBe(false);
  });
  it("cleans failed requests so a fresh retry can succeed",async()=>{
    const failed=loadDecodedImage("/broken.png",new AbortController().signal);
    FakeImage.instances[0].onerror!();expect(await failed).toBe(false);
    const retry=loadDecodedImage("/broken.png?_retry=1",new AbortController().signal);
    await FakeImage.instances[1].onload!();expect(await retry).toBe(true);
  });
  it("times out rather than holding the previous image indefinitely",async()=>{
    vi.useFakeTimers();const pending=loadDecodedImage("/slow.png",new AbortController().signal,100);
    await vi.advanceTimersByTimeAsync(100);expect(await pending).toBe(false);
    expect(FakeImage.instances[0].onload).toBeNull();
  });
  it("does not issue already cancelled work",async()=>{
    const controller=new AbortController();controller.abort();
    expect(await loadDecodedImage("/cancelled.png",controller.signal)).toBe(false);
    expect(FakeImage.instances).toHaveLength(0);
  });
  it("uses an onload fallback when optional decode is unavailable",async()=>{
    const pending=loadDecodedImage("/valid.png",new AbortController().signal);
    FakeImage.instances[0].decode.mockRejectedValue(new Error("decode unsupported"));
    await FakeImage.instances[0].onload!();expect(await pending).toBe(true);
  });
  it("respects reduced motion for imperative scrolling",()=>{
    vi.stubGlobal("matchMedia",()=>({matches:true}));expect(preferredScrollBehavior()).toBe("instant");
    vi.stubGlobal("matchMedia",()=>({matches:false}));expect(preferredScrollBehavior()).toBe("smooth");
  });
});
