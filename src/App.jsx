import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, Filter, MapPin, Phone, ExternalLink, Plus, Download, 
  Upload, Trash2, Edit2, X, Store, Heart, Save, FileSpreadsheet, 
  FileText, Loader2, Map as MapIcon, Grid, Database, RefreshCw, 
  ChevronRight, PieChart, Info, Trash, Layers, ArrowDown, Layout, List, 
  ChevronDown, ChevronUp, Navigation, Image as ImageIcon, Star, Cloud, AlertCircle
} from 'lucide-react';

// Firebase SDK インポート
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, doc, setDoc, onSnapshot, 
  query, deleteDoc
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';

console.log("### UI-REFINE CHECK v3 (Firestore Path Fixed) ###");

// --- 0. 定数定義 ---
const PREF_ORDER = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県',
  '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'
];

const regions = {
  '北海道': ['北海道'],
  '東北': ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  '関東': ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
  '中部': ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'],
  '近畿': ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  '中国': ['鳥取県', '島根県', '岡山県', '広島県', '山口県'],
  '四国': ['徳島県', '香川県', '愛媛県', '高知県'],
  '九州・沖縄': ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']
};

const prefToRegion = (() => {
  const map = {};
  Object.entries(regions).forEach(([region, prefs]) => {
    prefs.forEach(p => map[p] = region);
  });
  return map;
})();

// --- 地域・詳細エリア判定ヘルパー ---
const getRegionFromPref = (pref) => {
  return prefToRegion[pref] || 'その他';
};

const getSubArea = (pref, address = "") => {
  if (!address) return "その他";
  if (pref === '東京都') {
    if (address.match(/千代田|中央|港|新宿|文京|台東|墨田|江東|品川|目黒|大田|世田谷|渋谷|中野|杉並|豊島|北|荒川|板橋|練馬|足立|葛飾|江戸川/)) return "23区内";
    if (address.match(/武蔵野|三鷹|調布|府中|小金井|国分寺|国立|町田|立川|八王子/)) return "多摩エリア";
    return "都下・その他";
  }
  if (pref === '神奈川県') {
    if (address.includes('横浜')) return "横浜エリア";
    if (address.includes('川崎')) return "川崎エリア";
    if (address.match(/藤沢|鎌倉|茅ヶ崎|平塚/)) return "湘南エリア";
    return "県央・その他";
  }
  if (pref === '大阪府') {
    if (address.includes('大阪市')) return "大阪市内";
    if (address.includes('堺')) return "堺エリア";
    return "北摂・東大阪";
  }
  const match = address.match(/^.*?[市郡区]/);
  return match ? match[0].replace(pref, "") : "主要エリア";
};

// --- 1. Firebase 設定取得ロジック ---
const getFirebaseConfig = () => {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    return JSON.parse(__firebase_config);
  }
  try {
    // Vite環境用 (es2015ターゲットでの警告回避)
    const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
    if (env.VITE_FIREBASE_API_KEY) {
      return {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.VITE_FIREBASE_APP_ID,
      };
    }
  } catch (e) {}
  
  return {
    apiKey: "AIzaSyB8hStIoRzu8U413HNJcsVINvwMc2coOjU",
    authDomain: "my-gourmet-app.firebaseapp.com",
    projectId: "my-gourmet-app",
    storageBucket: "my-gourmet-app.firebasestorage.app",
    messagingSenderId: "1081815311558",
    appId: "1:1081815311558:web:8b74a1b2a439c93e26e3c7",
  };
};

const config = getFirebaseConfig();
// MANDATORY RULE 1: アプリIDはFirestoreパスの一部として使用される
const appId = typeof __app_id !== 'undefined' ? __app_id : 'gourmet-master-v1';

let firebaseApp = null;
let auth = null;
let db = null;

if (config && config.apiKey) {
  firebaseApp = getApps().length === 0 ? initializeApp(config) : getApps()[0];
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
}

