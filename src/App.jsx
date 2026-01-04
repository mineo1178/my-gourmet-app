import React, { useState, useMemo, useEffect, Component, useDeferredValue } from 'react';
import { 
  Search, MapPin, ExternalLink, Plus, 
  Upload, Trash2, Edit2, X, Store, Heart, Save, 
  Loader2, Map as MapIcon, Grid, Database, 
  ChevronRight, Layers, ArrowDown, 
  Cloud, Copy, RefreshCcw, ShieldAlert, List,
  Filter, PieChart, Info, ImageIcon, Navigation, Bug, ChevronUp, ChevronDown, RotateCcw, Trash, Link as LinkIcon, Terminal, Activity, Wifi, WifiOff, AlertTriangle, ShieldCheck
} from 'lucide-react';

// Firebase SDK
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, doc, setDoc, onSnapshot, 
  deleteDoc, writeBatch, query 
} from 'firebase/firestore';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInAnonymously,
  signInWithCustomToken,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';

// ★ バージョン定義
const VERSION = "Gen_v3.82-BOOT-RECOVERY";

// --- A. ErrorBoundary ---
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-white p-8 font-mono flex flex-col items-center justify-center text-center">
          <ShieldAlert size={64} className="text-rose-500 mb-6" />
          <h1 className="text-2xl font-black uppercase mb-2 text-rose-500">Kernel Panic</h1>
          <div className="bg-black/50 p-6 rounded-2xl border border-rose-500/30 max-w-lg mb-8 text-left">
            <p className="text-rose-400 font-bold text-sm">Error detail: {this.state.error?.message}</p>
          </div>
          <button onClick={() => window.location.reload()} className="px-10 py-4 bg-white text-black rounded-2xl font-black uppercase">Reboot System</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- 0. 定数 ---
const regions = {
  '北海道': ['北海道'], '東北': ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  '関東': ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
  '中部': ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'],
  '近畿': ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  '中国': ['鳥取県', '島根県', '岡山県', '広島県', '山口県'], '四国': ['徳島県', '香川県', '愛媛県', '高知県'],
  '九州・沖縄': ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']
};

const getSubArea = (pref, address = "") => {
  if (!address) return "主要エリア";
  const match = address.match(/^(.*?[市郡区])/);
  return match ? match[1].replace(pref, "") : "主要";
};

