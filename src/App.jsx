import React, { useState, useMemo, useEffect, Component } from 'react';
import { 
  Search, MapPin, ExternalLink, Plus, 
  Upload, Trash2, Edit2, X, Store, Heart, Save, 
  Loader2, Map as MapIcon, Grid, Database, 
  ChevronRight, Layers, ArrowDown, 
  Cloud, Copy, RefreshCcw, ShieldAlert, List,
  Filter, PieChart, Info, ImageIcon, Navigation, Bug, ChevronUp, ChevronDown, RotateCcw, Trash, Key, Link as LinkIcon, Settings
} from 'lucide-react';

// Firebase SDK インポート
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, doc, setDoc, onSnapshot, 
  deleteDoc, writeBatch 
} from 'firebase/firestore';
import { 
  getAuth, 
  onAuthStateChanged, 
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  signInAnonymously,
  signOut
} from 'firebase/auth';

// ★ バージョン定義（画面最上部に大きく表示）
const VERSION = "v3.60-SYNC-REPAIR";

// --- A. ErrorBoundary ---
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white p-8 font-mono flex flex-col items-center justify-center text-center text-xs">
          <ShieldAlert size={48} className="text-rose-500 mb-4" />
          <h1 className="text-lg font-black uppercase tracking-tighter">Diagnostic Report</h1>
          <p className="mt-2 text-rose-400 font-bold">{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} className="mt-6 px-6 py-3 bg-white text-slate-900 rounded-xl font-black uppercase shadow-2xl active:scale-95 transition-all">Reload System</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- 1. Firebase 設定ハイブリッド ---
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
  } catch (e) { console.error("FIREBASE_INIT_CRASH", e); }
}

const canUseCloud = Boolean(auth && db);
const checkIsMobile = () => {
  const ua = navigator.userAgent;
  const isIPadOS = (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua));
  return /iPhone|iPod|Android/i.test(ua) || isIPadOS;
};

