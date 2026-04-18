import { useEffect, useState } from 'react';
import { Search, Image, BookOpen, Settings, Bell, Heart, Home, Sliders, Hash } from 'lucide-react';

interface ImgData {
  filename: string;
  url: string;
  size: number;
  created_at: number;
}

function App() {
  const [images, setImages] = useState<ImgData[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/universal_gallery/api/images')
      .then(res => res.json())
      .then(data => {
        if (data.images) {
          setImages(data.images);
        }
      })
      .catch(err => console.error("API Error", err));
  }, []);

  const filtered = images.filter(img => img.filename.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex h-screen w-full bg-[#f3f4f6]">
      {/* Sidebar */}
      <div className="w-56 bg-white border-r border-gray-200 flex flex-col items-center py-4 px-2 space-y-4">
        <div className="font-bold text-gray-800 text-lg w-full px-2 mb-2">ComfyUI 灵感库</div>
        <button className="flex items-center space-x-2 text-blue-600 bg-blue-50 w-full px-4 py-2 rounded-lg font-medium">
          <Home size={18} />
          <span>图库根目录</span>
        </button>
        <button className="flex items-center space-x-2 text-gray-600 hover:bg-gray-50 w-full px-4 py-2 rounded-lg font-medium">
          <Sliders size={18} />
          <span>生成参数</span>
        </button>
        <button className="flex items-center space-x-2 text-gray-600 hover:bg-gray-50 w-full px-4 py-2 rounded-lg font-medium">
          <BookOpen size={18} />
          <span>书签 & 收藏</span>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Navbar */}
        <div className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg cursor-pointer">
              <Image size={16} />
              <span className="text-sm font-medium">万能库图片</span>
            </div>
            <div className="flex items-center space-x-2 text-gray-600 cursor-pointer hover:text-gray-900 transition">
              <Hash size={16} />
              <span className="text-sm font-medium">抽签统计</span>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input 
                type="text" 
                placeholder="搜索图像或参数..." 
                className="pl-10 pr-4 py-1.5 bg-gray-100 border-none rounded-full text-sm outline-none w-64 focus:ring-2 focus:ring-blue-100 transition-all"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Settings size={18} className="text-gray-500 cursor-pointer hover:text-gray-800" />
            <Bell size={18} className="text-gray-500 cursor-pointer hover:text-gray-800" />
            <Heart size={18} className="text-gray-500 cursor-pointer hover:text-gray-800" />
          </div>
        </div>

        {/* Gallery Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center mb-6 text-sm text-gray-500 space-x-2">
            <Home size={14} />
            <span>/</span>
            <span className="text-blue-500 cursor-pointer bg-blue-50 px-2 py-0.5 rounded">All Images</span>
            <span>({filtered.length} items)</span>
          </div>
          
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Image size={48} className="mb-4 opacity-50" />
              <p>暂无图片或未找到匹配内容</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {filtered.map(img => (
                <div key={img.filename} className="group relative bg-white rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden cursor-pointer hover:-translate-y-1 border border-gray-100">
                  <div className="aspect-square bg-gray-100 relative overflow-hidden">
                    <img 
                      src={img.url} 
                      alt={img.filename} 
                      className="w-full h-full object-cover origin-center transition-transform duration-500 group-hover:scale-110"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300"></div>
                  </div>
                  <div className="p-3">
                    <p className="text-xs font-semibold text-gray-800 truncate" title={img.filename}>
                      {img.filename}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {(img.size / 1024).toFixed(1)} KB • {new Date(img.created_at * 1000).toLocaleDateString()}
                    </p>
                  </div>
                  
                  {/* Hover Overlay Buttons */}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-2">
                    <button className="bg-white/90 backdrop-blur text-gray-700 p-1.5 rounded-full shadow hover:text-blue-500" title="查看参数">
                      <Sliders size={14} />
                    </button>
                    <button className="bg-white/90 backdrop-blur text-gray-700 p-1.5 rounded-full shadow hover:text-red-500" title="收藏">
                      <Heart size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
