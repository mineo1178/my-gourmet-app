import React, { useState, useMemo, useEffect, Component } from 'react';
import { 
  Search, MapPin, ExternalLink, Plus, 
  Upload, Trash2, Edit2, X, Store, Heart, Save, 
  Loader2, Map as MapIcon, Grid, Database, 
  ChevronRight, Layers, ArrowDown, 
  Cloud, Copy, RefreshCcw, ShieldAlert, List,
  Filter, PieChart, Info, ImageIcon, Navigation, Bug, ChevronUp, ChevronDown
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
  browserLocalPersistence
} from 'firebase/auth';

const VERSION = "v3.37-DEBUG-SURGEON";

// --- A. ErrorBoundary ---
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("FATAL UI ERROR:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white p-8 font-mono overflow-auto flex flex-col items-center justify-center text-center">
          <div className="max-w-3xl w-full space-y-6 bg-slate-800 p-10 rounded-[3rem] border border-white/10 shadow-2xl">
            <ShieldAlert size={64} className="text-rose-500 mx-auto" />
            <h1 className="text-2xl font-black italic uppercase tracking-tighter">System Crash Prevented</h1>
            <div className="p-5 bg-black/50 rounded-2xl border border-white/5 text-left space-y-2 text-xs">
              <p className="text-rose-400 font-bold">Error: {this.state.error?.message || "Render Error"}</p>
              <div className="text-slate-500 border-t border-white/5 pt-2 mt-2">
                VERSION: {VERSION} | HOST: {window.location.hostname}
              </div>
            </div>
            <button onClick={() => window.location.reload()} className="w-full py-5 bg-orange-500 text-white rounded-3xl font-black flex items-center justify-center gap-3 hover:bg-orange-600 transition-all shadow-xl active:scale-95">
              <RefreshCcw size={20} /> Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- 0. ヘルパー・定数 ---
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
  '北海道': ['北海道'], '東北': ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  '関東': ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
  '中部': ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'],
  '近畿': ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  '中国': ['鳥取県', '島根県', '岡山県', '広島県', '山口県'], '四国': ['徳島県', '香川県', '愛媛県', '高知県'],
  '九州・沖縄': ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']
};

const prefToRegionMap = (() => {
  const map = {};
  Object.entries(regions).forEach(([region, prefs]) => { prefs.forEach(p => map[p] = region); });
  return map;
})();

const getRegionFromPref = (pref) => prefToRegionMap[pref] || 'その他';

const getSubArea = (pref, address = "") => {
  if (!address) return "主要エリア";
  if (pref === '東京都') {
    if (address.match(/千代田|中央|港|新宿|文京|台東|墨田|江東|品川|目黒|大田|世田谷|渋谷|中野|杉並|豊島|北|荒川|板橋|練馬|足立|葛飾|江戸川/)) return "23区内";
    if (address.match(/武蔵野|三鷹|調布|府中|小金井|国分寺|国立|町田|立川|八王子/)) return "多摩エリア";
    return "都下・その他";
  }
  if (pref === '神奈川県') {
    if (address.includes('横浜')) return "横浜エリア";
    if (address.includes('川崎')) return "川崎エリア";
    return "県央・その他";
  }
  if (pref === '大阪府') {
    if (address.includes('大阪市')) return "大阪市内";
    return "北摂・東大阪";
  }
  const match = address.match(/^.*?[市郡区]/);
  return match ? match[0].replace(pref, "") : "主要エリア";
};

const normalizePrefecture = (name) => {
  if (!name) return "";
  const match = PREF_ORDER.find(p => p.startsWith(name) || name.startsWith(p));
  return match || "";
};

const sanitizeId = (text) => encodeURIComponent(text || '').replace(/%/g, '_').replace(/\./g, '_');

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
  } catch (e) { console.error("CONFIG_PARSE_ERR", e); }
  return { firebaseConfig: null, isEnvConfig: false };
};