// --- B. アプリケーション本体 ---
const GourmetApp = () => {
  const [data, setData] = useState([]);
  const [user, setUser] = useState(null);
  const [cloudMode, setCloudMode] = useState(canUseCloud);
  const [authChecked, setAuthChecked] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('map');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPrefecture, setSelectedPrefecture] = useState('すべて');
  const [viewMode, setViewMode] = useState('detail');
  const [libLoaded, setLibLoaded] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0); 

  // --- 同期設定（共有キー） ---
  const [shareKey, setShareKey] = useState(() => (localStorage.getItem('gourmet_share_key') || '').trim());
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [logs, setLogs] = useState([]);

  const addLog = (event, value = "-") => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [{ time, event, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }, ...prev].slice(0, 50));
  };

  const isMobile = useMemo(() => checkIsMobile(), []);
  
  // パスの決定（共有キー最優先）
  const firestoreCollectionPath = useMemo(() => {
    if (!user) return null;
    if (shareKey.trim().length > 0) return `artifacts/${appId}/shared/${shareKey.trim()}/stores`;
    if (!user.isAnonymous) return `artifacts/${appId}/users/${user.uid}/stores`;
    return null;
  }, [shareKey, user]);

  useEffect(() => {
    localStorage.setItem('gourmet_share_key', shareKey.trim());
    addLog("PATH_UPDATE", firestoreCollectionPath || "Local");
    setSyncTrigger(prev => prev + 1);
  }, [shareKey, user, firestoreCollectionPath]);

  // 認証
  useEffect(() => {
    if (!cloudMode || !auth) {
      if (!cloudMode) setUser({ uid: 'local-user', isAnonymous: true });
      setAuthChecked(true);
      return;
    }
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) { setUser(u); setAuthChecked(true); } 
      else {
        try {
          const res = await signInAnonymously(auth);
          addLog("ANON_LOGIN", res.user.uid.slice(0,5));
        } catch (e) {
          addLog("ANON_FAIL", e.code);
          setAuthChecked(true);
        }
      }
    });
    return () => unsub();
  }, [cloudMode]);

  const startLogin = async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    try {
      await setPersistence(auth, browserLocalPersistence);
      if (isMobile) signInWithRedirect(auth, provider);
      else {
        const res = await signInWithPopup(auth, provider);
        if (res?.user) setUser(res.user);
      }
    } catch (err) { addLog("LOGIN_ERR", err.code); }
  };

  // Firestore 同期
  useEffect(() => {
    if (!user || !firestoreCollectionPath) { loadLocalData(); return; }
    setIsSyncing(true);
    const q = collection(db, firestoreCollectionPath);
    const unsub = onSnapshot(q, (snap) => {
      setData(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setIsSyncing(false);
      addLog("SYNC_OK", snap.docs.length);
    }, (err) => { 
      setIsSyncing(false); 
      loadLocalData(); 
    });
    return () => unsub();
  }, [user, firestoreCollectionPath, syncTrigger]);

  const loadLocalData = () => {
    const saved = localStorage.getItem('gourmetStores');
    if (saved) setData(JSON.parse(saved) || []);
    else setData([]);
  };

  const saveData = async (storesToSave) => {
    const safeStores = Array.isArray(storesToSave) ? storesToSave.filter(Boolean) : [];
    if (canUseCloud && firestoreCollectionPath) {
      setIsSyncing(true);
      try {
        const CHUNK = 400;
        for (let i = 0; i < safeStores.length; i += CHUNK) {
          const batch = writeBatch(db);
          safeStores.slice(i, i + CHUNK).forEach(s => {
            const docId = s.id || `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_");
            const docRef = doc(db, firestoreCollectionPath, docId);
            batch.set(docRef, { ...s, id: docId }, { merge: true });
          });
          await batch.commit();
        }
        addLog("CLOUD_SAVE_OK");
      } catch (e) { addLog("SAVE_ERR", e.code); }
      setIsSyncing(false);
    } else {
      const newDataMap = new Map(data.filter(Boolean).map(item => [item.id, item]));
      safeStores.forEach(s => {
        const docId = s.id || `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_");
        newDataMap.set(docId, { ...s, id: docId });
      });
      const allData = Array.from(newDataMap.values());
      setData(allData);
      localStorage.setItem('gourmetStores', JSON.stringify(allData));
    }
  };

  const deleteData = async (id) => {
    if (!window.confirm("この店舗を削除しますか？")) return;
    if (canUseCloud && firestoreCollectionPath) {
      try { await deleteDoc(doc(db, firestoreCollectionPath, id)); addLog("DEL_OK"); } catch(e) { addLog("DEL_ERR", e.code); }
    } else {
      const filtered = data.filter(d => d.id !== id);
      setData(filtered);
      localStorage.setItem('gourmetStores', JSON.stringify(filtered));
    }
  };

  const toggleFavorite = async (store) => {
    if (canUseCloud && firestoreCollectionPath) {
      await setDoc(doc(db, firestoreCollectionPath, store.id), { isFavorite: !store.isFavorite }, { merge: true });
    } else {
      const updated = data.map(d => d.id === store.id ? { ...d, isFavorite: !d.isFavorite } : d);
      setData(updated);
      localStorage.setItem('gourmetStores', JSON.stringify(updated));
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
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
          isFavorite: false
        }));
        saveData(normalized);
        setActiveTab('list');
      } catch (err) { alert("解析失敗"); }
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
    script.onload = () => setLibLoaded(true);
    document.head.appendChild(script);
  }, []);

  if (!authChecked) {
    return <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <Loader2 className="animate-spin text-orange-500 w-12 h-12 mb-4 mx-auto" />
      <h2 className="text-4xl font-black text-slate-800 tracking-tighter mb-2">{VERSION}</h2>
      <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Initializing...</p>
    </div>;
  }

  // --- UI Parts ---
  const SyncSettingsCard = () => (
    <div className="max-w-4xl mx-auto mb-12 bg-white rounded-[3rem] p-8 border border-slate-100 shadow-xl animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row items-center gap-8">
        <div className="flex-1 space-y-2">
          <h3 className="font-black text-xl flex items-center gap-3 italic"><Key className="text-orange-500" /> 同期設定 (Sync Settings)</h3>
          <p className="text-xs text-slate-400 font-bold">WindowsとiPhoneで同じ「合言葉」を入力してください。データがネットで繋がります。</p>
        </div>
        <div className="w-full md:w-96 flex flex-col gap-3">
          <div className="relative">
            <input 
              type="text" 
              value={shareKey} 
              onChange={(e) => setShareKey(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              placeholder="好きな合言葉を入力"
              className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-3xl outline-none focus:border-orange-500 transition-all font-black text-center text-xl shadow-inner"
            />
            {shareKey && <div className="absolute top-1/2 -right-3 -translate-y-1/2 bg-green-500 text-white p-1 rounded-full"><Save size={12}/></div>}
          </div>
          {shareKey && (
            <button onClick={() => { if(window.confirm("Windows側のリストをクラウド(合言葉)へ送信しますか？")) saveData(data); }} className="w-full py-4 bg-orange-600 text-white rounded-2xl font-black hover:bg-orange-700 transition-all text-xs shadow-lg flex items-center justify-center gap-2 uppercase tracking-tighter">
              <Upload size={16}/> Windowsのデータをクラウドへ送信
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-orange-100 relative overflow-x-hidden pb-20 sm:pb-0">
      
      {/* 診断パネルのトリガー (Bugアイコン) */}
      <button onClick={() => setIsDebugOpen(!isDebugOpen)} className="fixed bottom-4 right-4 z-[100] p-3 bg-slate-900 text-white rounded-full shadow-2xl opacity-50 hover:opacity-100 transition-all">
        <Bug size={20} />
      </button>

      {isDebugOpen && (
        <div className="fixed bottom-0 right-0 z-[110] w-full sm:w-96 h-[60vh] bg-slate-900 text-[9px] text-slate-300 font-mono p-4 border-t border-white/20 shadow-2xl overflow-y-auto scrollbar-hide">
          <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
            <span className="font-bold text-orange-500">SYSTEM LOG ({VERSION})</span>
            <button onClick={() => setIsDebugOpen(false)}><X size={16}/></button>
          </div>
          <div className="space-y-1">
             {logs.map((l, i) => ( <div key={i} className="flex gap-2 border-b border-white/5 pb-1"><span className="text-slate-600 shrink-0">{l.time}</span><span className="text-orange-400 font-black shrink-0">{l.event}</span><span className="text-slate-400 break-all">{l.value}</span></div> ))}
          </div>
        </div>
      )}

      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200 h-16 md:h-20 flex items-center px-4 gap-4">
        <div className="flex items-center gap-3 shrink-0 cursor-pointer" onClick={() => setActiveTab('map')}>
          <div className="bg-orange-500 p-2.5 rounded-2xl text-white shadow-lg"><Store size={22} /></div>
          <div className="hidden sm:block leading-tight">
            <h1 className="font-black text-xl tracking-tighter text-slate-800 uppercase italic">Gourmet Master</h1>
          </div>
        </div>
        
        <div className="flex-1 relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-orange-500 transition-colors" size={18} />
          <input type="text" placeholder="検索..." className="w-full pl-11 pr-4 py-2.5 bg-slate-100/80 border-none rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        
        <div className={`flex items-center gap-1 px-3 py-2 rounded-xl border shadow-inner shrink-0 ${firestoreCollectionPath ? 'bg-orange-50 border-orange-200' : 'bg-slate-100 border-slate-200'}`}>
          <Cloud size={14} className={firestoreCollectionPath ? 'text-orange-500' : 'text-slate-400'} />
          <span className={`text-[10px] font-black uppercase tracking-tighter ${firestoreCollectionPath ? 'text-orange-700' : 'text-slate-600'}`}>
            {firestoreCollectionPath ? 'Cloud' : 'Local'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
           <label className="p-2.5 bg-slate-900 text-white rounded-2xl hover:bg-slate-800 cursor-pointer shadow-xl transition-all active:scale-95 hidden sm:flex">
             <Upload size={20} /><input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
           </label>
           {(!user || user.isAnonymous) && (
             <button onClick={startLogin} className="p-2.5 bg-white border border-slate-200 text-slate-400 rounded-2xl hover:bg-slate-50 transition-all hidden sm:flex" title="Googleログイン"><LinkIcon size={20} /></button>
           )}
        </div>
      </header>

      <nav className="bg-white border-b sticky top-16 md:top-20 z-40 flex overflow-x-auto scrollbar-hide px-4 shadow-sm">
        {[ { id: 'map', label: 'AREA', icon: <MapIcon size={16} /> }, { id: 'list', label: 'LIST', icon: <Grid size={16} /> }, { id: 'favorites', label: 'HEART', icon: <Heart size={16} /> }].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-8 py-5 text-[10px] font-black tracking-widest transition-all shrink-0 ${activeTab === tab.id ? 'text-orange-600 border-b-4 border-orange-600' : 'text-slate-400 hover:text-slate-600'}`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8 min-h-screen">
        {/* バージョンとステータスを巨大表示 (Windows/iPhone両方で確認用) */}
        <div className="mb-12 text-center animate-in fade-in duration-1000">
           <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.5em] mb-2 leading-none">Authenticated Environment</p>
           <h2 className="text-6xl sm:text-9xl font-black text-slate-900 italic tracking-tighter leading-none mb-4">{VERSION}</h2>
           <div className="flex justify-center gap-3">
             <div className={`px-4 py-1.5 rounded-full font-black text-[10px] uppercase tracking-widest ${firestoreCollectionPath ? 'bg-orange-500 text-white shadow-lg shadow-orange-200' : 'bg-slate-200 text-slate-500'}`}>
               {firestoreCollectionPath ? 'Cloud Synchronized' : 'Local Standalone'}
             </div>
           </div>
        </div>

        {/* 同期設定欄を最上部に明示 */}
        <SyncSettingsCard />

        {data.length === 0 ? (
          <div className="max-w-4xl mx-auto py-16 text-center space-y-12">
              <div className="bg-white p-12 rounded-[4rem] shadow-xl border border-slate-100 animate-in zoom-in duration-500">
                <Database className="mx-auto text-orange-500 mb-6 opacity-20" size={80} />
                <h2 className="text-4xl font-black mb-4 text-slate-800 tracking-tight italic uppercase leading-none">Setup Sync</h2>
                <p className="text-slate-400 mb-10 font-bold max-w-sm mx-auto text-sm leading-relaxed">
                  共有キーを設定してクラウド同期を開始するか、Excelファイルを読み込んでください。
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
                  <button onClick={() => saveData([{NO:1,店舗名:"サンプル名店",カテゴリ:"和食",都道府県:"東京都",住所:"銀座",isFavorite:true}])} className="py-5 bg-orange-500 text-white rounded-3xl font-black shadow-xl hover:bg-orange-600 transition-all active:scale-95 text-lg italic tracking-widest uppercase">Sample</button>
                  <label className="py-5 border-2 border-slate-200 text-slate-600 rounded-3xl font-black cursor-pointer hover:bg-slate-50 transition-all text-lg flex items-center justify-center gap-2 italic tracking-widest uppercase">Import<input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} /></label>
                </div>
              </div>
          </div>
        ) : (
          <div className="space-y-16 animate-in fade-in duration-700 pb-32">
            {activeTab === 'map' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {Object.keys(regions).map(reg => {
                  const count = data.filter(Boolean).filter(d => (regions[reg] || []).includes(d.都道府県)).length;
                  return (
                    <button key={reg} onClick={() => { setSelectedPrefecture('すべて'); setActiveTab('list'); }} className="group bg-white rounded-[2.5rem] p-8 text-left border border-slate-100 shadow-sm hover:shadow-2xl transition-all flex flex-col justify-between min-h-[190px] relative overflow-hidden active:scale-95">
                      <div className="absolute -top-4 -right-4 p-8 opacity-5 group-hover:opacity-10 group-hover:scale-125 transition-all rotate-12"><MapIcon size={120}/></div>
                      <div className="relative z-10"><p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] mb-1">{reg} Area</p><h3 className="text-3xl font-black text-slate-800 group-hover:text-orange-600 transition-colors uppercase tracking-tighter">{reg}</h3></div>
                      <div className="relative z-10 mt-6 flex items-center justify-between"><span className="text-sm font-black bg-slate-50 text-slate-400 px-4 py-1.5 rounded-full border border-slate-100 group-hover:bg-orange-50 group-hover:text-orange-600 transition-colors uppercase">{count} STORES</span><ChevronRight size={24} className="text-orange-500 -translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" /></div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col lg:flex-row gap-10 animate-in slide-in-from-bottom-6">
                <aside className="lg:w-72 shrink-0 hidden lg:block">
                   <div className="bg-white p-7 rounded-[3rem] border border-slate-200 shadow-sm sticky top-44 space-y-7 max-h-[60vh] overflow-y-auto scrollbar-hide">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 border-b border-slate-50 pb-4 italic"><ArrowDown size={14} className="text-orange-500" /> Genre Jump</p>
                    {groupedData.map(([category, stores]) => (
                      <button key={category} onClick={() => { const el = document.getElementById(`category-section-${category}`); if(el) window.scrollTo({top: el.offsetTop - 120, behavior:'smooth'}); }} className="w-full px-5 py-4 bg-slate-50 text-left rounded-2xl text-[10px] font-black text-slate-600 hover:bg-orange-50 hover:text-orange-600 transition-all flex items-center justify-between group active:scale-95 shadow-sm">
                        <span className="truncate">{category}</span><span className="bg-white text-slate-900 px-2 py-0.5 rounded shadow-sm">{stores.length}</span>
                      </button>
                    ))}
                  </div>
                </aside>
                <div className="flex-1 space-y-20 min-w-0 pb-32">
                  {groupedData.length === 0 ? <div className="bg-white p-20 rounded-[3rem] text-center text-slate-300 font-black italic shadow-inner">見つかりませんでした</div> : groupedData.map(([category, stores]) => (
                    <div key={category} id={`category-section-${category}`} className="space-y-8 scroll-mt-44 animate-in slide-in-from-bottom-4">
                      <div className="flex items-center gap-5 px-2"><h3 className="text-2xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter italic"><Layers size={26} className="text-orange-500" /> {category}</h3><div className="flex-1 h-px bg-slate-200/60"></div><span className="bg-orange-500 text-white px-5 py-1.5 rounded-full text-[10px] font-black shadow-lg tracking-widest">{stores.length} ITEMS</span></div>
                      <div className={viewMode === 'detail' ? "grid grid-cols-1 md:grid-cols-2 gap-10" : "space-y-4"}>
                        {stores.map(store => (
                          <div key={store.id} className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200/50 overflow-hidden hover:shadow-2xl transition-all duration-500 flex flex-col group relative">
                            <div className="relative h-60 overflow-hidden bg-slate-100">
                              <img src={store.imageURL && store.imageURL !== '' ? store.imageURL : `https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名||'').length}`} alt={store.店舗名} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" onError={(e) => { if (e.currentTarget.dataset.fallback) return; e.currentTarget.dataset.fallback = "1"; e.currentTarget.src = `https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名||'').length}`; }} />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent opacity-90 group-hover:opacity-60 transition-opacity"></div>
                              <button onClick={() => toggleFavorite(store)} className={`absolute top-5 right-5 z-10 p-4 rounded-2xl backdrop-blur-md shadow-2xl transition-all active:scale-[1.5] ${store.isFavorite ? 'bg-rose-500 text-white shadow-lg' : 'bg-white/90 text-slate-300 hover:text-rose-500'}`}><Heart size={20} fill={store.isFavorite ? "currentColor" : "none"} /></button>
                              <div className="absolute bottom-6 left-7 right-7 text-white pointer-events-none space-y-1"><p className="text-[10px] font-black tracking-widest uppercase opacity-70 flex items-center gap-2"><MapPin size={12} className="text-orange-400" /> {store.都道府県} • {getSubArea(store.都道府県, store.住所)}</p><h4 className="text-2xl font-black truncate drop-shadow-lg tracking-tight uppercase italic">{store.店舗名}</h4></div>
                            </div>
                            <div className="p-8 flex-1 flex flex-col justify-between gap-6 font-bold text-sm text-slate-500">
                              <p className="line-clamp-2 leading-relaxed italic">{store.住所 || "住所情報なし"}</p>
                              <div className="flex gap-3 pt-4 border-t border-slate-50">
                                {store.URL && store.URL !== 'Link' && (<a href={store.URL.startsWith('http') ? store.URL : `https://${store.URL}`} target="_blank" rel="noopener noreferrer" className="flex-1 py-3 bg-orange-50 text-orange-600 rounded-xl hover:bg-orange-600 hover:text-white transition-all text-center text-[10px] font-black uppercase tracking-widest">Visit Website</a>)}
                                <button onClick={() => deleteData(store.id)} className="p-3 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-white rounded-xl transition-all shadow-inner"><Trash2 size={18}/></button>
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

      <footer className="w-full py-12 text-center text-[10px] font-black text-slate-300 uppercase tracking-[0.5em] bg-white border-t sm:hidden mb-4">
        VER {VERSION} | SYNC COMPLETED
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