const App = () => {
  // --- 状態管理 ---
  const [data, setData] = useState([]);
  const [user, setUser] = useState(null);
  const [cloudMode, setCloudMode] = useState(!!config);
  const [authError, setAuthError] = useState(null);
  const [fsError, setFsError] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [libLoaded, setLibLoaded] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('全国');
  const [selectedPrefecture, setSelectedPrefecture] = useState('すべて');
  const [selectedSubArea, setSelectedSubArea] = useState('すべて');
  const [viewMode, setViewMode] = useState('detail'); 
  const [activeTab, setActiveTab] = useState('map'); 
  const [editingStore, setEditingStore] = useState(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  // --- 件数集計 ---
  const stats = useMemo(() => {
    const res = { regions: {}, prefs: {}, subAreas: {}, total: data.length };
    data.forEach(item => {
      const r = getRegionFromPref(item.都道府県);
      const p = item.都道府県;
      const s = getSubArea(p, item.住所);

      res.regions[r] = (res.regions[r] || 0) + 1;
      res.prefs[p] = (res.prefs[p] || 0) + 1;
      if (p === selectedPrefecture || selectedPrefecture === 'すべて') {
        res.subAreas[s] = (res.subAreas[s] || 0) + 1;
      }
    });
    return res;
  }, [data, selectedPrefecture]);

  // --- 2. XLSX (CDN) 動力読み込み ---
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => setLibLoaded(true);
    document.head.appendChild(script);
    return () => { if (document.head.contains(script)) document.head.removeChild(script); };
  }, []);

  // --- 3. 認証処理 ---
  useEffect(() => {
    if (!cloudMode || !auth) {
      setUser({ uid: 'local-user' });
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => { if (u) setUser(u); });
    const signIn = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        setCloudMode(false);
        setAuthError(`Cloud Mode Error: ${err.code}`);
        setUser({ uid: 'local-user' });
      }
    };
    signIn();
    return () => unsub();
  }, [cloudMode]);

  // --- 4. データ同期 (Cloud / Local) ---
  useEffect(() => {
    if (!user) return;
    if (cloudMode && db && user.uid !== 'local-user') {
      setIsSyncing(true);
      // MANDATORY RULE 1: /artifacts/{appId}/users/{userId}/{collectionName}
      const storesCol = collection(db, 'artifacts', appId, 'users', user.uid, 'stores');
      const unsubscribe = onSnapshot(storesCol, 
        (snapshot) => {
          setData(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          setFsError(null);
          setIsSyncing(false);
        }, 
        (err) => {
          console.error("Firestore Error:", err.code);
          setFsError(`Firestore Error: ${err.code}`);
          loadLocalData();
          setIsSyncing(false);
        }
      );
      return () => unsubscribe();
    } else {
      loadLocalData();
    }
  }, [user, cloudMode]);

  const loadLocalData = () => {
    const saved = localStorage.getItem('gourmetStores');
    if (saved) { try { setData(JSON.parse(saved)); } catch (e) {} }
  };

  const saveData = async (storesToSave) => {
    const newDataMap = new Map(data.map(item => [item.id, item]));
    storesToSave.forEach(store => {
      const docId = store.id || `${store.店舗名}-${store.住所}`.replace(/[.#$/[\]]/g, "_");
      const existing = newDataMap.get(docId);
      newDataMap.set(docId, { ...existing, ...store, id: docId });
    });
    const allData = Array.from(newDataMap.values());

    if (cloudMode && db && user && user.uid !== 'local-user') {
      setIsSyncing(true);
      try {
        for (const store of storesToSave) {
          const docId = store.id || `${store.店舗名}-${store.住所}`.replace(/[.#$/[\]]/g, "_");
          // MANDATORY RULE 1: Path must include /artifacts/{appId}/...
          const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'stores', docId);
          await setDoc(docRef, store, { merge: true });
        }
      } catch (e) {
        console.error("Save to Cloud failed:", e);
      }
      setIsSyncing(false);
    } else {
      setData(allData);
      localStorage.setItem('gourmetStores', JSON.stringify(allData));
    }
  };

  const deleteData = async (id) => {
    if (!window.confirm("この店舗を削除しますか？")) return;
    if (cloudMode && db && user && user.uid !== 'local-user') {
      try {
        // MANDATORY RULE 1
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'stores', id));
      } catch (e) { console.error(e); }
    } else {
      const filtered = data.filter(item => item.id !== id);
      setData(filtered);
      localStorage.setItem('gourmetStores', JSON.stringify(filtered));
    }
  };

  // --- フィルタリングロジック ---
  const filteredData = useMemo(() => {
    let result = data;
    if (activeTab === 'favorites') result = result.filter(item => item.isFavorite);
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      result = result.filter(item => 
        (item.店舗名 || '').toLowerCase().includes(t) || 
        (item.住所 || '').toLowerCase().includes(t) ||
        (item.カテゴリ || '').toLowerCase().includes(t)
      );
    }
    if (selectedRegion !== '全国') {
      result = result.filter(item => getRegionFromPref(item.都道府県) === selectedRegion);
    }
    if (selectedPrefecture !== 'すべて') {
      result = result.filter(item => item.都道府県 === selectedPrefecture);
    }
    if (selectedSubArea !== 'すべて') {
      result = result.filter(item => getSubArea(item.都道府県, item.住所) === selectedSubArea);
    }
    return result;
  }, [data, searchTerm, selectedRegion, selectedPrefecture, selectedSubArea, activeTab]);

  const groupedData = useMemo(() => {
    const groups = {};
    filteredData.forEach(item => {
      const cat = item.カテゴリ || '未分類';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filteredData]);

  // --- ハンドラ ---
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file || !window.XLSX) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workbook = window.XLSX.read(e.target.result, { type: 'array' });
        const jsonData = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const normalized = jsonData.map((item, index) => {
          const name = item.店舗名 || item['店舗名'] || '';
          const addr = item.住所 || item['住所'] || '';
          const pref = item.都道府県 || item['都道府県'] || '';
          const docId = `${name}-${addr}`.replace(/[.#$/[\]]/g, "_");
          return {
            id: docId,
            NO: item.NO || item['NO'] || (data.length + index + 1),
            店舗名: name,
            カテゴリ: item.カテゴリ || item['カテゴリ'] || '飲食店',
            都道府県: pref,
            住所: addr,
            URL: item.URL || item['URL'] || '',
            isFavorite: false
          };
        });
        saveData(normalized);
        setActiveTab('list');
      } catch (err) { alert("Excel 解析失敗"); }
    };
    reader.readAsArrayBuffer(file);
  };

  const getStoreImage = (store) => {
    if (store.imageURL) return store.imageURL;
    return `https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名 || '').length + ((store.カテゴリ || '').length || 0)}`;
  };

  const scrollToCategory = (id) => {
    const el = document.getElementById(`category-section-${id}`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 180, behavior: 'smooth' });
  };

  const toggleFavorite = async (store) => {
    if (cloudMode && db && user && user.uid !== 'local-user') {
      // MANDATORY RULE 1
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'stores', store.id);
      await setDoc(docRef, { isFavorite: !store.isFavorite }, { merge: true });
    } else {
      const updated = data.map(item => item.id === store.id ? { ...item, isFavorite: !item.isFavorite } : item);
      setData(updated);
      localStorage.setItem('gourmetStores', JSON.stringify(updated));
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <Loader2 className="animate-spin text-orange-500 w-12 h-12" />
        <p className="mt-4 font-black text-slate-400 uppercase tracking-tighter">Initializing...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-orange-100">
      
      {/* 1. STICKY HEADER & INTEGRATED FILTERS */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200 shadow-sm">
        <header className="max-w-7xl mx-auto px-4 h-16 md:h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0 cursor-pointer group" onClick={() => {setSelectedRegion('全国'); setSelectedPrefecture('すべて'); setSelectedSubArea('すべて'); setActiveTab('map');}}>
            <div className="bg-orange-500 p-2.5 rounded-2xl text-white shadow-lg shadow-orange-100 group-hover:scale-105 transition-transform"><Store size={22} /></div>
            <h1 className="font-black text-xl tracking-tighter text-slate-800 uppercase hidden md:block">Gourmet<span className="text-orange-500">Master</span></h1>
          </div>
          
          <div className="flex-1 max-w-xl relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-orange-500 transition-colors" size={18} />
            <input 
              type="text" 
              placeholder="店名、住所、メモを検索..." 
              className="w-full pl-11 pr-4 py-2.5 bg-slate-100/80 border-none rounded-2xl text-sm md:text-base outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold" 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)} 
            />
          </div>

          <div className="flex items-center gap-3">
             <div className={`p-2 rounded-full ${isSyncing ? 'text-orange-500 animate-spin' : 'text-slate-300'}`}>
               {cloudMode ? <Cloud size={20} /> : <Database size={20} />}
             </div>
             <label className="p-2.5 bg-slate-900 text-white rounded-2xl hover:bg-slate-800 cursor-pointer shadow-xl transition-all active:scale-95 hidden sm:flex">
               <Upload size={20} /><input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
             </label>
          </div>
        </header>

        {/* INTEGRATED FILTER BAR */}
        <div className="max-w-7xl mx-auto px-4 border-t border-slate-100 py-3 flex flex-col md:flex-row items-center justify-between gap-4">
          <nav className="flex items-center gap-1 w-full md:w-auto overflow-x-auto scrollbar-hide">
            {[
              { id: 'map', label: 'エリア', icon: <MapIcon size={16} /> },
              { id: 'list', label: 'リスト', icon: <Grid size={16} /> },
              { id: 'favorites', label: 'お気に入り', icon: <Heart size={16} /> }
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-black transition-all shrink-0 ${activeTab === tab.id ? 'bg-orange-50 text-orange-600 shadow-sm shadow-orange-100' : 'text-slate-400 hover:text-slate-600'}`}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </nav>

          {(activeTab === 'list' || activeTab === 'favorites') && (
            <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto scrollbar-hide">
              <select value={selectedRegion} onChange={(e) => { setSelectedRegion(e.target.value); setSelectedPrefecture('すべて'); setSelectedSubArea('すべて'); }} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black outline-none focus:ring-2 focus:ring-orange-500/20 shrink-0 cursor-pointer min-w-[100px]">
                <option value="全国">全国 ({stats.total})</option>
                {Object.entries(stats.regions).map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
              </select>
              
              <select value={selectedPrefecture} onChange={(e) => {setSelectedPrefecture(e.target.value); setSelectedSubArea('すべて');}} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black outline-none focus:ring-2 focus:ring-orange-500/20 shrink-0 cursor-pointer min-w-[100px]">
                <option value="すべて">都道府県</option>
                {PREF_ORDER.map(p => (stats.prefs[p] || 0) > 0 && <option key={p} value={p}>{p} ({stats.prefs[p]})</option>)}
              </select>

              <select value={selectedSubArea} onChange={(e) => setSelectedSubArea(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black outline-none focus:ring-2 focus:ring-orange-500/20 shrink-0 cursor-pointer min-w-[100px]">
                <option value="すべて">詳細地域</option>
                {Object.entries(stats.subAreas).map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
              </select>

              <div className="flex p-1 bg-slate-100 rounded-xl ml-2 shrink-0">
                <button onClick={() => setViewMode('detail')} className={`p-2 rounded-lg transition-all ${viewMode === 'detail' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400'}`}><Layout size={14}/></button>
                <button onClick={() => setViewMode('compact')} className={`p-2 rounded-lg transition-all ${viewMode === 'compact' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400'}`}><List size={14}/></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. MAIN CONTENT AREA */}
      <main className="max-w-7xl mx-auto p-4 md:p-8">
        {(authError || fsError) && (
          <div className="mb-6 bg-rose-50 border border-rose-100 text-rose-600 px-5 py-4 rounded-3xl flex items-center justify-between text-sm font-bold shadow-sm animate-in slide-in-from-top duration-300">
             <div className="flex items-center gap-3"><AlertCircle size={20} /><span>{authError || fsError}</span></div>
             <button onClick={() => { setAuthError(null); setFsError(null); }} className="hover:bg-rose-200/50 p-1 rounded-xl transition-colors"><X size={18}/></button>
          </div>
        )}

        {data.length === 0 ? (
          <div className="max-w-3xl mx-auto py-20 text-center bg-white p-12 md:p-24 rounded-[4rem] shadow-xl shadow-slate-200/40 border border-slate-100 animate-in fade-in zoom-in duration-700">
              <div className="bg-orange-50 w-28 h-28 rounded-[2.5rem] flex items-center justify-center mx-auto mb-10 rotate-6 group-hover:rotate-0 transition-transform">
                <Database className="text-orange-500 opacity-30" size={60} />
              </div>
              <h2 className="text-4xl font-black mb-6 text-slate-800 tracking-tight">美食リストをインポート</h2>
              <p className="text-slate-400 mb-12 font-bold max-w-sm mx-auto leading-relaxed">ExcelやCSVファイルを読み込むだけで、あなただけのグルメモリーが完成します。データは全デバイスで同期されます。</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
                <button 
                  onClick={() => saveData([{id:'sample-1',店舗名:"サンプル名店 銀座",住所:"東京都中央区銀座1-1-1",カテゴリ:"和食",都道府県:"東京都",isFavorite:true,NO:1}])} 
                  className="py-5 bg-orange-500 text-white rounded-[2rem] font-black shadow-xl shadow-orange-200 hover:bg-orange-600 hover:-translate-y-1 transition-all active:scale-95 text-lg"
                >
                  サンプル生成
                </button>
                <label className="py-5 border-2 border-slate-200 text-slate-600 rounded-[2rem] font-black cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-all text-lg text-center flex items-center justify-center gap-2">
                  ファイルを読込
                  <input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
                </label>
              </div>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="max-w-2xl mx-auto py-24 text-center bg-white p-12 rounded-[4rem] shadow-sm border border-slate-100 flex flex-col items-center animate-in fade-in duration-500">
            <div className="p-8 bg-slate-50 rounded-full mb-8"><Search size={64} className="text-slate-200" /></div>
            <h3 className="text-2xl font-black text-slate-800 mb-4">一致するお店が見つかりませんでした</h3>
            <p className="text-slate-400 font-bold mb-10">条件をリセットするか、新しい店舗を追加してみましょう。</p>
            <div className="flex gap-4">
              <button onClick={() => { setSelectedRegion('全国'); setSelectedPrefecture('すべて'); setSelectedSubArea('すべて'); setSearchTerm(''); }} className="px-10 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black hover:bg-slate-200 transition-all">検索をクリア</button>
              <button onClick={() => setIsAddingNew(true)} className="px-10 py-4 bg-orange-500 text-white rounded-2xl font-black shadow-lg shadow-orange-100 hover:bg-orange-600 transition-all">新規登録</button>
            </div>
          </div>
        ) : (
          <div className="space-y-16 animate-in fade-in duration-700">
            
            {activeTab === 'map' && (
              <div className="space-y-10">
                <h2 className="text-3xl md:text-4xl font-black text-slate-800 flex items-center gap-4 italic tracking-tighter uppercase">Explore<span className="text-orange-500">Areas</span></h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {Object.keys(regions).map(reg => {
                    const count = stats.regions[reg] || 0;
                    if (count === 0 && reg !== '関東') return null;
                    return (
                      <button key={reg} onClick={() => { setSelectedRegion(reg); setSelectedPrefecture('すべて'); setActiveTab('list'); }} className="group bg-white rounded-[2.5rem] p-8 text-left border border-slate-100 shadow-sm hover:shadow-2xl hover:border-orange-500 transition-all flex flex-col justify-between min-h-[190px] relative overflow-hidden active:scale-95">
                        <div className="absolute -top-4 -right-4 p-8 opacity-5 group-hover:opacity-10 group-hover:scale-125 transition-all rotate-12"><MapIcon size={120}/></div>
                        <div className="relative z-10">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-1">{reg} Area</p>
                          <h3 className="text-3xl font-black text-slate-800 group-hover:text-orange-600 transition-colors">{reg}</h3>
                        </div>
                        <div className="relative z-10 mt-6 flex items-center justify-between">
                          <span className="text-sm font-black bg-slate-50 text-slate-500 px-4 py-1.5 rounded-full border border-slate-100 group-hover:bg-orange-50 group-hover:text-orange-600 transition-colors">{count} 店の登録</span>
                          <ChevronRight size={24} className="text-orange-500 -translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {(activeTab === 'list' || activeTab === 'favorites') && (
              <div className="flex flex-col lg:flex-row gap-10">
                <aside className="lg:w-72 shrink-0 hidden lg:block space-y-8">
                   <div className="bg-white p-7 rounded-[3rem] border border-slate-200/60 shadow-sm sticky top-44 space-y-7">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><ArrowDown size={14} className="text-orange-500" /> ジャンル別</p>
                    <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto scrollbar-hide pr-1">
                      {groupedData.map(([category, stores]) => (
                        <button key={category} onClick={() => scrollToCategory(category)} className="w-full px-5 py-3.5 bg-slate-50 text-left rounded-2xl text-xs font-black text-slate-600 hover:bg-orange-50 hover:text-orange-600 transition-all flex items-center justify-between group border border-transparent hover:border-orange-100 active:scale-95">
                          <span className="truncate">{category}</span>
                          <span className="text-[10px] bg-white text-slate-900 px-2.5 py-0.5 rounded-lg font-black group-hover:bg-orange-100 shadow-sm">{stores.length}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </aside>

                <div className="flex-1 space-y-16">
                  {groupedData.map(([category, stores]) => (
                    <div key={category} id={`category-section-${category}`} className="space-y-8 scroll-mt-44 animate-in slide-in-from-bottom-4 duration-500">
                      <div className="flex items-center gap-5 px-2">
                        <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter"><Layers size={26} className="text-orange-500" /> {category}</h3>
                        <div className="flex-1 h-px bg-slate-200/60"></div>
                        <span className="bg-orange-500 text-white px-5 py-1.5 rounded-full text-[10px] font-black uppercase shadow-lg shadow-orange-100">{stores.length} 件</span>
                      </div>
                      
                      <div className={viewMode === 'detail' ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8" : "space-y-3"}>
                        {stores.map(store => {
                          const region = getRegionFromPref(store.都道府県);
                          const subArea = getSubArea(store.都道府県, store.住所);
                          
                          return viewMode === 'detail' ? (
                            <div key={store.id} className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200/50 overflow-hidden hover:shadow-2xl transition-all duration-500 flex flex-col group relative">
                              <div className="relative h-60 overflow-hidden bg-slate-100">
                                <img src={getStoreImage(store)} alt={store.店舗名} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" />
                                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent opacity-90 group-hover:opacity-60 transition-opacity"></div>
                                
                                <button onClick={() => toggleFavorite(store)} className={`absolute top-5 right-5 z-10 p-4 rounded-2xl backdrop-blur-md shadow-2xl transition-all active:scale-[1.5] ${store.isFavorite ? 'bg-rose-500 text-white' : 'bg-white/90 text-slate-300 hover:text-rose-500'}`}>
                                  <Heart size={20} fill={store.isFavorite ? "currentColor" : "none"} />
                                </button>
                                
                                <div className="absolute bottom-6 left-7 right-7 text-white pointer-events-none">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="px-2 py-0.5 bg-orange-500/80 rounded text-[9px] font-black tracking-widest">{region}</span>
                                    <span className="px-2 py-0.5 bg-white/20 backdrop-blur rounded text-[9px] font-black tracking-widest uppercase">#{store.NO}</span>
                                  </div>
                                  <h4 className="text-2xl font-black truncate drop-shadow-lg tracking-tight">{store.店舗名}</h4>
                                </div>
                              </div>

                              <div className="p-8 flex-1 flex flex-col">
                                <div className="space-y-4 text-sm flex-1 font-bold">
                                  <div className="flex items-start gap-4">
                                    <div className="bg-orange-50 p-2.5 rounded-xl text-orange-500 shrink-0 mt-0.5"><MapPin size={18} /></div>
                                    <div className="pt-0.5">
                                      <p className="text-orange-600 text-[10px] font-black uppercase mb-1">{store.都道府県} • {subArea}</p>
                                      <span className="line-clamp-2 leading-relaxed text-slate-600">{store.住所}</span>
                                    </div>
                                  </div>
                                  {store.URL && (
                                    <a href={store.URL.startsWith('http') ? store.URL : `https://${store.URL}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-4 bg-blue-50 text-blue-600 rounded-2xl hover:bg-blue-600 hover:text-white transition-all group/link font-black mt-2">
                                      <ExternalLink size={20} className="shrink-0 transition-transform group-hover/link:translate-x-1 group-hover/link:-translate-y-1"/>
                                      <span className="truncate text-sm">詳しく見る</span>
                                    </a>
                                  )}
                                </div>
                                <div className="mt-8 pt-6 border-t border-slate-50 flex gap-3 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                                  <button onClick={() => setEditingStore(store)} className="p-3.5 bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-2xl transition-all flex-1 flex items-center justify-center gap-2 text-xs font-black shadow-inner"><Edit2 size={16}/> 編集</button>
                                  <button onClick={() => deleteData(store.id)} className="p-3.5 bg-slate-50 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-2xl transition-all flex-1 flex items-center justify-center gap-2 text-xs font-black shadow-inner"><Trash2 size={16}/> 削除</button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div key={store.id} className="bg-white px-8 py-4 rounded-[2rem] border border-slate-200/60 shadow-sm hover:border-orange-500 hover:shadow-xl transition-all flex items-center justify-between group">
                              <div className="flex items-center gap-8 min-w-0">
                                <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0 font-black text-sm group-hover:bg-orange-50 group-hover:rotate-12 transition-all shadow-lg">#{store.NO}</div>
                                <div className="min-w-0">
                                  {store.URL ? (
                                    <a href={store.URL.startsWith('http') ? store.URL : `https://${store.URL}`} target="_blank" rel="noopener noreferrer" className="font-black text-slate-800 hover:text-orange-600 transition-colors truncate text-xl flex items-center gap-3">{store.店舗名} <ExternalLink size={16} className="text-slate-200 group-hover:text-orange-300"/></a>
                                  ) : (
                                    <h4 className="font-black text-slate-800 truncate text-xl">{store.店舗名}</h4>
                                  )}
                                  <div className="flex items-center gap-5 text-[10px] text-slate-400 font-black mt-2 uppercase tracking-[0.2em] leading-none">
                                    <span className="flex items-center gap-2">
                                      <MapPin size={12} className="text-orange-400"/> {region} | {store.都道府県} • {subArea}
                                    </span>
                                    <span className="bg-slate-100 px-3 py-1.5 rounded-xl text-slate-500 group-hover:bg-orange-50 group-hover:text-orange-500 transition-colors">{(store.カテゴリ || '未分類')}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button onClick={() => toggleFavorite(store)} className={`p-3.5 rounded-2xl transition-all active:scale-150 ${store.isFavorite ? 'text-rose-500 bg-rose-50' : 'text-slate-200 hover:text-rose-300 hover:bg-slate-50'}`}><Heart size={22} fill={store.isFavorite ? "currentColor" : "none"} /></button>
                                <button onClick={() => setEditingStore(store)} className="p-3.5 text-slate-200 hover:text-indigo-500 hover:bg-slate-50 rounded-2xl transition-colors"><Edit2 size={22}/></button>
                                <button onClick={() => deleteData(store.id)} className="p-3.5 text-slate-200 hover:text-rose-500 hover:bg-slate-50 rounded-2xl transition-colors"><Trash2 size={22}/></button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* 4. Editor Modal */}
      {(editingStore || isAddingNew) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-300 px-4">
          <form onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const updated = Object.fromEntries(fd.entries());
            await saveData([ { ...editingStore, ...updated } ]);
            setEditingStore(null); setIsAddingNew(false);
          }} className="bg-white w-full max-w-lg rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-white/20">
            <div className="px-10 py-8 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
              <h2 className="font-black text-2xl text-slate-800 tracking-tight flex items-center gap-3 italic underline decoration-orange-500 decoration-4 underline-offset-8">
                {editingStore ? 'RE-EDIT' : 'ADD NEW'}
              </h2>
              <button type="button" onClick={() => {setEditingStore(null); setIsAddingNew(false);}} className="p-2.5 text-slate-300 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"><X size={32} /></button>
            </div>
            <div className="p-10 space-y-8 overflow-y-auto scrollbar-hide">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Store Name</label>
                <input name="店舗名" defaultValue={editingStore?.店舗名} required className="w-full p-4.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-orange-500/10 focus:bg-white focus:border-orange-300 font-bold transition-all text-lg" placeholder="お店の名前" />
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Prefecture</label>
                  <input name="都道府県" defaultValue={editingStore?.都道府県} className="w-full p-4.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-orange-500/10 focus:bg-white focus:border-orange-300 font-bold transition-all" placeholder="例: 東京都" />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Category</label>
                  <input name="カテゴリ" defaultValue={editingStore?.カテゴリ} className="w-full p-4.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-orange-500/10 focus:bg-white focus:border-orange-300 font-bold transition-all" placeholder="例: ラーメン" />
                </div>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Address</label>
                <input name="住所" defaultValue={editingStore?.住所} className="w-full p-4.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-orange-500/10 focus:bg-white focus:border-orange-300 font-bold transition-all" placeholder="住所" />
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Website URL</label>
                <input name="URL" defaultValue={editingStore?.URL} placeholder="https://..." className="w-full p-4.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-orange-500/10 focus:bg-white focus:border-orange-300 font-bold transition-all text-blue-600" />
              </div>
            </div>
            <div className="p-10 bg-slate-50 flex gap-4 border-t sticky bottom-0 z-10">
              <button type="button" onClick={() => {setEditingStore(null); setIsAddingNew(false);}} className="flex-1 py-5 font-black text-slate-500 hover:text-slate-700 transition-colors text-sm tracking-widest">CANCEL</button>
              <button type="submit" className="flex-[2] py-5 bg-slate-900 text-white font-black rounded-[2rem] shadow-2xl hover:bg-slate-800 active:scale-95 transition-all text-sm tracking-widest flex items-center justify-center gap-3"><Save size={18}/> SAVE CHANGES</button>
            </div>
          </form>
        </div>
      )}
      
      {/* 5. Floating Action Button (Mobile) */}
      <button onClick={() => setIsAddingNew(true)} className="fixed bottom-10 right-8 w-20 h-20 bg-gradient-to-br from-orange-500 to-rose-500 text-white rounded-[2.2rem] shadow-2xl shadow-orange-200 flex items-center justify-center z-[60] active:scale-110 transition-all animate-in slide-in-from-bottom-10 duration-700 md:hidden hover:rotate-90">
        <Plus size={40} strokeWidth={3} />
      </button>

      {/* Mobile-only Upload FAB */}
      <label className="fixed bottom-36 right-10 w-14 h-14 bg-white/90 text-slate-800 border border-slate-200 rounded-2xl shadow-2xl flex items-center justify-center z-[60] active:scale-110 transition-all md:hidden backdrop-blur-lg">
        <Upload size={24} /><input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
      </label>
    </div>
  );
};

export default App;