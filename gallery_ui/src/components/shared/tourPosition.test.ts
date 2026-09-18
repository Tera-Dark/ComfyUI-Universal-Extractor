import { describe, expect, it } from "vitest";
import { placeTourCard, tourCardMaxHeight, type TourRect } from "./tourPosition";

const overlap = (a:TourRect,b:TourRect) => Math.max(0, Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top));
describe("spotlight card geometry",()=>{
  it("centers a missing target without assuming a fixed card height",()=>{
    expect(placeTourCard(null,{width:352,height:300},{width:1440,height:960})).toEqual({left:544,top:330,side:"center"});
  });
  it.each([
    [1440,960,30,60,160,40,264],
    [390,844,220,200,72,45,260],
    [320,568,10,275,300,100,325],
    [320,568,8,318,296,112,256],
    [768,1024,8,318,296,112,264],
    [1440,960,1250,810,140,60,264],
  ])("stays in %ix%i without covering the target",(vw,vh,left,top,width,height,naturalHeight)=>{
    const target={left,top,width,height}, viewport={width:vw,height:vh};
    const card={width:Math.min(352,vw-24),height:Math.min(naturalHeight,tourCardMaxHeight(target,Math.min(352,vw-24),viewport))};
    const p=placeTourCard(target,card,viewport);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.left+card.width).toBeLessThanOrEqual(vw-12);
    expect(p.top+card.height).toBeLessThanOrEqual(vh-12);
    expect(overlap({...p,...card},target)).toBe(0);
  });
});
