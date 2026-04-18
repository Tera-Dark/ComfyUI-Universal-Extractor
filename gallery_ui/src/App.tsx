import { useEffect, useState, useCallback } from 'react';
import {
  Search, Image as ImageIcon, BookOpen, Heart, Home,
  Sliders, Hash, X, ChevronLeft, ChevronRight,
  Plus, Trash2, Edit3, Save, RefreshCw, Palette, ExternalLink
} from 'lucide-react';
import './App.css';

/* ─── Types ─── */
interface ImgData {
  filename: string;
  url: string;
  size: number;
  created_at: number;
}
interface ImgMeta {
  filename: string;
  metadata: Record<string, unknown>;
  artist_prompts: string[];
}
interface LibInfo {
  filename: string;
  count: number;
  size: number;
}
interface ArtistEntry {
  title: string;
  prompt: string;
  model?: string;
  tags?: string[];
  description?: string;
  [key: string]: unknown;
}

/* ─── Tabs ─── */
type SideTab = 'gallery' | 'library';

/* ════════════════════════════════════════════
 *  Main App
 * ════════════════════════════════════════════ */
function App() {
  /* --- gallery state --- */
  const [images, setImages] = useState<ImgData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedImg, setSelectedImg] = useState<ImgData | null>(null);
  const [imgMeta, setImgMeta] = useState<ImgMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const LIMIT = 60;

  /* --- library state --- */
  const [sideTab, setSideTab] = useState<SideTab>('gallery');
  const [libraries, setLibraries] = useState<LibInfo[]>([]);
  const [activeLib, setActiveLib] = useState<string | null>(null);
  const [libData, setLibData] = useState<ArtistEntry[]>([]);
  const [libEditing, setLibEditing] = useState(false);
  const [editJson, setEditJson] = useState('');
  const [newLibName, setNewLibName] = useState('');

  /* ─── fetch images ─── */
  const fetchImages = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (search) params.set('search', search);
    fetch(`/universal_gallery/api/images?${params}`)
      .then(r => r.json())
      .then(d => { setImages(d.images || []); setTotal(d.total || 0); })
      .catch(console.error);
  }, [page, search]);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  /* ─── fetch image metadata (for detail modal) ─── */
  const openDetail = (img: ImgData) => {
    setSelectedImg(img);
    setImgMeta(null);
    setMetaLoading(true);
    fetch(`/universal_gallery/api/metadata?filename=${encodeURIComponent(img.filename)}`)
      .then(r => r.json())
      .then(d => { setImgMeta(d); setMetaLoading(false); })
      .catch(() => setMetaLoading(false));
  };

  /* ─── library helpers ─── */
  const fetchLibraries = () => {
    fetch('/universal_gallery/api/libraries')
      .then(r => r.json())
      .then(d => setLibraries(d.libraries || []))
      .catch(console.error);
  };

  const fetchLibrary = (name: string) => {
    setActiveLib(name);
    fetch(`/universal_gallery/api/library?name=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(d => { setLibData(d.data || []); setLibEditing(false); })
      .catch(console.error);
  };

  const saveLibrary = () => {
    if (!activeLib) return;
    try {
      const parsed = JSON.parse(editJson);
      fetch('/universal_gallery/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: activeLib, data: parsed }),
      })
        .then(r => r.json())
        .then(() => { fetchLibrary(activeLib); fetchLibraries(); });
    } catch { alert('JSON format error!'); }
  };

  const createLibrary = () => {
    if (!newLibName.trim()) return;
    const name = newLibName.trim().endsWith('.json') ? newLibName.trim() : newLibName.trim() + '.json';
    fetch('/universal_gallery/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: [] }),
    })
      .then(r => r.json())
      .then(() => { setNewLibName(''); fetchLibraries(); fetchLibrary(name); });
  };

  const deleteLibrary = (name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    fetch(`/universal_gallery/api/library?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
      .then(() => { fetchLibraries(); if (activeLib === name) { setActiveLib(null); setLibData([]); } });
  };

  useEffect(() => { if (sideTab === 'library') fetchLibraries(); }, [sideTab]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  /* ═══════════ RENDER ═══════════ */
  return (
    <div className="ue-root">
      {/* ──── Sidebar ──── */}
      <aside className="ue-sidebar">
        <div className="ue-sidebar-brand">
          <span className="ue-brand-icon">&#x2728;</span>
          <span>Universal Extractor</span>
        </div>

        <nav className="ue-sidebar-nav">
          <button className={`ue-nav-btn ${sideTab === 'gallery' ? 'active' : ''}`}
                  onClick={() => setSideTab('gallery')}>
            <Home size={18} /><span>Output Gallery</span>
          </button>
          <button className={`ue-nav-btn ${sideTab === 'library' ? 'active' : ''}`}
                  onClick={() => setSideTab('library')}>
            <Palette size={18} /><span>Artist Library</span>
          </button>
        </nav>

        {sideTab === 'library' && (
          <div className="ue-lib-list">
            <div className="ue-lib-list-title">JSON Data Files</div>
            {libraries.map(lib => (
              <div key={lib.filename}
                   className={`ue-lib-item ${activeLib === lib.filename ? 'active' : ''}`}
                   onClick={() => fetchLibrary(lib.filename)}>
                <BookOpen size={14} />
                <span className="ue-lib-name">{lib.filename}</span>
                <span className="ue-lib-count">{lib.count}</span>
                <button className="ue-lib-del" onClick={(e) => { e.stopPropagation(); deleteLibrary(lib.filename); }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <div className="ue-lib-create">
              <input placeholder="new_library.json" value={newLibName}
                     onChange={e => setNewLibName(e.target.value)}
                     onKeyDown={e => e.key === 'Enter' && createLibrary()} />
              <button onClick={createLibrary}><Plus size={14} /></button>
            </div>
          </div>
        )}
      </aside>

      {/* ──── Main Area ──── */}
      <main className="ue-main">
        {/* Top Bar */}
        <header className="ue-topbar">
          <div className="ue-topbar-left">
            {sideTab === 'gallery' ? (
              <>
                <div className="ue-tab active"><ImageIcon size={15} /><span>Images</span></div>
                <div className="ue-tab" onClick={() => setSideTab('library')}><Hash size={15} /><span>Library</span></div>
              </>
            ) : (
              <>
                <div className="ue-tab" onClick={() => setSideTab('gallery')}><ImageIcon size={15} /><span>Images</span></div>
                <div className="ue-tab active"><Hash size={15} /><span>Library</span></div>
              </>
            )}
          </div>

          <div className="ue-topbar-right">
            {sideTab === 'gallery' && (
              <div className="ue-search-box">
                <Search size={15} />
                <input placeholder="Search images..."
                       value={search}
                       onChange={e => { setSearch(e.target.value); setPage(1); }} />
              </div>
            )}
            <button className="ue-icon-btn" onClick={fetchImages} title="Refresh"><RefreshCw size={16} /></button>
          </div>
        </header>

        {/* Content */}
        <div className="ue-content">
          {/* ========= GALLERY VIEW ========= */}
          {sideTab === 'gallery' && (
            <>
              <div className="ue-breadcrumb">
                <Home size={13} /><span>/</span>
                <span className="ue-breadcrumb-active">All Images</span>
                <span className="ue-breadcrumb-count">{total} items</span>
              </div>

              {images.length === 0 ? (
                <div className="ue-empty">
                  <ImageIcon size={52} />
                  <p>No images found</p>
                </div>
              ) : (
                <div className="ue-grid">
                  {images.map(img => (
                    <div key={img.filename} className="ue-card" onClick={() => openDetail(img)}>
                      <div className="ue-card-img">
                        <img src={img.url} alt={img.filename} loading="lazy" />
                        <div className="ue-card-overlay">
                          <button className="ue-card-action" title="View Details" onClick={e => { e.stopPropagation(); openDetail(img); }}>
                            <Sliders size={14} />
                          </button>
                          <button className="ue-card-action fav" title="Favorite">
                            <Heart size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="ue-card-info">
                        <p className="ue-card-name" title={img.filename}>{img.filename}</p>
                        <p className="ue-card-meta">
                          {(img.size / 1024).toFixed(0)} KB &bull; {new Date(img.created_at * 1000).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {total > LIMIT && (
                <div className="ue-pagination">
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16} /></button>
                  <span>{page} / {totalPages}</span>
                  <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={16} /></button>
                </div>
              )}
            </>
          )}

          {/* ========= LIBRARY VIEW ========= */}
          {sideTab === 'library' && (
            <div className="ue-library-view">
              {!activeLib ? (
                <div className="ue-empty">
                  <BookOpen size={52} />
                  <p>Select a library from the sidebar, or create a new one</p>
                </div>
              ) : (
                <>
                  <div className="ue-lib-header">
                    <h2>{activeLib}</h2>
                    <span className="ue-lib-badge">{libData.length} entries</span>
                    <div style={{ flex: 1 }} />
                    {!libEditing ? (
                      <button className="ue-btn" onClick={() => { setEditJson(JSON.stringify(libData, null, 2)); setLibEditing(true); }}>
                        <Edit3 size={14} /><span>Edit JSON</span>
                      </button>
                    ) : (
                      <>
                        <button className="ue-btn primary" onClick={saveLibrary}><Save size={14} /><span>Save</span></button>
                        <button className="ue-btn" onClick={() => setLibEditing(false)}><X size={14} /><span>Cancel</span></button>
                      </>
                    )}
                  </div>

                  {libEditing ? (
                    <textarea className="ue-json-editor" value={editJson} onChange={e => setEditJson(e.target.value)} />
                  ) : (
                    <div className="ue-artist-grid">
                      {libData.map((entry, i) => (
                        <div key={i} className="ue-artist-card">
                          <div className="ue-artist-title">{entry.title || entry.prompt || `#${i + 1}`}</div>
                          <div className="ue-artist-prompt">{entry.prompt}</div>
                          {entry.tags && entry.tags.length > 0 && (
                            <div className="ue-artist-tags">
                              {entry.tags.map((t, j) => <span key={j} className="ue-tag">{t}</span>)}
                            </div>
                          )}
                          {entry.model && <div className="ue-artist-model">{entry.model}</div>}
                          {entry.description && <div className="ue-artist-desc">{entry.description}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ──── Image Detail Modal ──── */}
      {selectedImg && (
        <div className="ue-modal-backdrop" onClick={() => setSelectedImg(null)}>
          <div className="ue-modal" onClick={e => e.stopPropagation()}>
            <button className="ue-modal-close" onClick={() => setSelectedImg(null)}><X size={20} /></button>

            <div className="ue-modal-body">
              {/* Image Preview */}
              <div className="ue-modal-preview">
                <img src={selectedImg.url} alt={selectedImg.filename} />
              </div>

              {/* Info Panel */}
              <div className="ue-modal-info">
                <h3>{selectedImg.filename}</h3>
                <div className="ue-modal-stats">
                  <span>{(selectedImg.size / 1024).toFixed(1)} KB</span>
                  <span>{new Date(selectedImg.created_at * 1000).toLocaleString()}</span>
                </div>

                {/* Open in new tab */}
                <a href={selectedImg.url} target="_blank" rel="noopener" className="ue-btn outline" style={{ marginBottom: 12 }}>
                  <ExternalLink size={14} /><span>Open Full Size</span>
                </a>

                {metaLoading && <div className="ue-loading">Loading metadata...</div>}

                {imgMeta && (
                  <>
                    {/* Artist prompts binding */}
                    {imgMeta.artist_prompts && imgMeta.artist_prompts.length > 0 && (
                      <div className="ue-meta-section">
                        <h4><Palette size={14} /> Artist Prompts Used</h4>
                        <div className="ue-artist-prompts-list">
                          {imgMeta.artist_prompts.map((ap, i) => (
                            <div key={i} className="ue-artist-prompt-item">{ap}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Raw prompt data */}
                    {imgMeta.metadata && Object.keys(imgMeta.metadata).length > 0 && (
                      <div className="ue-meta-section">
                        <h4><Sliders size={14} /> Generation Metadata</h4>
                        <pre className="ue-meta-raw">{JSON.stringify(imgMeta.metadata, null, 2)}</pre>
                      </div>
                    )}
                  </>
                )}

                {!metaLoading && imgMeta && !imgMeta.metadata && (
                  <div className="ue-meta-empty">No metadata embedded in this image.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
