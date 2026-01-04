import React, { useState, useMemo, useEffect, Component, useDeferredValue } from 'react';
import { 
  Search, MapPin, ExternalLink, Plus, 
  Upload, Trash2, Edit2, X, Store, Heart, Save, 
  Loader2, Map as MapIcon, Grid, Database, 
  ChevronRight, Layers, ArrowDown, 
  Cloud, Copy, RefreshCcw, ShieldAlert, List,
  Filter, PieChart, Info, ImageIcon, Navigation, Bug, ChevronUp, ChevronDown, RotateCcw, Trash, Link as LinkIcon
} from 'lucide-react';

// Firebase SDK
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, doc, setDoc, onSnapshot, 
  deleteDoc, writeBatch 
} from 'firebase/firestore';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInAnonymously,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';

// ★ バージョン定義 (Gen_ プレフィックスを付与)
const VERSION = "Gen_v3.69-AUTO-SYNC-PRO";

// --- A. ErrorBoundary ---
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white p-8 font-mono flex flex-col items-center justify-center text-center text-xs">
          <ShieldAlert size={48} className="text-rose-500 mb-4" />
          <h1 className="text-lg font-black uppercase">System Error</h1>
          <p className="mt-2 text-rose-400 font-bold">{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} className="mt-6 px-6 py-3 bg-white text-slate-900 rounded-xl font-black uppercase shadow-2xl transition-all">Reload App</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- 0. 定数 ---
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

const getSubArea = (pref, address = "") => {
  if (!address) return "エリア";
  const match = address.match(/^(.*?[市郡区])/);
  return match ? match[1].replace(pref, "") : "主要";
};

// --- 1. Firebase 設定 ---
const getFirebaseConfig = () => {
  try {
    if (typeof __firebase_config !== 'undefined' && __firebase_config) {
      return { firebaseConfig: JSON.parse(__firebase_config), isEnvConfig: true };
    }
    const env = import.meta.env || {};
    if (env.VITE_FIREBASE_API_KEY) {
      return {
        firebaseConfig: {
          apiKey: env.VITE_FIREBASE_API_KEY,
          authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: env.VITE_FIREBASE_PROJECT_ID,
          storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: env.VITE_FIREBASE_APP_ID,
        },
        isEnvConfig: true
      };
    }
  } catch (e) { console.error("CONFIG_ERR", e); }
  return { firebaseConfig: null, isEnvConfig: false };
};

const { firebaseConfig, isEnvConfig } = getFirebaseConfig();
const appId = typeof __app_id !== 'undefined' ? __app_id : 'gourmet-master-v1';

let firebaseApp = null, auth = null, db = null;
if (isEnvConfig && firebaseConfig?.apiKey) {
  try {
    firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
  } catch (e) { console.error("INIT_FAIL", e); }
}

const canUseCloud = Boolean(auth && db);