// --- B. アプリケーション本体 ---
const GourmetApp = () => {
  const [data, setData] = useState([]);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('map');
  const [selectedPrefecture, setSelectedPrefecture] = useState('すべて');
  const [logs, setLogs] = useState([]);
  const [libLoaded, setLibLoaded] = useState(false);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  
  // Firebase 関連の動的ステート
  const [firebaseInstance, setFirebaseInstance] = useState({ auth: null, db: null, appId: 'gourmet-master-v1' });
  const [configStatus, setConfigStatus] = useState('WAITING');

  const [searchTermInput, setSearchTermInput] = useState('');
  const searchTerm = useDeferredValue(searchTermInput);

  const addLog = (event, value = "-") => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [{ time, event, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }, ...prev].slice(0, 30));
  };

  // --- Step 1: Firebase エンジンの動的起動 (Configuration Handling) ---
  useEffect(() => {
    const bootFirebase = () => {
      try {
        addLog("BOOT_INIT", "Looking for __firebase_config...");
        
        let config = null;
        if (typeof __firebase_config !== 'undefined' && __firebase_config) {
          config = typeof __firebase_config === 'string' ? JSON.parse(__firebase_config) : __firebase_config;
        }

        if (!config || !config.apiKey) {
          addLog("BOOT_WAIT", "Config not provided yet by environment.");
          setConfigStatus('WAITING');
          // まだ設定が届いていない場合は 3秒後に再試行
          setTimeout(bootFirebase, 3000);
          return;
        }

        addLog("BOOT_READY", "Config received. Initializing SDK...");
        const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
        const _auth = getAuth(app);
        const _db = getFirestore(app);
        const _appId = typeof __app_id !== 'undefined' ? __app_id : 'gourmet-master-v1';

        setFirebaseInstance({ auth: _auth, db: _db, appId: _appId });
        setConfigStatus('READY');
        addLog("BOOT_SUCCESS", "Cloud Engine Online");
      } catch (e) {
        addLog("BOOT_ERROR", e.message);
        setConfigStatus('ERROR');
        setAuthChecked(true);
      }
    };

    bootFirebase();
  }, []);

  // --- Step 2: 認証シーケンス (READYになってから実行) ---
  useEffect(() => {
    if (configStatus !== 'READY' || !firebaseInstance.auth) return;

    const runAuth = async () => {
      try {
        addLog("AUTH_START", "Establishing secure session...");
        await setPersistence(firebaseInstance.auth, browserLocalPersistence);
        
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(firebaseInstance.auth, __initial_auth_token);
        } else {
          await signInAnonymously(firebaseInstance.auth);
        }
      } catch (e) {
        addLog("AUTH_FAIL", e.code);
        // 認証失敗時は5秒後にリトライ
        setTimeout(() => setReconnectTrigger(t => t + 1), 5000);
      }
    };

    runAuth();

    const unsub = onAuthStateChanged(firebaseInstance.auth, (u) => {
      if (u) {
        setUser(u);
        setAuthChecked(true);
        addLog("AUTH_OK", u.uid.slice(0, 8));
      } else {
        addLog("AUTH_WAIT", "Waiting for session ID...");
      }
    });

    return () => unsub();
  }, [configStatus, reconnectTrigger, firebaseInstance.auth]);

  // --- Step 3: 同期シーケンス (ユーザー確立後に開始) ---
  useEffect(() => {
    if (!user || !firebaseInstance.db) return;

    setIsSyncing(true);
    addLog("SYNC_START", "Linking to public data stream...");
    
    // パス固定: /artifacts/{appId}/public/data/stores
    const storesCollection = collection(firebaseInstance.db, 'artifacts', firebaseInstance.appId, 'public', 'data', 'stores');
    
    const unsub = onSnapshot(storesCollection, (snap) => {
      const stores = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setData(stores);
      setIsSyncing(false);
      addLog("SYNC_LOADED", `${stores.length} items synced`);
    }, (err) => { 
      setIsSyncing(false);
      addLog("SYNC_ERROR", err.code);
      if (err.code === 'permission-denied') {
        addLog("FATAL", "Permission denied. Check Firestore rules.");
      }
    });

    return () => unsub();
  }, [user, firebaseInstance.db, firebaseInstance.appId, reconnectTrigger]);

  const saveDataToCloud = async (storesToSave) => {
    if (!user || !firebaseInstance.db) {
      alert("接続待ちです。MonitorのStatusがCONNECTEDになるまでお待ちください。");
      return;
    }
    const safeStores = Array.isArray(storesToSave) ? storesToSave.filter(Boolean) : [];
    setIsSyncing(true);
    try {
      const batch = writeBatch(firebaseInstance.db);
      safeStores.forEach(s => {
        const docId = s.id || `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_");
        const docRef = doc(firebaseInstance.db, 'artifacts', firebaseInstance.appId, 'public', 'data', 'stores', docId);
        batch.set(docRef, { ...s, id: docId }, { merge: true });
      });
      await batch.commit();
      addLog("UPLOAD_SUCCESS", safeStores.length);
    } catch (e) { 
      addLog("UPLOAD_FAIL", e.code); 
      alert("保存エラー: " + e.code);
    }
    setIsSyncing(false);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file || !window.XLSX) {
      alert("準備中です。数秒待ってから再試行してください。");
      return;
    }
    addLog("FILE_IN", file.name);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const workbook = window.XLSX.read(e.target.result, { type: 'array' });
        const jsonData = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const normalized = jsonData.map((item, index) => {
          const name = item.店舗名 || item['店舗名'] || item['店名'] || '店舗名不明';
          const addr = item.住所 || item['住所'] || '';
          const pref = item.都道府県 || item['都道府県'] || 'その他';
          const itemId = `${name}-${addr}-${index}`.replace(/[.#$/[\]]/g, "_");
          return {
            id: itemId, NO: item.NO || (data.length + index + 1), 店舗名: name,
            カテゴリ: item.カテゴリ || item['カテゴリ'] || '飲食店', 都道府県: pref, 住所: addr,
            URL: item.URL || item['URL'] || '', imageURL: item.imageURL || item['imageURL'] || '', isFavorite: false
          };
        });
        setData(normalized);
        setActiveTab('list');
        await saveDataToCloud(normalized);
      } catch (err) { addLog("PARSE_ERR", err.message); }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };

  const deleteData = async (id) => {
    if (!user || !window.confirm("このお店を削除しますか？")) return;
    try { 
      await deleteDoc(doc(firebaseInstance.db, 'artifacts', firebaseInstance.appId, 'public', 'data', 'stores', id));
      addLog("DELETE_SUCCESS"); 
    } catch(e) { addLog("DELETE_FAIL", e.code); }
  };

  const toggleFavorite = async (store) => {
    if (!user) return;
    try {
      await setDoc(doc(firebaseInstance.db, 'artifacts', firebaseInstance.appId, 'public', 'data', 'stores', store.id), { isFavorite: !store.isFavorite }, { merge: true });
    } catch(e) { addLog("FAV_ERR", e.code); }
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
    script.onload = () => { setLibLoaded(true); addLog("XLSX_ENGINE_READY"); };
    document.head.appendChild(script);
  }, []);

  if (!authChecked && configStatus !== 'WAITING') {
    return <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-10 text-center">
      <Loader2 className="animate-spin text-orange-500 w-16 h-16 mb-6 mx-auto" />
      <h2 className="text-4xl font-black text-white tracking-tighter mb-2 italic">Gourmet Master</h2>
      <p className="font-bold text-slate-500 uppercase tracking-[0.3em] text-xs">Synchronizing Kernel...</p>
    </div>;
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-24 sm:pb-0 relative overflow-x-hidden">
      
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-xl border-b border-slate-200 h-16 md:h-20 flex items-center px-4 gap-3 shadow-sm">
        <div className="flex items-center gap-2 shrink-0 cursor-pointer" onClick={() => setActiveTab('map')}>
          <div className="bg-orange-500 p-2 rounded-xl text-white shadow-lg"><Store size={22} /></div>
          <h1 className="font-black text-xl tracking-tighter text-slate-800 uppercase italic hidden lg:block leading-none">Gourmet Master</h1>
        </div>
        
        <div className="flex-1 relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
          <input type="text" placeholder="店名や住所で検索..." className="w-full pl-10 pr-3 py-2.5 bg-slate-100/80 border-none rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold" value={searchTermInput} onChange={(e) => setSearchTermInput(e.target.value)} />
        </div>
        
        {/* 同期バッジ */}
        <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border shadow-inner shrink-0 ${user ? 'bg-orange-50 border-orange-200' : 'bg-rose-50 border-rose-100'}`}>
          {user ? <Wifi size={14} className="text-orange-500" /> : <WifiOff size={14} className="text-rose-400" />}
          <span className={`text-[10px] font-black uppercase ${user ? 'text-orange-700' : 'text-rose-600'}`}>
            {user ? 'Cloud' : (configStatus === 'WAITING' ? 'Waiting...' : 'Offline')}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-2">
           <label className="p-2.5 bg-slate-900 text-white rounded-xl cursor-pointer hover:bg-slate-800 active:scale-95 transition-all shadow-lg">
             <Upload size={22} /><input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
           </label>
        </div>
      </header>

      <nav className="bg-white border-b sticky top-16 md:top-20 z-40 flex overflow-x-auto scrollbar-hide px-2 shadow-sm">
        {[ { id: 'map', label: 'AREA', icon: <MapIcon size={18} /> }, { id: 'list', label: 'LIST', icon: <Grid size={18} /> }, { id: 'favorites', label: 'HEART', icon: <Heart size={18} /> }].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-8 py-5 text-[11px] font-black tracking-widest transition-all shrink-0 ${activeTab === tab.id ? 'text-orange-600 border-b-4 border-orange-600 bg-orange-50/30' : 'text-slate-400 hover:text-slate-600'}`}>{tab.icon} {tab.label}</button>
        ))}
      </nav>

      <main className="max-w-7xl mx-auto p-6 md:p-10 min-h-screen">
        <div className="mb-12 text-center animate-in fade-in duration-1000">
           <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.6em] mb-3 leading-none">Authentication Resilient Engine</p>
           <h2 className="text-6xl sm:text-9xl font-black text-slate-900 italic tracking-tighter leading-none mb-6">{VERSION}</h2>
           <div className={`inline-block px-8 py-2.5 rounded-full font-black text-[11px] uppercase tracking-widest shadow-xl ${user ? 'bg-orange-500 text-white shadow-orange-200' : 'bg-slate-200 text-slate-500'}`}>
             {user ? 'Cloud Synchronized' : 'System Initializing...'}
           </div>
        </div>

        {/* ネットワーク診断モニター (最重要) */}
        <div className="max-w-4xl mx-auto mb-16 bg-slate-950 rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-800">
          <div className="bg-slate-900 px-8 py-5 flex items-center justify-between border-b border-white/5">
            <div className="flex items-center gap-3">
              <Activity className="text-orange-500 animate-pulse" size={20} />
              <span className="text-[10px] font-black text-white uppercase tracking-widest italic">Synchronization Monitor</span>
            </div>
            <button onClick={() => setReconnectTrigger(t => t + 1)} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-full transition-all active:scale-95 shadow-lg border border-white/10">
               <RotateCcw size={14} className="text-orange-400 inline mr-2" />
               <span className="text-[10px] text-white font-black uppercase tracking-tighter">Force Reconnect</span>
            </button>
          </div>
          <div className="p-8 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[9px] font-black uppercase tracking-tighter text-center">
              <div className="bg-slate-900/50 p-5 rounded-2xl border border-white/5 shadow-inner">
                <p className="text-slate-500 mb-1">Engine Status</p>
                <p className={configStatus === 'READY' ? "text-green-400 font-bold" : "text-orange-500 animate-pulse"}>{configStatus}</p>
              </div>
              <div className="bg-slate-900/50 p-5 rounded-2xl border border-white/5 shadow-inner">
                <p className="text-slate-500 mb-1">Session ID</p>
                <p className={user ? "text-blue-400 truncate font-mono" : "text-rose-500"}>{user ? user.uid.slice(0,10) : 'NO_SESSION'}</p>
              </div>
              <div className="bg-slate-900/50 p-5 rounded-2xl border border-white/5 shadow-inner">
                <p className="text-slate-500 mb-1">Sync Access</p>
                <p className={user ? "text-green-500 font-bold" : "text-rose-500 font-bold"}>{user ? "CONNECTED" : "OFFLINE"}</p>
              </div>
              <div className="bg-slate-900/50 p-5 rounded-2xl border border-white/5 shadow-inner">
                <p className="text-slate-500 mb-1">Dataset</p>
                <p className="text-white text-xl">{data.length}</p>
              </div>
            </div>
            <div className="bg-black/60 rounded-3xl p-6 h-32 overflow-y-auto scrollbar-hide font-mono text-[10px] border border-white/5 text-slate-400 shadow-inner">
               {logs.length === 0 ? <p className="opacity-30 italic">Booting kernel...</p> : logs.map((l, i) => ( <div key={i} className={`flex gap-3 mb-1.5 border-b border-white/5 pb-1 ${l.event.includes('ERR') ? 'text-rose-400 font-black' : 'text-slate-400'}`}><span className="text-slate-600 shrink-0">{l.time}</span><span className="text-orange-500 font-black shrink-0">{l.event}</span><span>{l.value}</span></div> ))}
            </div>
          </div>
        </div>

        {data.length === 0 ? (
          <div className="max-w-4xl mx-auto py-20 text-center bg-white p-16 rounded-[4rem] shadow-2xl border border-slate-100 animate-in zoom-in duration-500">
              {configStatus === 'WAITING' ? (
                <>
                  <Loader2 className="animate-spin mx-auto text-slate-200 mb-8" size={80} />
                  <h2 className="text-3xl font-black mb-4 text-slate-400 uppercase tracking-tighter italic">Waiting for environment config...</h2>
                  <p className="text-slate-400 font-bold text-sm">システム設定を読み込んでいます。このまま数秒お待ちください。</p>
                </>
              ) : (
                <>
                  <Database className="mx-auto text-orange-500 mb-8 opacity-20" size={100} />
                  <h2 className="text-4xl font-black mb-6 text-slate-800 tracking-tight italic uppercase">Import Required</h2>
                  <p className="text-slate-400 mb-12 font-bold max-w-sm mx-auto text-sm leading-relaxed">Windowsでエクセルを取り込めばiPhoneにも自動反映されます。<br/>接続が切れている場合はモニターの[Retry]を押してください。</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-lg mx-auto">
                    <button onClick={() => saveDataToCloud([{NO:1,店舗名:"サンプル名店",カテゴリ:"和食",都道府県:"東京都",住所:"銀座",isFavorite:true}])} className="py-6 bg-orange-500 text-white rounded-[2rem] font-black shadow-xl hover:bg-orange-600 transition-all active:scale-95 text-xl tracking-widest uppercase">Sample</button>
                    <label className="py-6 border-2 border-slate-200 text-slate-600 rounded-[2rem] font-black cursor-pointer hover:bg-slate-50 transition-all text-xl flex items-center justify-center gap-3 italic tracking-widest uppercase">
                      <Upload size={24}/> Import<input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
                    </label>
                  </div>
                </>
              )}
          </div>
        ) : (
          <div className="space-y-16 pb-40">
            {activeTab === 'map' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 animate-in fade-in duration-700">
                {Object.keys(regions).map(reg => (
                  <button key={`reg-${reg}`} onClick={() => { setSelectedPrefecture('すべて'); setActiveTab('list'); }} className="group bg-white rounded-[3rem] p-10 text-left border border-slate-100 shadow-sm hover:shadow-2xl transition-all flex flex-col justify-between min-h-[220px] relative overflow-hidden active:scale-95 text-slate-800">
                    <div className="absolute -top-4 -right-4 p-8 opacity-5 group-hover:scale-125 transition-all rotate-12"><MapIcon size={120}/></div>
                    <div className="relative z-10"><p className="text-[11px] font-black text-slate-300 uppercase tracking-[0.4em] mb-2">{reg} Area</p><h3 className="text-4xl font-black group-hover:text-orange-600 transition-colors uppercase tracking-tighter">{reg}</h3></div>
                    <div className="relative z-10 mt-8 flex items-center justify-between"><span className="text-sm font-black bg-slate-50 text-slate-400 px-4 py-2 rounded-full border border-slate-100 group-hover:bg-orange-50 group-hover:text-orange-600 transition-colors uppercase">{data.filter(d => (regions[reg] || []).includes(d.都道府県)).length} STORES</span><ChevronRight size={28} className="text-orange-500 -translate-x-4 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" /></div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col lg:flex-row gap-12 animate-in slide-in-from-bottom-10">
                <aside className="lg:w-80 shrink-0 hidden lg:block">
                   <div className="bg-white p-10 rounded-[4rem] border border-slate-200 shadow-xl sticky top-48 space-y-10 max-h-[70vh] overflow-y-auto scrollbar-hide font-black text-xs">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-3 border-b border-slate-50 pb-6 italic tracking-widest"><ArrowDown size={18} className="text-orange-500" /> Genre Jump</p>
                    {groupedData.map(([category, stores]) => (
                      <button key={`side-${category}`} onClick={() => { const el = document.getElementById(`category-section-${category}`); if(el) window.scrollTo({top: el.offsetTop - 120, behavior:'smooth'}); }} className="w-full px-6 py-5 bg-slate-50 text-left rounded-[2rem] hover:bg-orange-50 hover:text-orange-600 transition-all flex items-center justify-between group active:scale-95 shadow-sm uppercase tracking-widest text-slate-600">
                        <span className="truncate">{category}</span><span className="bg-white text-slate-900 px-3 py-1 rounded-xl shadow-sm font-black text-[10px]">{stores.length}</span>
                      </button>
                    ))}
                  </div>
                </aside>
                <div className="flex-1 space-y-24 min-w-0">
                  {groupedData.map(([category, stores]) => (
                    <div key={`section-${category}`} id={`category-section-${category}`} className="space-y-12 scroll-mt-48 animate-in fade-in duration-1000">
                      <div className="flex items-center gap-8 px-4"><h3 className="text-3xl font-black text-slate-800 flex items-center gap-4 uppercase tracking-tighter italic"><Layers size={36} className="text-orange-500" /> {category}</h3><div className="flex-1 h-0.5 bg-slate-200/60"></div><span className="bg-orange-500 text-white px-8 py-2.5 rounded-full text-[11px] font-black shadow-lg tracking-[0.2em]">{stores.length} ITEMS</span></div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                        {stores.map(store => (
                          <div key={store.id} className="bg-white rounded-[4rem] shadow-sm border border-slate-100 hover:border-orange-200 hover:shadow-2xl transition-all duration-700 flex flex-col group relative">
                            <div className="relative h-72 overflow-hidden bg-slate-50 rounded-t-[4rem]">
                              <img src={store.imageURL || `https://loremflickr.com/600/400/gourmet,food?lock=${(store.店舗名||'').length}`} alt={store.店舗名} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[2000ms]" />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/20 to-transparent opacity-90 group-hover:opacity-70 transition-opacity"></div>
                              <button onClick={() => toggleFavorite(store)} className={`absolute top-8 right-8 z-10 p-5 rounded-3xl backdrop-blur-md shadow-2xl transition-all active:scale-[1.8] ${store.isFavorite ? 'bg-rose-500 text-white shadow-rose-500/50' : 'bg-white/90 text-slate-300 hover:text-rose-500'}`}><Heart size={24} fill={store.isFavorite ? "currentColor" : "none"} /></button>
                              <div className="absolute bottom-8 left-10 right-10 text-white pointer-events-none space-y-1"><p className="text-[10px] font-black tracking-[0.3em] uppercase opacity-70 flex items-center gap-2"><MapPin size={12} className="text-orange-400" /> {store.都道府県} • {getSubArea(store.都道府県, store.住所)}</p><h4 className="text-3xl font-black truncate drop-shadow-2xl italic tracking-tight uppercase">{store.店舗名}</h4></div>
                            </div>
                            <div className="p-10 flex-1 flex flex-col justify-between gap-10">
                              <p className="line-clamp-2 leading-relaxed italic text-slate-500 font-bold text-sm">{store.住所 || "住所情報がありません。"}</p>
                              <div className="flex gap-4 pt-6 border-t border-slate-50">
                                {store.URL && store.URL !== 'Link' && (<a href={store.URL.startsWith('http') ? store.URL : `https://${store.URL}`} target="_blank" rel="noopener noreferrer" className="flex-1 py-5 bg-orange-50 text-orange-600 rounded-[1.5rem] hover:bg-orange-600 hover:text-white transition-all text-center text-[11px] font-black uppercase tracking-widest shadow-sm font-black flex items-center justify-center leading-none">Visit Website</a>)}
                                <button onClick={() => deleteData(store.id)} className="p-5 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-white rounded-[1.5rem] transition-all shadow-inner flex items-center justify-center leading-none"><Trash2 size={24}/></button>
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
        VER {VERSION} | ALL TERMINALS SYNCED
      </footer>

      {/* モバイル用インポートボタン */}
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 sm:hidden z-40 flex items-center gap-4">
        <label className="bg-slate-900 text-white px-8 py-5 rounded-[2rem] font-black shadow-2xl active:scale-110 transition-all flex items-center gap-3 text-sm uppercase tracking-widest">
           <Upload size={20}/> Import Excel
           <input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
        </label>
      </div>
    </div>
  );
};

const App = () => (<ErrorBoundary><GourmetApp /></ErrorBoundary>);
export default App;