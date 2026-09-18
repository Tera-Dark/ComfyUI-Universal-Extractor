import { useCallback, useEffect, useRef, useState } from "react";
import { Grid2X2, Minus, Plus, X } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import { FloatingLayerPortal, useDismissableLayer } from "../../utils/interaction";

interface Props { value: number; open: boolean; onToggle: () => void; onClose: () => void; onChange: (value: number) => void }
export function GalleryDensityControl({value, open, onToggle, onClose, onChange}: Props) {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({left:12, top:80});
  const close = useCallback(() => { onClose(); anchor.current?.focus({preventScroll:true}); }, [onClose]);
  useDismissableLayer(open, close);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const height = panel.current?.getBoundingClientRect().height || 290;
      const width = Math.min(320, window.innerWidth - 24);
      setPosition({left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top: rect.bottom + 8 + height < window.innerHeight - 12 ? rect.bottom + 8 : Math.max(12, rect.top - height - 8)});
    };
    measure();
    panel.current?.focus({preventScroll:true});
    const observer = new ResizeObserver(measure);
    if(panel.current) observer.observe(panel.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open]);
  return <div className="ue-density-control">
    <button ref={anchor} className={`ue-density-trigger ${open ? "is-open" : ""}`} type="button" data-tour-id="gallery-density"
      aria-expanded={open} aria-haspopup="dialog" aria-label={t("densityTitle")} title={t("densityTitle")}
      onClick={event => {event.stopPropagation(); onToggle();}}><Grid2X2 size={15}/><span>{t("densityShort")}</span></button>
    {open ? <FloatingLayerPortal><div ref={panel} role="dialog" tabIndex={-1} aria-label={t("densityTitle")} className="ue-density-panel" style={position}
      onClick={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation(); close();}}}>
      <header><div><strong>{t("densityTitle")}</strong><p>{t("densityHint")}</p></div><button type="button" onClick={close} aria-label={t("modalClose")}><X size={16}/></button></header>
      <div className="ue-density-presets" role="group" aria-label={t("densityPresets")}>
        {[{n:3,key:"densitySpacious",cells:6},{n:4,key:"densityBalanced",cells:8},{n:6,key:"densityCompact",cells:12}].map(({n,key,cells})=>
          <button key={n} type="button" aria-pressed={value===n} onClick={()=>onChange(n)}>
            <span className="ue-density-preview" aria-hidden="true" style={{gridTemplateColumns:`repeat(${n},1fr)`}}>{Array.from({length:cells},(_,i)=><i key={i}/>)}</span>
            <strong>{t(key)}</strong><small>{t("densityColumns",{count:n})}</small>
          </button>)}
      </div>
      <div className="ue-density-adjust">
        <button type="button" disabled={value<=3} onClick={()=>onChange(value-1)} aria-label={t("densityLarger")}><Minus size={16}/></button>
        <input type="range" min={3} max={8} step={1} value={value} aria-label={t("densityColumnsLabel")} aria-valuetext={t("densityColumns",{count:value})} onChange={event=>onChange(Number(event.target.value))}/>
        <button type="button" disabled={value>=8} onClick={()=>onChange(value+1)} aria-label={t("densitySmaller")}><Plus size={16}/></button>
        <output aria-live="polite">{value}</output>
      </div>
      <p className="ue-density-note">{t("densityResponsiveNote")}</p>
    </div></FloatingLayerPortal> : null}
  </div>;
}