// --- B. アプリケーション本体 ---
const GourmetApp = () => {
  const [data, setData] = useState([]);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('map');
  const [selectedPrefecture, setSelectedPrefecture] = useState('すべて');
  const [viewMode, setViewMode] = useState('detail');
  const [libLoaded, setLibLoaded] = useState(false);

  // パフォーマンス改善用: 入力ラグ防止
  const [searchTermInput, setSearchTermInput] = useState('');
  const searchTerm = useDeferredValue(searchTermInput);

  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [logs, setLogs] = useState([]);

  const addLog = (event, value = "-") => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [{ time, event, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }, ...prev].slice(0, 50));
  };

  // ★ 全員共有パブリックパス（全端末共通）
  const firestorePath = `artifacts/${appId}/public/data/stores`;

  // 自動匿名ログイン (起動時に自動実行)
  useEffect(() => {
    if (!canUseCloud) { setAuthChecked(true); return; }
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        setAuthChecked(true);
        addLog("AUTH_SUCCESS", u.uid.slice(0,5));
      } else {
        try {
          await setPersistence(auth, browserLocalPersistence);
          await signInAnonymously(auth);
        } catch (e) {
          addLog("AUTH_ERR", e.code);
          setAuthChecked(true);
        }
      }
    });
    return () => unsub();
  }, []);

  // リアルタイム購読 (データが更新されると自動で反映される)
  useEffect(() => {
    if (!user || !canUseCloud) return;
    setIsSyncing(true);
    addLog("SYNC_START");
    const q = collection(db, firestorePath);
    const unsub = onSnapshot(q, (snap) => {
      const stores = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setData(stores);
      setIsSyncing(false);
      addLog("DATA_LOADED", stores.length);
    }, (err) => { 
      setIsSyncing(false);
      addLog("SYNC_ERR", err.code);
    });
    return () => unsub();
  }, [user, firestorePath]);

  // 保存処理 (高速バッチ)
  const saveDataToCloud = async (storesToSave) => {
    const safeStores = Array.isArray(storesToSave) ? storesToSave.filter(Boolean) : [];
    if (canUseCloud && user) {
      setIsSyncing(true);
      try {
        const batch = writeBatch(db);
        safeStores.forEach(s => {
          const docId = s.id || `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_");
          const docRef = doc(db, firestorePath, docId);
          batch.set(docRef, { ...s, id: docId }, { merge: true });
        });
        await batch.commit();
        addLog("UPLOAD_OK");
      } catch (e) { addLog("SAVE_ERR", e.code); }
      setIsSyncing(false);
    }
  };

  const deleteData = async (id) => {
    if (!window.confirm("削除しますか？")) return;
    if (canUseCloud) {
      try { await deleteDoc(doc(db, firestorePath, id)); addLog("DEL_OK"); } catch(e) { addLog("DEL_ERR", e.code); }
    }
  };

  const toggleFavorite = async (store) => {
    if (canUseCloud) {
      await setDoc(doc(db, firestorePath, store.id), { isFavorite: !store.isFavorite }, { merge: true });
    }
  };

  // ファイルアップロード処理
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!window.XLSX) {
      alert("ライブラリを読み込み中です。もう一度試してください。");
      return;
    }

    addLog("FILE_READ_START", file.name);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const workbook = window.XLSX.read(e.target.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = window.XLSX.utils.sheet_to_json(sheet);
        
        if (jsonData.length === 0) {
          alert("エクセルの中にデータが見つかりませんでした。");
          return;
        }

        const normalized = jsonData.map((item, index) => {
          const name = item.店舗名 || item['店舗名'] || item['店名'] || item['Name'] || '店舗名不明';
          const addr = item.住所 || item['住所'] || item['Address'] || '';
          const pref = item.都道府県 || item['都道府県'] || item['Pref'] || 'その他';
          const itemId = `${name}-${addr}-${index}`.replace(/[.#$/[\]]/g, "_");
          return {
            id: itemId,
            NO: item.NO || (data.length + index + 1),
            店舗名: name,
            カテゴリ: item.カテゴリ || item['カテゴリ'] || item['ジャンル'] || '飲食店',
            都道府県: pref,
            住所: addr,
            URL: item.URL || item['URL'] || '',
            imageURL: item.imageURL || item['imageURL'] || '',
            isFavorite: false
          };
        });
        
        setData(normalized);
        setActiveTab('list');
        await saveDataToCloud(normalized);
        addLog("IMPORT_COMPLETE", normalized.length);
      } catch (err) { 
        alert("エクセルの解析に失敗しました。形式を確認してください。");
        addLog("PARSE_ERROR", err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };

  const filteredData = useMemo(() => {
    let res = data.filter(Boolean);
    if (activeTab === 'favorites') res = res.filter(d => d.isFavorite);
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      res = res.filter(d => (
        (d.店舗名 && d.店舗名.toLowerCase().includes(t)) || 
        (d.住所 && d.住所.toLowerCase().includes(t)) || 
        (d.カテゴリ && d.カテゴリ.toLowerCase().includes(t))
      ));
    }
    if (selectedPrefecture !== 'すべて') res = res.filter(d => d.都道府県 === selectedPrefecture);
    return res;
  }, [data, searchTerm, selectedPrefecture, activeTab]);

  const groupedData = useMemo(() => {
    const groups = {};
    filteredData.forEach(d => {
      const c = d.カテゴリ || '未分類';
      if (!groups[c]) groups[c] = [];
      groups[c].push(d);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filteredData]);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => { setLibLoaded(true); addLog("XLSX_LOADED"); };
    document.head.appendChild(script);
  }, []);

  if (!authChecked) {
    return <div className="min-h-screen bg-white flex flex-col items-center justify-center p-10 text-center">
      <Loader2 className="animate-spin text-orange-500 w-12 h-12 mb-4 mx-auto" />
      <h2 className="text-3xl font-black text-slate-800 tracking-tighter mb-1">{VERSION}</h2>
      <p className="font-bold text-slate-400 uppercase tracking-widest text-xs">Connecting to Cloud System...</p>
    </div>;
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-24 sm:pb-0 relative overflow-x-hidden">
      
      {/* 診断パネルボタン */}
      <button onClick={() => setIsDebugOpen(!isDebugOpen)} className="fixed bottom-6 right-6 z-[100] p-3 bg-slate-900 text-white rounded-full opacity-20 hover:opacity-100 shadow-xl transition-all">
        <Bug size={20} />
      </button>

      {isDebugOpen && (
        <div className="fixed bottom-0 right-0 z-[110] w-full sm:w-96 h-[40vh] bg-slate-900 text-[10px] text-slate-300 font-mono p-4 border-t border-white/20 overflow-y-auto shadow-2xl">
          <div className="flex justify-between items-center mb-2 border-b border-white/10 pb-1">
            <span className="text-orange-500 font-bold uppercase tracking-widest">System Monitor</span>
            <button onClick={() => setIsDebugOpen(false)}><X size={16}/></button>
          </div>
          {logs.map((l, i) => ( <div key={`log-${i}`} className="flex gap-2 border-b border-white/5 py-1.5"><span className="text-slate-600 shrink-0">{l.time}</span><span className="text-orange-400 font-bold shrink-0">{l.event}</span><span className="text-slate-400 break-all">{l.value}</span></div> ))}
        </div>
      )}

      {/* ヘッダー */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-xl border-b border-slate-200 h-16 md:h-20 flex items-center px-4 gap-3 shadow-sm">
        <div className="flex items-center gap-2 shrink-0 cursor-pointer" onClick={() => setActiveTab('map')}>
          <div className="bg-orange-500 p-2 rounded-xl text-white shadow-lg"><Store size={22} /></div>
          <h1 className="font-black text-xl tracking-tighter text-slate-800 uppercase italic hidden lg:block leading-none">Gourmet Master</h1>
        </div>
        
        <div className="flex-1 relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
          <input 
            type="text" 
            placeholder="店名や住所で検索..." 
            className="w-full pl-10 pr-3 py-2.5 bg-slate-100/80 border-none rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold" 
            value={searchTermInput} 
            onChange={(e) => setSearchTermInput(e.target.value)} 
          />
        </div>
        
        {/* 同期ステータスバッジ */}
        <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border shadow-inner shrink-0 min-w-[75px] justify-center ${canUseCloud ? 'bg-orange-50 border-orange-200' : 'bg-slate-100 border-slate-200'}`}>
          <Cloud size={14} className={canUseCloud ? 'text-orange-500' : 'text-slate-400'} />
          <span className={`text-[10px] font-black uppercase ${canUseCloud ? 'text-orange-700' : 'text-slate-500'}`}>
            {canUseCloud ? 'Cloud' : 'Offline'}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-2">
           <label className="p-2.5 bg-slate-900 text-white rounded-xl cursor-pointer hover:bg-slate-800 active:scale-95 transition-all shadow-lg">
             <Upload size={22} /><input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
           </label>
        </div>
      </header>

      {/* タブナビゲーション */}
      <nav className="bg-white border-b sticky top-16 md:top-20 z-40 flex overflow-x-auto scrollbar-hide px-2 shadow-sm">
        {[ { id: 'map', label: 'AREA', icon: <MapIcon size={18} /> }, { id: 'list', label: 'LIST', icon: <Grid size={18} /> }, { id: 'favorites', label: 'HEART', icon: <Heart size={18} /> }].map(tab => (
          <button key={`tab-${tab.id}`} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-8 py-5 text-[11px] font-black tracking-widest transition-all shrink-0 ${activeTab === tab.id ? 'text-orange-600 border-b-4 border-orange-600 bg-orange-50/30' : 'text-slate-400 hover:text-slate-600'}`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <main className="max-w-7xl mx-auto p-6 md:p-10 min-h-screen">
        {/* バージョン巨大表示 */}
        <div className="mb-16 text-center animate-in fade-in duration-1000">
           <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.6em] mb-3 leading-none">Automated Real-time Sync</p>
           <h2 className="text-6xl sm:text-9xl font-black text-slate-900 italic tracking-tighter leading-none mb-6">{VERSION}</h2>
           <div className={`inline-block px-8 py-2.5 rounded-full font-black text-[11px] uppercase tracking-widest shadow-xl ${canUseCloud ? 'bg-orange-500 text-white shadow-orange-200' : 'bg-slate-200 text-slate-500'}`}>
             {canUseCloud ? 'Shared Cloud: No Operation Required' : 'Isolated Local Storage'}
           </div>
           <div className="w-24 h-1.5 bg-orange-500 mx-auto mt-8 rounded-full shadow-lg" />
        </div>

        {data.length === 0 ? (
          <div className="max-w-4xl mx-auto py-24 text-center bg-white p-16 rounded-[4rem] shadow-2xl border border-slate-100 animate-in zoom-in duration-500">
              <Database className="mx-auto text-orange-500 mb-8 opacity-20" size={100} />
              <h2 className="text-4xl font-black mb-6 text-slate-800 tracking-tight italic uppercase">Wait for Sync</h2>
              <p className="text-slate-400 mb-12 font-bold max-w-sm mx-auto text-sm leading-relaxed">
                Windowsでエクセルを取り込んでください。<br/>
                取り込んだデータはこのiPhoneに自動で反映されます。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-lg mx-auto">
                <button onClick={() => saveDataToCloud([{NO:1,店舗名:"サンプル店",カテゴリ:"飲食店",都道府県:"東京都",住所:"銀座",isFavorite:true}])} className="py-6 bg-orange-500 text-white rounded-[2rem] font-black shadow-xl hover:bg-orange-600 transition-all active:scale-95 text-xl italic tracking-widest uppercase">Create Sample</button>
                <label className="py-6 border-2 border-slate-200 text-slate-600 rounded-[2rem] font-black cursor-pointer hover:bg-slate-50 transition-all text-xl flex items-center justify-center gap-3 italic tracking-widest uppercase shadow-sm">
                  <Upload size={24}/> Import Excel<input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
                </label>
              </div>
          </div>
        ) : (
          <div className="space-y-16 pb-40">
            {activeTab === 'map' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 animate-in fade-in duration-700">
                {Object.keys(regions).map(reg => {
                  const count = data.filter(d => (regions[reg] || []).includes(d.都道府県)).length;
                  return (
                    <button key={`region-${reg}`} onClick={() => { setSelectedPrefecture('すべて'); setActiveTab('list'); }} className="group bg-white rounded-[3rem] p-10 text-left border border-slate-100 shadow-sm hover:shadow-2xl transition-all flex flex-col justify-between min-h-[220px] relative overflow-hidden active:scale-95">
                      <div className="absolute -top-4 -right-4 p-8 opacity-5 group-hover:scale-125 transition-all rotate-12"><MapIcon size={120}/></div>
                      <div className="relative z-10"><p className="text-[11px] font-black text-slate-300 uppercase tracking-[0.4em] mb-2">{reg} Area</p><h3 className="text-4xl font-black text-slate-800 group-hover:text-orange-600 transition-colors uppercase tracking-tighter">{reg}</h3></div>
                      <div className="relative z-10 mt-8 flex items-center justify-between"><span className="text-sm font-black bg-slate-50 text-slate-400 px-6 py-2 rounded-full border border-slate-100 group-hover:bg-orange-50 group-hover:text-orange-600 transition-colors uppercase">{count} STORES</span><ChevronRight size={28} className="text-orange-500 -translate-x-4 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" /></div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col lg:flex-row gap-12 animate-in slide-in-from-bottom-10">
                <aside className="lg:w-80 shrink-0 hidden lg:block">
                   <div className="bg-white p-10 rounded-[4rem] border border-slate-200 shadow-xl shadow-slate-200/10 sticky top-48 space-y-10 max-h-[70vh] overflow-y-auto scrollbar-hide">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-3 border-b border-slate-50 pb-6 italic tracking-widest uppercase"><ArrowDown size={18} className="text-orange-500" /> Genre Jump</p>
                    {groupedData.map(([category, stores]) => (
                      <button key={`side-${category}`} onClick={() => { const el = document.getElementById(`category-section-${category}`); if(el) window.scrollTo({top: el.offsetTop - 120, behavior:'smooth'}); }} className="w-full px-6 py-5 bg-slate-50 text-left rounded-[2rem] text-xs font-black text-slate-600 hover:bg-orange-50 hover:text-orange-600 transition-all flex items-center justify-between group active:scale-95 shadow-sm border border-transparent hover:border-orange-100 uppercase tracking-widest">
                        <span className="truncate">{category}</span><span className="bg-white text-slate-900 px-3 py-1 rounded-xl shadow-sm font-black text-[10px]">{stores.length}</span>
                      </button>
                    ))}
                  </div>
                </aside>
                <div className="flex-1 space-y-24 min-w-0">
                  {groupedData.length === 0 ? <div className="bg-white p-32 rounded-[5rem] text-center text-slate-300 font-black italic shadow-inner text-2xl uppercase tracking-widest">No Items Found</div> : groupedData.map(([category, stores]) => (
                    <div key={`section-${category}`} id={`category-section-${category}`} className="space-y-12 scroll-mt-48 animate-in fade-in duration-1000">
                      <div className="flex items-center gap-8 px-4"><h3 className="text-3xl font-black text-slate-800 flex items-center gap-4 uppercase tracking-tighter italic"><Layers size={36} className="text-orange-500" /> {category}</h3><div className="flex-1 h-0.5 bg-slate-200/60"></div><span className="bg-orange-500 text-white px-8 py-2.5 rounded-full text-[11px] font-black shadow-lg tracking-[0.2em]">{stores.length} ITEMS</span></div>
                      <div className={viewMode === 'detail' ? "grid grid-cols-1 md:grid-cols-2 gap-12" : "space-y-6"}>
                        {stores.map(store => (
                          <div key={`card-${store.id}`} className="bg-white rounded-[4rem] shadow-sm border border-slate-100 hover:border-orange-200 hover:shadow-2xl transition-all duration-700 flex flex-col group relative">
                            <div className="relative h-72 overflow-hidden bg-slate-50 rounded-t-[4rem]">
                              <img src={store.imageURL && store.imageURL !== '' ? store.imageURL : `https://loremflickr.com/600/400/gourmet,food?lock=${(store.店舗名||'').length}`} alt={store.店舗名} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[2000ms]" />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/20 to-transparent opacity-90 group-hover:opacity-70 transition-opacity"></div>
                              <button onClick={() => toggleFavorite(store)} className={`absolute top-8 right-8 z-10 p-5 rounded-3xl backdrop-blur-md shadow-2xl transition-all active:scale-[1.8] ${store.isFavorite ? 'bg-rose-500 text-white shadow-rose-500/50' : 'bg-white/90 text-slate-300 hover:text-rose-500'}`}><Heart size={24} fill={store.isFavorite ? "currentColor" : "none"} /></button>
                              <div className="absolute bottom-8 left-10 right-10 text-white pointer-events-none space-y-1"><p className="text-[10px] font-black tracking-[0.3em] uppercase opacity-70 flex items-center gap-2"><MapPin size={12} className="text-orange-400" /> {store.都道府県} • {getSubArea(store.都道府県, store.住所)}</p><h4 className="text-2xl font-black truncate drop-shadow-2xl italic tracking-tight uppercase">{store.店舗名}</h4></div>
                            </div>
                            <div className="p-10 flex-1 flex flex-col justify-between gap-10">
                              <p className="line-clamp-2 leading-relaxed italic text-slate-500 font-bold text-sm">{store.住所 || "No address provided."}</p>
                              <div className="flex gap-4 pt-6 border-t border-slate-50">
                                {store.URL && store.URL !== 'Link' && (<a href={store.URL.startsWith('http') ? store.URL : `https://${store.URL}`} target="_blank" rel="noopener noreferrer" className="flex-1 py-5 bg-orange-50 text-orange-600 rounded-[1.5rem] hover:bg-orange-600 hover:text-white transition-all text-center text-[11px] font-black uppercase tracking-widest shadow-sm font-black">Visit Website</a>)}
                                <button onClick={() => deleteData(store.id)} className="p-5 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-white rounded-[1.5rem] transition-all shadow-inner"><Trash2 size={24}/></button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="w-full py-16 text-center text-[11px] font-black text-slate-300 uppercase tracking-[0.5em] bg-white border-t sm:hidden mb-4 px-10 leading-loose">
        VER {VERSION}<br/>
        PUBLIC CLOUD SYNCHRONIZATION ENABLED
      </footer>

      {/* モバイル用インポートボタン */}
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 sm:hidden z-40 flex items-center gap-4">
        <label className="bg-slate-900 text-white px-8 py-5 rounded-[2rem] font-black shadow-2xl active:scale-110 transition-all flex items-center gap-3 text-sm uppercase tracking-widest shadow-slate-400">
           <Upload size={20}/> Import Excel
           <input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
        </label>
      </div>
    </div>
  );
};

const App = () => (
  <ErrorBoundary>
    <GourmetApp />
  </ErrorBoundary>
);

export default App;