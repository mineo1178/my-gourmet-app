import React, {
  useState, useMemo, useEffect, Component, useDeferredValue, useRef
} from 'react';
import {
  Search, MapPin,
  Upload, Trash2, X, Store, Heart,
  Loader2, Map as MapIcon, Grid, Database,
  ChevronRight, Layers, ArrowDown,
  Cloud, ShieldAlert, Bug
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

// ★ バージョン
const VERSION = "v3.65-PUBLIC-SYNC-FIX";

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
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-3 bg-white text-black rounded-xl font-bold uppercase"
          >
            Reset App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- 0. 定数 ---
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

// --- 1. Firebase ---
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
  } catch (e) { console.error(e); }
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
  } catch (e) { console.error(e); }
}

const canUseCloud = Boolean(auth && db);

// --- B. アプリ本体 ---
const GourmetApp = () => {
  const [data, setData] = useState([]);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const [activeTab, setActiveTab] = useState('map');
  const [selectedPrefecture, setSelectedPrefecture] = useState('すべて');
  const [viewMode, setViewMode] = useState('detail');
  const [libLoaded, setLibLoaded] = useState(false);

  // パフォーマンス改善
  const [searchTermInput, setSearchTermInput] = useState('');
  const searchTerm = useDeferredValue(searchTermInput);

  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [logs, setLogs] = useState([]);

  const signingInRef = useRef(false); // ★ 多重signIn防止

  const addLog = (event, value = "-") => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    setLogs(prev => [{ time, event, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }, ...prev].slice(0, 80));
  };

  // ★ パスは “セグメント指定” に統一（解釈揺れを0に）
  const storesColRef = useMemo(() => {
    if (!canUseCloud) return null;
    return collection(db, 'artifacts', appId, 'public', 'data', 'stores');
  }, []);

  const storesDocRef = (id) => doc(db, 'artifacts', appId, 'public', 'data', 'stores', id);

  // 起動時：匿名ログイン（確実化）
  useEffect(() => {
    if (!canUseCloud) {
      addLog("CLOUD_DISABLED");
      setAuthChecked(true);
      return;
    }

    addLog("APP_BOOT", window.location.origin);
    const unsub = onAuthStateChanged(auth, async (u) => {
      addLog("AUTH_STATE_CHANGED", u ? `uid=${u.uid.slice(0, 6)} anon=${u.isAnonymous}` : "null");

      if (u) {
        setUser(u);
        setAuthChecked(true);
        return;
      }

      // u が null の時だけ匿名ログイン。多重実行ガード。
      if (signingInRef.current) {
        addLog("SIGNIN_SKIP", "already running");
        return;
      }

      signingInRef.current = true;
      try {
        addLog("PERSISTENCE_SET", "start");
        await setPersistence(auth, browserLocalPersistence);
        addLog("PERSISTENCE_SET", "ok");

        addLog("SIGNIN_ANON", "start");
        const res = await signInAnonymously(auth);
        addLog("SIGNIN_ANON", `ok uid=${res.user.uid.slice(0, 6)}`);
        // userは次の onAuthStateChanged で入る
      } catch (e) {
        addLog("SIGNIN_ANON_ERR", e.code || e.message);
        setAuthChecked(true);
      } finally {
        signingInRef.current = false;
      }
    });

    return () => unsub();
  }, []);

  // Firestore 購読
  useEffect(() => {
    if (!canUseCloud || !user || !storesColRef) return;

    setIsSyncing(true);
    addLog("SUBSCRIBE_START", "artifacts/{appId}/public/data/stores");

    const unsub = onSnapshot(storesColRef, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setData(rows);
      setIsSyncing(false);
      addLog("SUBSCRIBE_SNAP", `${snap.docs.length} docs`);
    }, (err) => {
      setIsSyncing(false);
      addLog("SUBSCRIBE_ERR", err.code || err.message);
    });

    return () => unsub();
  }, [user?.uid]);

  // 400件ずつに分割（500制限回避）
  const saveData = async (storesToSave) => {
    const safeStores = Array.isArray(storesToSave) ? storesToSave.filter(Boolean) : [];
    if (!canUseCloud || !user || !storesColRef) return;

    setIsSyncing(true);
    addLog("SAVE_START", `${safeStores.length} items`);

    try {
      const CHUNK = 400;
      for (let i = 0; i < safeStores.length; i += CHUNK) {
        const batch = writeBatch(db);
        safeStores.slice(i, i + CHUNK).forEach(s => {
          const docId = s.id || `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_");
          batch.set(storesDocRef(docId), { ...s, id: docId }, { merge: true });
        });
        await batch.commit();
        addLog("SAVE_BATCH_OK", `${i}..${Math.min(i + CHUNK, safeStores.length) - 1}`);
      }
      addLog("SAVE_OK", "done");
    } catch (e) {
      addLog("SAVE_ERR", e.code || e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const deleteData = async (id) => {
    if (!window.confirm("削除しますか？")) return;
    if (!canUseCloud || !user) return;
    try {
      await deleteDoc(storesDocRef(id));
      addLog("DEL_OK", id);
    } catch (e) {
      addLog("DEL_ERR", e.code || e.message);
    }
  };

  const toggleFavorite = async (store) => {
    if (!canUseCloud || !user) return;
    try {
      await setDoc(storesDocRef(store.id), { isFavorite: !store.isFavorite }, { merge: true });
      addLog("FAV_TOGGLE", store.id);
    } catch (e) {
      addLog("FAV_ERR", e.code || e.message);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file || !window.XLSX) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workbook = window.XLSX.read(e.target.result, { type: 'array' });
        const jsonData = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const normalized = jsonData.map((item, index) => ({
          NO: item.NO || item['NO'] || (data.length + index + 1),
          店舗名: item.店舗名 || item['店舗名'] || '名称不明',
          カテゴリ: item.カテゴリ || item['カテゴリ'] || '飲食店',
          都道府県: item.都道府県 || item['都道府県'] || 'その他',
          住所: item.住所 || item['住所'] || '',
          URL: item.URL || item['URL'] || '',
          imageURL: item.imageURL || item['imageURL'] || '',
          isFavorite: Boolean(item.isFavorite || item['isFavorite'] || false)
        }));

        addLog("IMPORT_OK", `${normalized.length} rows`);
        saveData(normalized);
        setActiveTab('list');
      } catch (err) {
        addLog("IMPORT_ERR", err.message);
        alert("解析失敗");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const filteredData = useMemo(() => {
    let res = data.filter(Boolean);
    if (activeTab === 'favorites') res = res.filter(d => d.isFavorite);
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      res = res.filter(d => d.店舗名?.toLowerCase().includes(t) || d.住所?.toLowerCase().includes(t));
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
    script.onload = () => { setLibLoaded(true); addLog("XLSX_READY"); };
    document.head.appendChild(script);
  }, []);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
        <Loader2 className="animate-spin text-orange-500 w-12 h-12 mb-4" />
        <p className="font-black text-slate-400 uppercase tracking-widest text-[10px]">SYNCING SYSTEM...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-20 sm:pb-0">

      {/* 診断パネルボタン */}
      <button
        onClick={() => setIsDebugOpen(!isDebugOpen)}
        className="fixed bottom-4 right-4 z-[100] p-3 bg-slate-900 text-white rounded-full opacity-30 hover:opacity-100"
        title="System Log"
      >
        <Bug size={18} />
      </button>

      {isDebugOpen && (
        <div className="fixed bottom-0 right-0 z-[110] w-full sm:w-96 h-[45vh] bg-slate-900 text-[9px] text-slate-300 font-mono p-4 border-t border-white/20 overflow-y-auto">
          <div className="flex justify-between items-center mb-2 border-b border-white/10 pb-1">
            <span className="text-orange-500 font-bold">SYSTEM LOG ({VERSION})</span>
            <button onClick={() => setIsDebugOpen(false)}><X size={14} /></button>
          </div>
          <div className="text-[8px] text-slate-400 mb-2">
            MODE: PUBLIC (shared by everyone) / UID: {user?.uid ? user.uid.slice(0, 10) : "null"}
          </div>
          {logs.map((l, i) => (
            <div key={i} className="flex gap-2 border-b border-white/5 pb-1">
              <span className="text-slate-600 shrink-0">{l.time}</span>
              <span className="text-orange-400 font-bold shrink-0">{l.event}</span>
              <span className="text-slate-400 break-all">{l.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* ヘッダー */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-xl border-b border-slate-200 h-16 md:h-20 flex items-center px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 shrink-0 cursor-pointer" onClick={() => setActiveTab('map')}>
          <div className="bg-orange-500 p-2 rounded-xl text-white shadow-lg"><Store size={20} /></div>
          <h1 className="font-black text-lg tracking-tighter text-slate-800 uppercase italic hidden lg:block">Gourmet Master</h1>
        </div>

        <div className="flex-1 relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
          <input
            type="text"
            placeholder="店名検索..."
            className="w-full pl-9 pr-3 py-2.5 bg-slate-100/80 border-none rounded-xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold"
            value={searchTermInput}
            onChange={(e) => setSearchTermInput(e.target.value)}
          />
        </div>

        {/* 同期バッジ */}
        <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border shrink-0 ${canUseCloud ? 'bg-orange-50 border-orange-200' : 'bg-slate-100 border-slate-200'}`}>
          <Cloud size={14} className={isSyncing ? 'text-orange-500 animate-spin' : (canUseCloud ? 'text-orange-500' : 'text-slate-400')} />
          <span className={`text-[10px] font-black uppercase ${canUseCloud ? 'text-orange-700' : 'text-slate-500'}`}>
            {canUseCloud ? `Cloud ${data.length}` : 'Offline'}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-2">
          <label className="p-2.5 bg-slate-900 text-white rounded-xl cursor-pointer hover:bg-slate-800 active:scale-95 transition-all">
            <Upload size={20} /><input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      <nav className="bg-white border-b sticky top-16 md:top-20 z-40 flex overflow-x-auto scrollbar-hide px-2 shadow-sm">
        {[{ id: 'map', label: 'AREA', icon: <MapIcon size={16} /> }, { id: 'list', label: 'LIST', icon: <Grid size={16} /> }, { id: 'favorites', label: 'HEART', icon: <Heart size={16} /> }].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-6 py-5 text-[10px] font-black tracking-widest transition-all shrink-0 ${activeTab === tab.id ? 'text-orange-600 border-b-4 border-orange-600' : 'text-slate-400 hover:text-slate-600'}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8 min-h-screen">
        {/* バージョン巨大表示 */}
        <div className="mb-10 text-center">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.5em] mb-2 leading-none">Public Shared Database</p>
          <h2 className="text-5xl sm:text-7xl font-black text-slate-900 italic tracking-tighter leading-none mb-3">{VERSION}</h2>
          <div className="text-[11px] font-bold text-slate-400">
            全端末で同じデータを共有します（公開モード）
          </div>
        </div>

        {data.length === 0 ? (
          <div className="max-w-3xl mx-auto py-16 text-center bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100">
            <Database className="mx-auto text-orange-500 mb-6 opacity-20" size={80} />
            <h2 className="text-2xl font-black mb-3 text-slate-800 tracking-tight italic uppercase">No Shared Data</h2>
            <p className="text-sm text-slate-400 font-bold mb-8 leading-relaxed">
              Windowsでエクセルを取り込むと、iPhoneにも自動で現れます。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
              <button
                onClick={() => saveData([{ NO: 1, 店舗名: "サンプル名店", カテゴリ: "和食", 都道府県: "東京都", 住所: "銀座", isFavorite: true }])}
                className="py-5 bg-orange-500 text-white rounded-3xl font-black shadow-xl hover:bg-orange-600 transition-all text-lg italic tracking-widest"
              >
                SAMPLE
              </button>
              <label className="py-5 border-2 border-slate-200 text-slate-600 rounded-3xl font-black cursor-pointer hover:bg-slate-50 transition-all text-lg flex items-center justify-center gap-2 italic tracking-widest uppercase">
                IMPORT
                <input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-16 pb-32">
            {activeTab === 'map' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in duration-700">
                {Object.keys(regions).map(reg => {
                  const count = data.filter(Boolean).filter(d => (regions[reg] || []).includes(d.都道府県)).length;
                  return (
                    <button
                      key={reg}
                      onClick={() => { setSelectedPrefecture('すべて'); setActiveTab('list'); }}
                      className="group bg-white rounded-[2.5rem] p-8 text-left border border-slate-100 shadow-sm hover:shadow-2xl transition-all flex flex-col justify-between min-h-[200px] relative overflow-hidden active:scale-95"
                    >
                      <div className="absolute -top-4 -right-4 p-8 opacity-5 group-hover:scale-125 transition-all rotate-12"><MapIcon size={120} /></div>
                      <div className="relative z-10">
                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] mb-1">{reg} Area</p>
                        <h3 className="text-3xl font-black text-slate-800 group-hover:text-orange-600 transition-colors uppercase tracking-tighter">{reg}</h3>
                      </div>
                      <div className="relative z-10 mt-6 flex items-center justify-between">
                        <span className="text-sm font-black bg-slate-50 text-slate-400 px-4 py-1.5 rounded-full border border-slate-100 group-hover:bg-orange-50 group-hover:text-orange-600 transition-colors uppercase">
                          {count} STORES
                        </span>
                        <ChevronRight size={24} className="text-orange-500 -translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col lg:flex-row gap-10">
                <aside className="lg:w-72 shrink-0 hidden lg:block">
                  <div className="bg-white p-7 rounded-[3rem] border border-slate-200 shadow-sm sticky top-44 space-y-7 max-h-[65vh] overflow-y-auto scrollbar-hide">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 border-b border-slate-50 pb-4 italic">
                      <ArrowDown size={14} className="text-orange-500" /> Genre Jump
                    </p>
                    {groupedData.map(([category, stores]) => (
                      <button
                        key={category}
                        onClick={() => {
                          const el = document.getElementById(`category-section-${category}`);
                          if (el) window.scrollTo({ top: el.offsetTop - 120, behavior: 'smooth' });
                        }}
                        className="w-full px-5 py-4 bg-slate-50 text-left rounded-2xl text-[10px] font-black text-slate-600 hover:bg-orange-50 hover:text-orange-600 transition-all flex items-center justify-between group active:scale-95 shadow-sm border border-transparent hover:border-orange-100 uppercase tracking-widest"
                      >
                        <span className="truncate">{category}</span>
                        <span className="bg-white text-slate-900 px-2 py-0.5 rounded shadow-sm font-black text-[9px]">{stores.length}</span>
                      </button>
                    ))}
                  </div>
                </aside>

                <div className="flex-1 space-y-20 min-w-0 pb-32">
                  {groupedData.map(([category, stores]) => (
                    <div key={category} id={`category-section-${category}`} className="space-y-10 scroll-mt-44 animate-in fade-in duration-700">
                      <div className="flex items-center gap-6 px-4">
                        <h3 className="text-2xl sm:text-3xl font-black text-slate-800 flex items-center gap-4 uppercase tracking-tighter italic">
                          <Layers size={32} className="text-orange-500" /> {category}
                        </h3>
                        <div className="flex-1 h-px bg-slate-200/60"></div>
                        <span className="bg-orange-500 text-white px-6 py-2 rounded-full text-[10px] font-black shadow-lg tracking-widest">{stores.length} ITEMS</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        {stores.map(store => (
                          <div key={store.id} className="bg-white rounded-[3rem] shadow-sm border border-slate-200/50 overflow-hidden hover:shadow-2xl transition-all duration-500 flex flex-col group relative">
                            <div className="relative h-64 overflow-hidden bg-slate-100">
                              <img
                                src={store.imageURL && store.imageURL !== '' ? store.imageURL : `https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名 || '').length}`}
                                alt={store.店舗名}
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[2000ms]"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent opacity-90 group-hover:opacity-60 transition-opacity"></div>
                              <button
                                onClick={() => toggleFavorite(store)}
                                className={`absolute top-6 right-6 z-10 p-4 rounded-2xl backdrop-blur-md shadow-2xl transition-all active:scale-[1.8] ${store.isFavorite ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/50' : 'bg-white/90 text-slate-300 hover:text-rose-500'}`}
                                title="favorite"
                              >
                                <Heart size={20} fill={store.isFavorite ? "currentColor" : "none"} />
                              </button>
                              <div className="absolute bottom-6 left-8 right-8 text-white pointer-events-none space-y-1">
                                <p className="text-[10px] font-black tracking-widest uppercase opacity-70 flex items-center gap-2">
                                  <MapPin size={12} className="text-orange-400" /> {store.都道府県} • {getSubArea(store.都道府県, store.住所)}
                                </p>
                                <h4 className="text-2xl font-black truncate drop-shadow-lg tracking-tight uppercase italic">{store.店舗名}</h4>
                              </div>
                            </div>

                            <div className="p-10 flex-1 flex flex-col justify-between gap-8 font-bold text-sm text-slate-500">
                              <p className="line-clamp-2 leading-relaxed italic">{store.住所 || "No address provided."}</p>
                              <div className="flex gap-4 pt-4 border-t border-slate-50">
                                <button
                                  onClick={() => deleteData(store.id)}
                                  className="flex-1 py-4 bg-slate-50 text-slate-500 hover:text-red-600 hover:bg-white rounded-2xl transition-all shadow-inner font-black uppercase tracking-widest text-[10px]"
                                >
                                  Delete
                                </button>
                                <button
                                  onClick={() => saveData([store])}
                                  className="px-5 py-4 bg-orange-50 text-orange-700 hover:bg-orange-600 hover:text-white rounded-2xl transition-all shadow-sm font-black uppercase tracking-widest text-[10px]"
                                >
                                  Save
                                </button>
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

      <footer className="w-full py-10 text-center text-[10px] font-black text-slate-300 uppercase tracking-[0.5em] bg-white border-t sm:hidden mb-4 px-10">
        VER {VERSION} | ALL TERMINALS SYNCED<br />
        PUBLIC ACCESS MODE ENABLED
      </footer>
    </div>
  );
};

const App = () => (
  <ErrorBoundary>
    <GourmetApp />
  </ErrorBoundary>
);

export default App;
