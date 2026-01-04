import React, { useState, useMemo, useEffect, Component, useDeferredValue } from 'react';
import { 
  Search, MapPin, ExternalLink, Plus, 
  Upload, Trash2, Edit2, X, Store, Heart, Save, 
  Loader2, Map as MapIcon, Grid, Database, 
  ChevronRight, Layers, ArrowDown, 
  Cloud, Copy, RefreshCcw, ShieldAlert, List,
  Filter, PieChart, Info, ImageIcon, Navigation, Bug, ChevronUp, ChevronDown, RotateCcw, Trash, Link as LinkIcon, Terminal, Activity, Wifi, WifiOff, AlertTriangle
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
const VERSION = "Gen_v3.81-CORE-SYNC-FIX";

// --- A. ErrorBoundary ---
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white p-8 font-mono flex flex-col items-center justify-center text-center">
          <ShieldAlert size={64} className="text-rose-500 mb-6" />
          <h1 className="text-2xl font-black uppercase mb-2">Core Crash Detected</h1>
          <div className="bg-black/50 p-6 rounded-2xl border border-rose-500/30 max-w-lg mb-8 text-left overflow-auto">
            <p className="text-rose-400 font-bold text-sm">{this.state.error?.message}</p>
          </div>
          <button onClick={() => window.location.reload()} className="px-10 py-4 bg-white text-black rounded-2xl font-black uppercase">Force Restart</button>
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
  const [firebaseStatus, setFirebaseStatus] = useState('INITIALIZING');

  // Firebase 関連のインスタンス（動的保持）
  const [instances, setInstances] = useState({ auth: null, db: null, appId: 'gourmet-master-v1' });

  const [searchTermInput, setSearchTermInput] = useState('');
  const searchTerm = useDeferredValue(searchTermInput);

  const addLog = (event, value = "-") => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [{ time, event, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }, ...prev].slice(0, 30));
  };

  // --- Step 1: Firebase インスタンスの動的確立 ---
  useEffect(() => {
    try {
      addLog("BOOT_INIT", "Checking config...");
      let config = null;
      if (typeof __firebase_config !== 'undefined') {
        config = typeof __firebase_config === 'string' ? JSON.parse(__firebase_config) : __firebase_config;
      }

      if (!config || !config.apiKey) {
        setFirebaseStatus('CONFIG_MISSING');
        addLog("BOOT_ERROR", "Configuration data is empty.");
        setAuthChecked(true); // オフラインとして起動
        return;
      }

      const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
      const _auth = getAuth(app);
      const _db = getFirestore(app);
      const _appId = typeof __app_id !== 'undefined' ? __app_id : 'gourmet-master-v1';

      setInstances({ auth: _auth, db: _db, appId: _appId });
      setFirebaseStatus('READY');
      addLog("BOOT_SUCCESS", "Firebase Engine Ready");
    } catch (e) {
      setFirebaseStatus('CRASH');
      addLog("BOOT_CRASH", e.message);
      setAuthChecked(true);
    }
  }, [reconnectTrigger]);

  // --- Step 2: 認証シーケンス (Rule 3) ---
  useEffect(() => {
    if (firebaseStatus !== 'READY' || !instances.auth) return;

    const runAuth = async () => {
      try {
        addLog("AUTH_ATTEMPT", "Signing in...");
        await setPersistence(instances.auth, browserLocalPersistence);
        
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(instances.auth, __initial_auth_token);
        } else {
          await signInAnonymously(instances.auth);
        }
      } catch (e) {
        addLog("AUTH_FAIL", e.code);
        // 失敗しても 5秒後にリトライ（WindowsでOfflineにならないためのキモ）
        setTimeout(() => setReconnectTrigger(t => t + 1), 5000);
      }
    };

    runAuth();

    const unsub = onAuthStateChanged(instances.auth, (u) => {
      if (u) {
        setUser(u);
        setAuthChecked(true);
        addLog("AUTH_OK", u.uid.slice(0, 8));
      } else {
        addLog("AUTH_LOST", "Session disconnected");
      }
    });

    return () => unsub();
  }, [firebaseStatus, reconnectTrigger, instances.auth]);

  // --- Step 3: 同期シーケンス (Rule 1 & Rule 3) ---
  useEffect(() => {
    if (!user || !instances.db) return;

    setIsSyncing(true);
    addLog("SYNC_START", "Connecting to Cloud storage...");
    
    // パス固定: /artifacts/{appId}/public/data/stores
    const storesCollection = collection(instances.db, 'artifacts', instances.appId, 'public', 'data', 'stores');
    
    const unsub = onSnapshot(storesCollection, (snap) => {
      const stores = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setData(stores);
      setIsSyncing(false);
      addLog("SYNC_SUCCESS", `${stores.length} items loaded`);
    }, (err) => { 
      setIsSyncing(false);
      addLog("SYNC_ERROR", err.code);
      if (err.code === 'permission-denied') {
        addLog("CRITICAL", "Path rules violation or auth expired.");
      }
    });

    return () => unsub();
  }, [user, instances.db, instances.appId, reconnectTrigger]);

  const saveDataToCloud = async (storesToSave) => {
    if (!user || !instances.db) {
      alert("クラウド接続待ちです。しばらく待ってから再実行してください。");
      return;
    }
    const safeStores = Array.isArray(storesToSave) ? storesToSave.filter(Boolean) : [];
    setIsSyncing(true);
    try {
      const batch = writeBatch(instances.db);
      safeStores.forEach(s => {
        const docId = s.id || `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_");
        const docRef = doc(instances.db, 'artifacts', instances.appId, 'public', 'data', 'stores', docId);
        batch.set(docRef, { ...s, id: docId }, { merge: true });
      });
      await batch.commit();
      addLog("UPLOAD_OK", safeStores.length);
    } catch (e) { addLog("UPLOAD_FAIL", e.code); }
    setIsSyncing(false);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file || !window.XLSX) {
      alert("準備中です。もう一度選んでください。");
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
    if (!user || !window.confirm("削除しますか？")) return;
    try { 
      await deleteDoc(doc(instances.db, 'artifacts', instances.appId, 'public', 'data', 'stores', id));
      addLog("DELETE_OK"); 
    } catch(e) { addLog("DELETE_FAIL", e.code); }
  };

  const toggleFavorite = async (store) => {
    if (!user) return;
    try {
      await setDoc(doc(instances.db, 'artifacts', instances.appId, 'public', 'data', 'stores', store.id), { isFavorite: !store.isFavorite }, { merge: true });
    } catch(e) { addLog("FAV_ERR", e.code); }
  };

  const filteredData = useMemo(() => {
    let res = data.filter(Boolean);
    if (activeTab === 'favorites') res = res.filter(d => d.isFavorite);
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      res = res.filter(d => (d.店舗名?.toLowerCase().includes(t) || d.住所?.toLowerCase().includes(t) || d.カテゴリ?.toLowerCase().includes(t)));
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
    return <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-10 text-center">
      <Loader2 className="animate-spin text-orange-500 w-16 h-16 mb-6 mx-auto" />
      <h2 className="text-4xl font-black text-white tracking-tighter mb-2">{VERSION}</h2>
      <p className="font-bold text-slate-500 uppercase tracking-widest text-xs animate-pulse">Initializing Firebase Engine...</p>
    </div>;
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-24 sm:pb-0 relative overflow-x-hidden">
      
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-xl border-b border-slate-200 h-16 md:h-20 flex items-center px-4 gap-2 shadow-sm">
        <div className="flex items-center gap-2 shrink-0 cursor-pointer" onClick={() => setActiveTab('map')}>
          <div className="bg-orange-500 p-2 rounded-xl text-white shadow-lg"><Store size={22} /></div>
          <h1 className="font-black text-xl tracking-tighter text-slate-800 uppercase italic hidden lg:block leading-none">Gourmet Master</h1>
        </div>
        
        <div className="flex-1 relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
          <input type="text" placeholder="店名や住所で高速検索..." className="w-full pl-10 pr-3 py-2.5 bg-slate-100/80 border-none rounded-xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold" value={searchTermInput} onChange={(e) => setSearchTermInput(e.target.value)} />
        </div>
        
        {/* 同期バッジ */}
        <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border shadow-inner shrink-0 ${user ? 'bg-orange-50 border-orange-200' : 'bg-rose-50 border-rose-200'}`}>
          {user ? <Wifi size={14} className="text-orange-500" /> : <WifiOff size={14} className="text-rose-500 animate-pulse" />}
          <span className={`text-[10px] font-black uppercase ${user ? 'text-orange-700' : 'text-rose-700'}`}>
            {user ? 'Cloud' : 'Wait...'}
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
           <h2 className="text-6xl sm:text-9xl font-black text-slate-900 italic tracking-tighter leading-none mb-6">{VERSION}</h2>
           <div className={`inline-block px-8 py-2.5 rounded-full font-black text-[11px] uppercase tracking-widest shadow-xl ${user ? 'bg-orange-500 text-white shadow-orange-200' : 'bg-rose-500 text-white'}`}>
             {user ? 'Global Public Sync Enabled' : 'Connecting to Core Hub...'}
           </div>
        </div>

        {/* ネットワーク診断モニター */}
        <div className="max-w-4xl mx-auto mb-16 bg-slate-900 rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-800">
          <div className="bg-slate-800 px-8 py-5 flex items-center justify-between border-b border-white/5">
            <div className="flex items-center gap-3">
              <Activity className="text-orange-500 animate-pulse" size={20} />
              <span className="text-[10px] font-black text-white uppercase tracking-widest italic">Core Network Monitor</span>
            </div>
            <button onClick={() => setReconnectTrigger(t => t + 1)} className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-full transition-all active:scale-95 shadow-lg border border-white/5">
               <RotateCcw size={14} className="text-orange-400 inline mr-2" />
               <span className="text-[10px] text-white font-black uppercase">Retry Auth</span>
            </button>
          </div>
          <div className="p-8 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[9px] font-black uppercase tracking-tighter text-center">
              <div className="bg-slate-800/50 p-5 rounded-2xl border border-white/5 shadow-inner">
                <p className="text-slate-500 mb-1">Session ID</p>
                <p className={user ? "text-blue-400 truncate" : "text-rose-500"}>{user ? user.uid.slice(0,10) : 'DISCONNECTED'}</p>
              </div>
              <div className="bg-slate-800/50 p-5 rounded-2xl border border-white/5 shadow-inner">
                <p className="text-slate-500 mb-1">Local Stores</p>
                <p className="text-green-400 text-xl">{data.length}</p>
              </div>
              <div className="bg-slate-800/50 p-5 rounded-2xl border border-white/5 shadow-inner">
                <p className="text-slate-500 mb-1">Engine Status</p>
                <p className={firebaseStatus === 'READY' ? 'text-green-400' : 'text-rose-500'}>{firebaseStatus}</p>
              </div>
              <div className="bg-slate-800/50 p-5 rounded-2xl border border-white/5 shadow-inner">
                <p className="text-slate-500 mb-1">Sync Access</p>
                <p className={user ? "text-green-500 font-bold" : "text-rose-500 font-bold"}>{user ? "CONNECTED" : "OFFLINE"}</p>
              </div>
            </div>
            <div className="bg-black/40 rounded-3xl p-6 h-32 overflow-y-auto scrollbar-hide font-mono text-[10px] border border-white/5 text-slate-300">
               {logs.length === 0 ? <p className="opacity-30">No logs yet...</p> : logs.map((l, i) => ( <div key={i} className={`flex gap-3 mb-1 border-b border-white/5 pb-1 ${l.event.includes('ERR') ? 'text-rose-400 font-bold' : 'text-slate-400'}`}><span className="text-slate-600">{l.time}</span><span className="text-orange-500 font-black">{l.event}</span><span>{l.value}</span></div> ))}
            </div>
          </div>
        </div>

        {data.length === 0 ? (
          <div className="max-w-4xl mx-auto py-20 text-center bg-white p-16 rounded-[4rem] shadow-2xl border border-slate-100 animate-in zoom-in duration-500">
              <Database className="mx-auto text-orange-500 mb-8 opacity-20" size={100} />
              <h2 className="text-4xl font-black mb-6 text-slate-800 tracking-tight italic uppercase">Import Required</h2>
              <p className="text-slate-400 mb-12 font-bold max-w-sm mx-auto text-sm leading-relaxed">Windowsでエクセルを取り込めばiPhoneにも自動表示されます。<br/>「Offline」の場合は、上のモニターのRetryを押してください。</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-lg mx-auto">
                <button onClick={() => saveDataToCloud([{NO:1,店舗名:"サンプル店",カテゴリ:"和食",都道府県:"東京都",住所:"銀座",isFavorite:true}])} className="py-6 bg-orange-500 text-white rounded-[2rem] font-black shadow-xl hover:bg-orange-600 transition-all active:scale-95 text-xl tracking-widest">Sample</button>
                <label className="py-6 border-2 border-slate-200 text-slate-600 rounded-[2rem] font-black cursor-pointer hover:bg-slate-50 transition-all text-xl flex items-center justify-center gap-3 italic tracking-widest uppercase">
                  <Upload size={24}/> Import Excel<input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
                </label>
              </div>
          </div>
        ) : (
          <div className="space-y-16 pb-40">
            {activeTab === 'map' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 animate-in fade-in duration-700">
                {Object.keys(regions).map(reg => (
                  <button key={`region-${reg}`} onClick={() => { setSelectedPrefecture('すべて'); setActiveTab('list'); }} className="group bg-white rounded-[3rem] p-10 text-left border border-slate-100 shadow-sm hover:shadow-2xl transition-all flex flex-col justify-between min-h-[220px] relative overflow-hidden active:scale-95 text-slate-800">
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
                              <p className="line-clamp-2 leading-relaxed italic text-slate-500 font-bold text-sm">{store.住所 || "No address provided."}</p>
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

      <footer className="w-full py-16 text-center text-[11px] font-black text-slate-300 uppercase tracking-[0.5em] bg-white border-t sm:hidden mb-4 px-10 leading-loose font-black italic">
        VER {VERSION} | ALL TERMINALS SYNCED
      </footer>

      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 sm:hidden z-40 flex items-center gap-4">
        <label className="bg-slate-900 text-white px-8 py-5 rounded-[2rem] font-black shadow-2xl active:scale-110 transition-all flex items-center gap-3 text-sm uppercase tracking-widest shadow-slate-400">
           <Upload size={20}/> Import Excel
           <input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
        </label>
      </div>
    </div>
  );
};

const App = () => (<ErrorBoundary><GourmetApp /></ErrorBoundary>);
export default App;