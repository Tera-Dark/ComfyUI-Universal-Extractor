import type { ReactNode } from "react";

export const safeExternalHref = (href: string) => {
  try {
    const url = new URL(href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
};

const inline = (text: string): ReactNode[] => text.split(/(`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g).map((part, index) => {
  if (part.startsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
  const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
  if (link) {
    const href = safeExternalHref(link[2]);
    return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{link[1]}</a> : link[1];
  }
  return part;
});

/** React escapes all text. No HTML interpretation, image loading or plugins. */
export const SafeReleaseNotes = ({ body }: { body: string }) => {
  const lines = body.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => { if (list.length) blocks.push(<ul key={`list-${blocks.length}`}>{list}</ul>); list = []; };
  lines.forEach((line, index) => {
    if (/^\s*[-*] /.test(line)) { list.push(<li key={index}>{inline(line.replace(/^\s*[-*] /, ""))}</li>); return; }
    flush();
    if (/^#{1,6} /.test(line)) blocks.push(<h3 key={index}>{inline(line.replace(/^#{1,6} /, ""))}</h3>);
    else if (line.trim()) blocks.push(<p key={index}>{inline(line)}</p>);
  });
  flush();
  return <div className="ue-release-markdown">{blocks}</div>;
};