const { firebaseConfig, isEnvConfig } = getFirebaseConfig();
const appId = typeof __app_id !== 'undefined' ? __app_id : 'gourmet-master-v1';

let firebaseApp = null;
let auth = null;
let db = null;

if (isEnvConfig && firebaseConfig?.apiKey) {
  try {
    firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    // 初期化時の永続化設定（エラーは無視せずコンソールへ）
    setPersistence(auth, browserLocalPersistence).catch(e => console.error("INIT_PERSISTENCE_ERR", e));
  } catch (e) { console.error("FIREBASE_INIT_CRASH", e); }
}

const canUseCloud = Boolean(isEnvConfig && auth && db);

const checkIsMobile = () => {
  if (typeof navigator === 'undefined') return false;
  if (navigator.userAgentData?.mobile) return true;
  const ua = navigator.userAgent;
  const isIPadOS = (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua));
  return /iPhone|iPod|Android/i.test(ua) || isIPadOS;
};

// --- B. アプリケーション本体 ---
const GourmetApp = () => {
  const [data, setData] = useState([]);
  const [user, setUser] = useState(null);
  const [cloudMode, setCloudMode] = useState(canUseCloud);
  const [authError, setAuthError] = useState(null);
  const [fsError, setFsError] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [libLoaded, setLibLoaded] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0);
  const [isLocating, setIsLocating] = useState(false);

  // デバッグ用パネルの状態
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [redirectResultLog, setRedirectResultLog] = useState({ status: 'wait', time: '-' });
  const [lastAuthEvent, setLastAuthEvent] = useState('-');

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPrefecture, setSelectedPrefecture] = useState('すべて');
  const [viewMode, setViewMode] = useState('detail'); 
  const [activeTab, setActiveTab] = useState('map'); 
  const [editingStore, setEditingStore] = useState(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  const isMobileDevice = useMemo(() => checkIsMobile(), []);
  const firestorePath = user?.uid ? `artifacts/${appId}/users/${user.uid}/stores` : 'N/A';

  // LocalStorage 書き込みチェック
  const lsStatus = useMemo(() => {
    try {
      const key = `__ls_test_${Date.now()}`;
      localStorage.setItem(key, "1");
      localStorage.removeItem(key);
      return "OK";
    } catch(e) { return `FAIL (${e.name})`; }
  }, []);

  const scrollToCategory = (id) => {
    const safeId = sanitizeId(id);
    const el = document.getElementById(`category-section-${safeId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const stats = useMemo(() => {
    const res = { regions: {}, prefs: {}, subAreas: {}, total: data.length };
    data.filter(Boolean).forEach(item => {
      const r = getRegionFromPref(item.都道府県 || '');
      const p = item.都道府県 || '';
      const s = getSubArea(p, item.住所 || '');
      res.regions[r] = (res.regions[r] || 0) + 1;
      res.prefs[p] = (res.prefs[p] || 0) + 1;
      if (p === selectedPrefecture || selectedPrefecture === 'すべて') {
        res.subAreas[s] = (res.subAreas[s] || 0) + 1;
      }
    });
    return res;
  }, [data, selectedPrefecture]);

  const filteredData = useMemo(() => {
    let res = data.filter(Boolean);
    if (activeTab === 'favorites') res = res.filter(item => item.isFavorite);
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      res = res.filter(i => (i.店舗名||'').toLowerCase().includes(t) || (i.住所||'').toLowerCase().includes(t));
    }
    if (selectedPrefecture !== 'すべて') res = res.filter(i => i.都道府県 === selectedPrefecture);
    return res;
  }, [data, searchTerm, selectedPrefecture, activeTab]);

  const groupedData = useMemo(() => {
    const groups = {};
    filteredData.forEach(i => {
      const c = i.カテゴリ || '未分類';
      if (!groups[c]) groups[c] = [];
      groups[c].push(i);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filteredData]);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => setLibLoaded(true);
    script.onerror = () => setLibLoaded(true); 
    document.head.appendChild(script);
    const timer = setTimeout(() => { setLibLoaded(true); }, 4000);
    return () => { clearTimeout(timer); if (document.head.contains(script)) document.head.removeChild(script); };
  }, []);

  // 認証 (iPhone Safari セッション復元強化)
  useEffect(() => {
    let unsubAuth = null;
    let isMounted = true;

    if (cloudMode && canUseCloud) {
      // 必須修正4: getRedirectResult での明示的反映
      getRedirectResult(auth)
        .then((res) => { 
          if (res?.user && isMounted) {
            setRedirectResultLog({ status: 'success', code: 'OK', time: new Date().toLocaleTimeString() });
            setUser(res.user); // 明示的にセット
          } else {
            setRedirectResultLog({ status: 'no_result', code: '-', time: new Date().toLocaleTimeString() });
          }
        })
        .catch((err) => {
          if (isMounted) {
            setRedirectResultLog({ status: 'error', code: err.code, time: new Date().toLocaleTimeString() });
            setAuthError(`Auth Error: ${err.code}`);
            setNeedsLogin(true);
            setAuthChecked(true);
          }
        });

      unsubAuth = onAuthStateChanged(auth, (u) => { 
        if (!isMounted) return;
        setLastAuthEvent(new Date().toLocaleTimeString());
        if (!u) { setNeedsLogin(true); setUser(null); } 
        else { setNeedsLogin(false); setUser(u); }
        setAuthChecked(true);
      });
    } else {
      if (isMounted) { setNeedsLogin(false); setUser({ uid: 'local-user-static' }); setAuthChecked(true); }
    }
    return () => { isMounted = false; if (typeof unsubAuth === "function") unsubAuth(); };
  }, [cloudMode]);

  // 必須修正3: setPersistence を await するログイン処理
  const startLogin = async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    setAuthError(null);
    try {
      // iPhone Safari 用に永続化設定を確定させてからリダイレクト
      await setPersistence(auth, browserLocalPersistence);
      
      if (isMobileDevice) {
        await signInWithRedirect(auth, provider);
      } else {
        const res = await signInWithPopup(auth, provider);
        if (res?.user) setUser(res.user); 
      }
    } catch (err) {
      setAuthError(`認証失敗: ${err.code || err.message}`);
      setNeedsLogin(true);
    }
  };

  useEffect(() => {
    if (!user || user.uid.startsWith('local-user')) { loadLocalData(); return; }
    let unsubSnapshot = null;
    if (canUseCloud && cloudMode && db) {
      setIsSyncing(true);
      try {
        const storesCol = collection(db, 'artifacts', appId, 'users', user.uid, 'stores');
        unsubSnapshot = onSnapshot(storesCol, (snap) => {
          setData(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          setFsError(null); setIsSyncing(false);
        }, (err) => {
          setFsError(`Sync Fail: ${err.code}`);
          loadLocalData(); setIsSyncing(false);
        });
      } catch (e) { console.error("Snapshot error:", e); }
    } else { loadLocalData(); }
    return () => { if (typeof unsubSnapshot === "function") unsubSnapshot(); };
  }, [user, cloudMode, syncTrigger]);

  const loadLocalData = () => {
    try {
      const saved = localStorage.getItem('gourmetStores');
      if (saved) setData(JSON.parse(saved));
    } catch (e) { console.error("local-load-err", e); }
  };

  const saveData = async (storesToSave) => {
    const safeStores = Array.isArray(storesToSave) ? storesToSave.filter(Boolean) : [];
    const newDataMap = new Map(data.filter(Boolean).map(item => [item.id, item]));
    safeStores.forEach(s => {
      const docId = s.id || `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_");
      newDataMap.set(docId, { ...s, id: docId });
    });
    const allData = Array.from(newDataMap.values());
    if (canUseCloud && cloudMode && db && user && !user.uid.startsWith('local-user')) {
      setIsSyncing(true);
      try {
        const CHUNK_SIZE = 400;
        for (let i = 0; i < safeStores.length; i += CHUNK_SIZE) {
          const batch = writeBatch(db);
          const chunk = safeStores.slice(i, i + CHUNK_SIZE);
          chunk.forEach(store => {
            const docId = store.id || `${store.店舗名}-${store.住所}`.replace(/[.#$/[\]]/g, "_");
            const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'stores', docId);
            batch.set(docRef, { ...store, id: docId }, { merge: true });
          });
          await batch.commit();
        }
      } catch (e) { setFsError(`Write Error: ${e.code}`); }
      setIsSyncing(false);
    } else {
      setData(allData);
      localStorage.setItem('gourmetStores', JSON.stringify(allData));
    }
  };

  const toggleFavorite = async (store) => {
    if (canUseCloud && cloudMode && db && user && !user.uid.startsWith('local-user')) {
      try { await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'stores', store.id), { isFavorite: !store.isFavorite }, { merge: true }); } catch (e) { setFsError(`Update Error: ${e.code}`); }
    } else {
      const updated = data.filter(Boolean).map(item => item.id === store.id ? { ...item, isFavorite: !item.isFavorite } : item);
      setData(updated);
      localStorage.setItem('gourmetStores', JSON.stringify(updated));
    }
  };

  const deleteData = async (id) => {
    if (!window.confirm("削除しますか？")) return;
    if (canUseCloud && cloudMode && db && user && !user.uid.startsWith('local-user')) {
      try { await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'stores', id)); } catch (e) { setFsError(`Delete Error: ${e.code}`); }
    } else {
      const filtered = data.filter(Boolean).filter(item => item.id !== id);
      setData(filtered);
      localStorage.setItem('gourmetStores', JSON.stringify(filtered));
    }
  };

  const copyDebugData = () => {
    const debugText = JSON.stringify({
      version: VERSION,
      href: window.location.href,
      hostname: window.location.hostname,
      ua: navigator.userAgent,
      cookies: navigator.cookieEnabled,
      ls: lsStatus,
      cloud: { canUseCloud, cloudMode, appId },
      config: { authDomain: firebaseConfig?.authDomain, projectId: firebaseConfig?.projectId },
      instances: { auth: !!auth, db: !!db },
      user: user ? { uid: user.uid, email: user.email } : null,
      state: { needsLogin, authChecked },
      errors: { authError, fsError },
      events: { lastAuthEvent, redirectResult: redirectResultLog }
    }, null, 2);

    // Safari 用 fallback コピー
    const el = document.createElement('textarea');
    el.value = debugText;
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand('copy');
      alert("Debug Info Copied!");
    } catch (e) { alert("Copy failed. Please select manually."); }
    document.body.removeChild(el);
  };

  if (!authChecked || !libLoaded) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center font-sans">
        <Loader2 className="animate-spin text-orange-500 w-12 h-12 mb-4" />
        <p className="font-black text-slate-400 uppercase tracking-tighter text-[10px]">VERIFYING_SYSTEM...</p>
      </div>
    );
  }

  // --- UI Parts ---
  const DebugPanel = () => (
    <div className={`fixed bottom-0 right-0 z-[100] w-full sm:w-80 bg-slate-900 text-[10px] text-slate-300 font-mono transition-transform border-t sm:border-l border-white/20 ${isDebugOpen ? 'translate-y-0' : 'translate-y-[calc(100%-36px)]'}`}>
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 cursor-pointer" onClick={() => setIsDebugOpen(!isDebugOpen)}>
        <span className="font-bold text-orange-500 flex items-center gap-2"><Bug size={12}/> DEBUG PANEL</span>
        {isDebugOpen ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}
      </div>
      <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto scrollbar-hide">
        <div className="grid grid-cols-2 gap-1 border-b border-white/5 pb-2">
          <span className="text-slate-500">VERSION:</span><span>{VERSION}</span>
          <span className="text-slate-500">AUTH_CHK:</span><span className={authChecked ? "text-green-500":"text-rose-500"}>{String(authChecked)}</span>
          <span className="text-slate-500">USER_UID:</span><span className="truncate">{user?.uid || 'null'}</span>
          <span className="text-slate-500">HOST:</span><span className="truncate">{window.location.hostname}</span>
          <span className="text-slate-500">COOKIES:</span><span>{String(navigator.cookieEnabled)}</span>
          <span className="text-slate-500">LS_STATUS:</span><span className={lsStatus === 'OK' ? "text-green-500":"text-rose-500"}>{lsStatus}</span>
        </div>
        <div className="space-y-1">
          <p className="text-slate-500 mt-2">REDIRECT_RESULT:</p>
          <p className={`pl-2 ${redirectResultLog.status === 'success' ? 'text-green-500' : 'text-amber-500'}`}>
            [{redirectResultLog.status}] {redirectResultLog.code}
          </p>
          <p className="pl-2 opacity-50">@{redirectResultLog.time}</p>
          
          <p className="text-slate-500 mt-2">LAST_AUTH_STATE_CHANGE:</p>
          <p className="pl-2 opacity-50">@{lastAuthEvent}</p>
          
          <p className="text-slate-500 mt-2">FIREBASE_CONFIG:</p>
          <p className="pl-2 truncate">Domain: {firebaseConfig?.authDomain}</p>
        </div>
        <button onClick={copyDebugData} className="w-full mt-4 py-2 bg-orange-600 text-white font-bold rounded flex items-center justify-center gap-2 hover:bg-orange-700 transition-colors"><Copy size={12}/> Copy Debug JSON</button>
      </div>
    </div>
  );

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-orange-100 relative overflow-x-hidden pb-20 sm:pb-0">
        
        <DebugPanel />

        {!user ? (
          <div className="min-h-screen flex flex-col items-center justify-center bg-white p-6 font-sans text-center">
            <div className="animate-in fade-in duration-700 max-w-sm">
              <div className="bg-orange-500 p-5 rounded-[2.5rem] text-white shadow-2xl mb-8 inline-block"><Store size={40} /></div>
              <h2 className="text-3xl font-black text-slate-800 mb-2 uppercase italic tracking-tighter">Gourmet Master</h2>
              <p className="text-slate-400 font-bold mb-10 text-sm leading-relaxed">美食リストを同期しましょう。</p>
              {authError && <div className="mb-6 p-4 bg-rose-50 text-rose-600 rounded-2xl text-[10px] font-bold border border-rose-100 flex items-center gap-2 text-left"><ShieldAlert className="shrink-0" size={16}/> {authError}</div>}
              <button onClick={startLogin} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black shadow-2xl hover:bg-slate-800 active:scale-95 transition-all flex items-center justify-center gap-3 text-lg">
                <Cloud size={24} /> Googleでログイン
              </button>
              <button onClick={() => { setCloudMode(false); setUser({uid: 'local-user-manual'}); }} className="mt-8 text-xs font-black text-slate-300 hover:text-orange-500 transition-colors tracking-widest uppercase">ログインせずに開始</button>
            </div>
          </div>
        ) : (
          <>
            <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200 h-16 md:h-20 flex items-center px-4 gap-4">
              <div className="flex items-center gap-3 shrink-0 cursor-pointer" onClick={() => setActiveTab('map')}>
                <div className="bg-orange-500 p-2.5 rounded-2xl text-white shadow-lg"><Store size={22} /></div>
                <h1 className="font-black text-xl tracking-tighter text-slate-800 uppercase hidden md:block italic">Gourmet<span className="text-orange-500">Master</span></h1>
              </div>
              <div className="flex-1 max-w-xl relative group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-orange-500 transition-colors" size={18} />
                <input type="text" placeholder="店名や住所で検索..." className="w-full pl-11 pr-4 py-2.5 bg-slate-100/80 border-none rounded-2xl text-sm md:text-base outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                 <div className={`p-2 rounded-full ${isSyncing ? 'text-orange-500 animate-spin' : 'text-slate-300'}`}><Cloud size={20} /></div>
                 <label className={`p-2.5 rounded-2xl shadow-xl transition-all active:scale-95 hidden sm:flex ${libLoaded && window.XLSX ? 'bg-slate-900 text-white cursor-pointer hover:bg-slate-800' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                   <Upload size={20} /><input type="file" className="hidden" accept=".csv, .xlsx" onChange={(e) => { if(!window.XLSX){alert("読込中"); return;} }} disabled={!(libLoaded && window.XLSX)} />
                 </label>
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
              {data.length === 0 ? (
                <div className="max-w-3xl mx-auto py-20 text-center bg-white p-12 rounded-[4rem] shadow-xl border border-slate-100">
                    <Database className="mx-auto text-orange-500 mb-8 opacity-20" size={80} />
                    <h2 className="text-4xl font-black mb-6 text-slate-800 tracking-tight italic uppercase">Import Required</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
                      <button onClick={() => saveData([{id:'sample-1',店舗名:"サンプル名店 銀座",住所:"東京都中央区銀座1-1-1",カテゴリ:"和食",都道府県:"東京都",isFavorite:true,NO:1}])} className="py-5 bg-orange-500 text-white rounded-[2rem] font-black shadow-xl hover:bg-orange-600 transition-all active:scale-95 text-lg italic tracking-widest uppercase">Sample Data</button>
                      <label className={`py-5 border-2 rounded-[2rem] font-black transition-all text-lg flex items-center justify-center gap-2 italic tracking-widest uppercase ${libLoaded && window.XLSX ? 'border-slate-200 text-slate-600 cursor-pointer hover:bg-slate-50' : 'border-slate-100 text-slate-300 cursor-not-allowed bg-slate-50'}`}>Upload CSV/XLSX<input type="file" className="hidden" accept=".csv, .xlsx" disabled={!(libLoaded && window.XLSX)} /></label>
                    </div>
                </div>
              ) : (
                <div className="space-y-16 animate-in fade-in duration-700 pb-32">
                  {activeTab === 'map' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                      {Object.keys(regions).map(reg => {
                        const count = data.filter(Boolean).filter(d => (regions[reg] || []).includes(d.都道府県)).length;
                        if (count === 0 && reg !== '関東') return null;
                        return (
                          <button key={reg} onClick={() => { setSelectedPrefecture('すべて'); setActiveTab('list'); }} className="group bg-white rounded-[2.5rem] p-8 text-left border border-slate-100 shadow-sm hover:shadow-2xl transition-all flex flex-col justify-between min-h-[190px] relative overflow-hidden active:scale-95">
                            <div className="absolute -top-4 -right-4 p-8 opacity-5 group-hover:opacity-10 group-hover:scale-125 transition-all rotate-12"><MapIcon size={120}/></div>
                            <div className="relative z-10"><p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-1">{reg} Area</p><h3 className="text-3xl font-black text-slate-800 group-hover:text-orange-600 transition-colors">{reg}</h3></div>
                            <div className="relative z-10 mt-6 flex items-center justify-between"><span className="text-sm font-black bg-slate-50 text-slate-500 px-4 py-1.5 rounded-full border border-slate-100 group-hover:bg-orange-50 group-hover:text-orange-600 transition-colors">{count} STORES</span><ChevronRight size={24} className="text-orange-500 -translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" /></div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {activeTab !== 'map' && (
                    <div className="flex flex-col lg:flex-row gap-10">
                      <aside className="lg:w-72 shrink-0 hidden lg:block">
                         <div className="bg-white p-7 rounded-[3rem] border border-slate-200 shadow-sm sticky top-44 space-y-7">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 border-b pb-4 italic"><ArrowDown size={14} className="text-orange-500" /> Genre Jump</p>
                          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto scrollbar-hide pr-2">
                            {groupedData.map(([category, stores]) => (
                              <button key={category} onClick={() => scrollToCategory(category)} className="w-full px-5 py-4 bg-slate-50 text-left rounded-2xl text-[10px] font-black text-slate-600 hover:bg-orange-50 hover:text-orange-600 transition-all flex items-center justify-between group active:scale-95 shadow-sm border border-transparent hover:border-orange-100 uppercase tracking-widest">
                                <span className="truncate">{category}</span><span className="bg-white text-slate-900 px-2 py-0.5 rounded shadow-sm">{stores.length}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </aside>
                      <div className="flex-1 space-y-20 min-w-0">
                        {groupedData.map(([category, stores]) => (
                          <div key={category} id={`category-section-${sanitizeId(category)}`} className="space-y-8 scroll-mt-44 animate-in slide-in-from-bottom-4">
                            <div className="flex items-center gap-5 px-2"><h3 className="text-2xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter italic"><Layers size={26} className="text-orange-500" /> {category}</h3><div className="flex-1 h-px bg-slate-200/60"></div><span className="bg-orange-500 text-white px-5 py-1.5 rounded-full text-[10px] font-black shadow-lg tracking-widest">{stores.length} ITEMS</span></div>
                            <div className={viewMode === 'detail' ? "grid grid-cols-1 md:grid-cols-2 gap-8" : "space-y-3"}>
                              {stores.map(store => (
                                <div key={store.id} className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200/50 overflow-hidden hover:shadow-2xl transition-all duration-500 flex flex-col group relative">
                                  <div className="relative h-60 overflow-hidden bg-slate-100">
                                    <img 
                                      src={store.imageURL && store.imageURL !== '' ? store.imageURL : `https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名||'').length + (store.カテゴリ?.length || 0)}`} 
                                      alt={store.店舗名} 
                                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" 
                                      onError={(e) => { if (e.currentTarget.dataset.fallback) return; e.currentTarget.dataset.fallback = "1"; e.currentTarget.src = `https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名||'').length + (store.カテゴリ?.length || 0)}`; }}
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent opacity-90 group-hover:opacity-60 transition-opacity"></div>
                                    <button onClick={() => toggleFavorite(store)} className={`absolute top-5 right-5 z-10 p-4 rounded-2xl backdrop-blur-md shadow-2xl transition-all active:scale-[1.5] ${store.isFavorite ? 'bg-rose-500 text-white' : 'bg-white/90 text-slate-300 hover:text-rose-500'}`}><Heart size={20} fill={store.isFavorite ? "currentColor" : "none"} /></button>
                                    <div className="absolute bottom-6 left-7 right-7 text-white pointer-events-none"><div className="flex items-center gap-2 mb-2"><span className="px-2 py-0.5 bg-orange-500/80 rounded text-[9px] font-black tracking-widest uppercase">#{store.NO}</span></div><h4 className="text-2xl font-black truncate drop-shadow-lg tracking-tight uppercase italic">{store.店舗名}</h4></div>
                                  </div>
                                  <div className="p-8 flex-1 flex flex-col font-bold text-sm text-slate-500 space-y-4 tracking-tight">
                                    <div className="flex items-start gap-4"><div className="bg-orange-50 p-2 rounded-xl text-orange-500 shrink-0 mt-0.5"><MapPin size={16} /></div><div className="pt-0.5"><p className="text-orange-600 text-[10px] font-black uppercase mb-1 tracking-widest">{store.都道府県} • {getSubArea(store.都道府県, store.住所)}</p><span className="line-clamp-2 leading-relaxed">{store.住所}</span></div></div>
                                    {store.URL && store.URL !== '' && store.URL !== 'Link' && (<a href={store.URL.startsWith('http') ? store.URL : `https://${store.URL}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-4 bg-blue-50 text-blue-600 rounded-2xl hover:bg-blue-600 hover:text-white transition-all group/link font-black text-center"><span className="truncate text-xs tracking-widest uppercase flex-1">Visit Website</span></a>)}
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
          </>
        )}
      </div>
    </ErrorBoundary>
  );
};

// --- App エクスポート ---
const App = () => (
  <GourmetApp />
);

export default App;