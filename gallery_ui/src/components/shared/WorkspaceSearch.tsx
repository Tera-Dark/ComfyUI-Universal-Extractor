import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { isEditableTarget } from "../../utils/interaction";

interface WorkspaceSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  tourId?: string;
}

/** Same quiet search surface as Gallery, including IME-safe input and shortcuts. */
export const WorkspaceSearch = ({ value, onChange, placeholder, clearLabel, tourId }: WorkspaceSearchProps) => {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  useEffect(() => { if (!composing.current) setDraft(value); }, [value]);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" || event.key === "/" && !isEditableTarget(event.target)) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);
  return <div className="ue-gallery-search-box ue-workspace-search" data-tour-id={tourId}>
    <Search size={14} className="ue-gallery-search-icon" />
    <input ref={input} className="ue-gallery-search-input" value={draft} placeholder={placeholder} aria-label={placeholder}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(event) => { composing.current = false; setDraft(event.currentTarget.value); onChange(event.currentTarget.value); }}
      onChange={(event) => {
        setDraft(event.target.value);
        if (!composing.current && !(event.nativeEvent as InputEvent).isComposing) onChange(event.target.value);
      }} />
    {draft ? <button className="ue-gallery-search-clear" type="button" aria-label={clearLabel} title={clearLabel}
      onClick={() => { setDraft(""); onChange(""); input.current?.focus(); }}><X size={13} /></button>
      : <span className="ue-gallery-search-shortcut" aria-hidden="true">/</span>}
  </div>;
};
