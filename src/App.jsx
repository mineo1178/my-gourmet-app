import React, { useState, useMemo, useEffect, Component } from 'react';
import { 
  Search, MapPin, ExternalLink, Plus, 
  Upload, Trash2, Edit2, X, Store, Heart, Save, 
  Loader2, Map as MapIcon, Grid, Database, 
  ChevronRight, Layers, ArrowDown, 
  Cloud, Copy, RefreshCcw, ShieldAlert, List,
  Filter, PieChart, Info, ImageIcon, Navigation, Bug, ChevronUp, ChevronDown, Clock, Terminal, RotateCcw, Trash
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
  signOut
} from 'firebase/auth';

const VERSION = "v3.39-AUTH-FIXED";

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
        <div className="min-h-screen bg-slate-900 text-white p-8 font-mono overflow-auto flex flex-col items-center justify-center text-center text-xs">
          <ShieldAlert size={48} className="text-rose-500 mx-auto mb-4" />
          <h1 className="text-lg font-black uppercase">Critical Crash</h1>
          <p className="mt-2 text-rose-400">{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} className="mt-6 px-6 py-3 bg-white text-slate-900 rounded-xl font-bold">Reload</button>
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
  } catch (e) { console.error("FIREBASE_INIT_CRASH", e); }
}

const canUseCloud = Boolean(isEnvConfig && auth && db);

const checkIsMobile = () => {
  if (typeof navigator === 'undefined') return false;
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

  // Auth Timeline ログシステム
  const [logs, setLogs] = useState([]);
  const addLog = (event, value = "-") => {
    const time = new Date().toLocaleTimeString([], { hour12: false }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    const entry = { time, event, value: typeof value === 'object' ? JSON.stringify(value) : String(value) };
    setLogs(prev => [entry, ...prev].slice(0, 50));
    console.log(`[${time}] ${event}:`, value);
  };

  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [redirectLog, setRedirectLog] = useState({ status: 'wait', code: '-' });
  const [envStatus, setEnvStatus] = useState({});

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPrefecture, setSelectedPrefecture] = useState('すべて');
  const [viewMode, setViewMode] = useState('detail'); 
  const [activeTab, setActiveTab] = useState('map'); 
  const [editingStore, setEditingStore] = useState(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  const isMobileDevice = useMemo(() => checkIsMobile(), []);
  const firestorePath = user?.uid ? `artifacts/${appId}/users/${user.uid}/stores` : 'N/A';

  // 環境判定
  useEffect(() => {
    const status = {
      cookies: navigator.cookieEnabled,
      secure: window.isSecureContext,
      ls: false,
      idb: false,
    };
    try {
      localStorage.setItem("__test", "1");
      localStorage.removeItem("__test");
      status.ls = true;
    } catch(e) {}
    
    try {
      const req = indexedDB.open("__test_idb");
      req.onsuccess = () => { status.idb = true; setEnvStatus({...status}); };
      req.onerror = () => { status.idb = false; setEnvStatus({...status}); };
    } catch(e) { status.idb = false; setEnvStatus({...status}); }
    
    setEnvStatus(status);
    addLog("PAGE_LOAD", { href: window.location.href, ref: document.referrer, ua: navigator.userAgent });
  }, []);

  const scrollToCategory = (id) => {
    const safeId = sanitizeId(id);
    const el = document.getElementById(`category-section-${safeId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => { setLibLoaded(true); addLog("XLSX_LOADED"); };
    script.onerror = () => { setLibLoaded(true); addLog("XLSX_FAILED"); }; 
    document.head.appendChild(script);
    setTimeout(() => { if(!window.XLSX) { setLibLoaded(true); addLog("XLSX_TIMEOUT"); } }, 4000);
  }, []);

  // 認証・リダイレクト詳細ログ
  useEffect(() => {
    let unsubAuth = null;
    let isMounted = true;

    if (cloudMode && canUseCloud) {
      addLog("GET_REDIRECT_START");
      getRedirectResult(auth)
        .then((res) => { 
          if (res?.user && isMounted) {
            addLog("GET_REDIRECT_SUCCESS", { uid: res.user.uid, email: res.user.email });
            setRedirectLog({ status: 'success', code: 'OK' });
            setUser(res.user); 
          } else {
            addLog("GET_REDIRECT_NO_RESULT");
            setRedirectLog({ status: 'no_result', code: '-' });
          }
        })
        .catch((err) => {
          if (isMounted) {
            addLog("GET_REDIRECT_ERROR", { code: err.code, msg: err.message });
            setRedirectLog({ status: 'error', code: err.code });
            setAuthError(`Auth Error: ${err.code}`);
            setNeedsLogin(true);
            setAuthChecked(true);
          }
        });

      unsubAuth = onAuthStateChanged(auth, (u) => { 
        if (!isMounted) return;
        addLog("AUTH_STATE_CHANGED", u ? { uid: u.uid, providers: u.providerData?.map(p => p.providerId) } : "null");
        if (!u) { setNeedsLogin(true); setUser(null); } 
        else { setNeedsLogin(false); setUser(u); }
        setAuthChecked(true);
      });

      // 遅延チェック (Safariセッション復元漏れ対策)
      [1000, 3000, 5000].forEach(ms => {
        setTimeout(() => {
          if(isMounted) addLog(`DELAYED_CHECK_${ms}ms`, auth.currentUser ? auth.currentUser.uid : "null");
        }, ms);
      });

    } else {
      if (isMounted) { 
        addLog("LOCAL_MODE_START");
        setNeedsLogin(false); 
        setUser({ uid: 'local-user-static' }); 
        setAuthChecked(true); 
      }
    }
    return () => { isMounted = false; if (typeof unsubAuth === "function") unsubAuth(); };
  }, [cloudMode]);

  const startLogin = async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    setAuthError(null);
    addLog("START_LOGIN_CLICKED");
    try {
      addLog("SET_PERSISTENCE_START");
      await setPersistence(auth, browserLocalPersistence);
      addLog("SET_PERSISTENCE_SUCCESS");

      if (isMobileDevice) {
        addLog("SIGN_IN_REDIRECT_CALL");
        await signInWithRedirect(auth, provider);
      } else {
        addLog("SIGN_IN_POPUP_CALL");
        const res = await signInWithPopup(auth, provider);
        if (res?.user) {
          addLog("SIGN_IN_POPUP_SUCCESS", res.user.uid);
          setUser(res.user); 
        }
      }
    } catch (err) {
      addLog("LOGIN_EXEC_ERROR", err.code);
      setAuthError(`認証失敗: ${err.code}`);
      setNeedsLogin(true);
    }
  };

  const forceReloadNoCache = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("t", Date.now().toString());
    window.location.href = url.toString();
  };

  const hardSignOut = async () => {
    addLog("HARD_SIGNOUT_START");
    try {
      await signOut(auth);
      Object.keys(localStorage).forEach(key => {
        if(key.includes("firebase")) localStorage.removeItem(key);
      });
      addLog("HARD_SIGNOUT_SUCCESS");
      forceReloadNoCache();
    } catch(e) { addLog("HARD_SIGNOUT_FAIL", e.message); }
  };

  // 統計データ用メモ
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

  // フィルタ済みデータ用メモ
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

  // グループ化データ用メモ
  const groupedData = useMemo(() => {
    const groups = {};
    filteredData.forEach(i => {
      const c = i.カテゴリ || '未分類';
      if (!groups[c]) groups[c] = [];
      groups[c].push(i);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filteredData]);

  // データ同期ロジック
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
      } catch (e) { console.error(e); }
    } else { loadLocalData(); }
    return () => { if (typeof unsubSnapshot === "function") unsubSnapshot(); };
  }, [user, cloudMode, syncTrigger]);

  const loadLocalData = () => {
    try {
      const saved = localStorage.getItem('gourmetStores');
      if (saved) setData(JSON.parse(saved));
    } catch (e) {}
  };

  const saveData = async (storesToSave) => {
    const safeStores = Array.isArray(storesToSave) ? storesToSave.filter(Boolean) : [];
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
      ls: lsStatus,
      cloud: { canUseCloud, cloudMode, appId },
      user: user ? { uid: user.uid } : null,
      timeline: logs
    }, null, 2);
    const el = document.createElement('textarea'); el.value = debugText; document.body.appendChild(el); el.select();
    document.execCommand('copy'); document.body.removeChild(el);
    alert("Debug Log Copied!");
  };

  if (!authChecked || !libLoaded) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center font-sans">
        <Loader2 className="animate-spin text-orange-500 w-12 h-12 mb-4" />
        <p className="font-black text-slate-400 uppercase tracking-tighter text-[10px]">VERIFYING_SYSTEM...</p>
      </div>
    );
  }

  // デバッグパネルUI
  const DebugPanel = () => (
    <div className={`fixed bottom-0 right-0 z-[100] w-full sm:w-96 bg-slate-900 text-[10px] text-slate-300 font-mono transition-transform border-t sm:border-l border-white/20 shadow-2xl overflow-hidden flex flex-col ${isDebugOpen ? 'translate-y-0 h-[80vh]' : 'translate-y-[calc(100%-36px)] h-auto'}`}>
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 cursor-pointer shrink-0" onClick={() => setIsDebugOpen(!isDebugOpen)}>
        <span className="font-bold text-orange-500 flex items-center gap-2"><Bug size={12}/> DIAGNOSTIC SYSTEM</span>
        {isDebugOpen ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
        <div className="bg-black/40 p-3 rounded-xl border border-white/5 space-y-1">
          <div className="flex justify-between"><span>Cookies:</span><span>{String(envStatus.cookies)}</span></div>
          <div className="flex justify-between"><span>LocalStorage:</span><span className={envStatus.ls ? "text-green-500":"text-rose-500"}>{envStatus.ls?"OK":"FAIL"}</span></div>
          <div className="flex justify-between"><span>IndexedDB:</span><span className={envStatus.idb ? "text-green-500":"text-rose-500"}>{envStatus.idb?"OK":"FAIL"}</span></div>
        </div>
        {redirectLog.status === 'no_result' && !user && (
          <div className="p-3 bg-amber-900/40 border border-amber-500/50 rounded-xl text-amber-200">
            <p className="font-bold underline mb-1 italic">Check Authorized Domains</p>
            <p>リダイレクト結果がありません。ドメイン <b>{window.location.hostname}</b> を許可設定してください。</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={forceReloadNoCache} className="py-2 bg-slate-700 rounded font-bold flex items-center justify-center gap-1"><RotateCcw size={10}/> Reload</button>
          <button onClick={hardSignOut} className="py-2 bg-rose-900/60 rounded font-bold flex items-center justify-center gap-1 text-rose-200"><Trash size={10}/> SignOut</button>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between items-center"><p className="text-slate-500 uppercase tracking-widest">Auth Timeline</p><button onClick={copyDebugData} className="text-orange-500 text-[8px] hover:underline">COPY ALL</button></div>
          <div className="bg-black/60 rounded-xl p-3 border border-white/5 space-y-2 h-64 overflow-y-auto scrollbar-hide text-[9px]">
            {logs.map((log, i) => (
              <div key={i} className="flex gap-2 items-start border-b border-white/5 pb-1 last:border-0">
                <span className="text-slate-600 shrink-0">{log.time}</span>
                <span className="text-orange-400 font-bold shrink-0">{log.event}</span>
                <span className="text-slate-400 break-all">{log.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-orange-100 relative overflow-x-hidden pb-20 sm:pb-0">
      <DebugPanel />
      {!user ? (
        <div className="min-h-screen flex flex-col items-center justify-center bg-white p-6 font-sans text-center">
          <div className="animate-in fade-in duration-700 max-w-sm">
            <div className="bg-orange-500 p-5 rounded-[2.5rem] text-white shadow-2xl mb-8 inline-block"><Store size={40} /></div>
            <h2 className="text-3xl font-black text-slate-800 mb-2 uppercase italic tracking-tighter">Gourmet Master</h2>
            {authError && <div className="mb-6 p-4 bg-rose-50 text-rose-600 rounded-2xl text-[10px] font-bold border border-rose-100 flex items-center gap-2 text-left"><ShieldAlert className="shrink-0" size={16}/> {authError}</div>}
            <button onClick={startLogin} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black shadow-2xl hover:bg-slate-800 active:scale-95 transition-all flex items-center justify-center gap-3 text-lg"><Cloud size={24} /> Googleでログイン</button>
            <button onClick={() => { setCloudMode(false); setUser({uid: 'local-user-manual'}); }} className="mt-8 text-xs font-black text-slate-300 hover:text-orange-500 transition-colors tracking-widest uppercase">ログインせずに開始</button>
          </div>
        </div>
      ) : (
        <>
          <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200 h-16 md:h-20 flex items-center px-4 gap-4">
            <div className="flex items-center gap-3 shrink-0 cursor-pointer" onClick={() => setActiveTab('map')}>
              <div className="bg-orange-500 p-2.5 rounded-2xl text-white shadow-lg"><Store size={22} /></div>
              <h1 className="font-black text-xl tracking-tighter text-slate-800 uppercase hidden md:block italic">Gourmet Master</h1>
            </div>
            <div className="flex-1 max-w-xl relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-orange-500 transition-colors" size={18} />
              <input type="text" placeholder="店名や住所で検索..." className="w-full pl-11 pr-4 py-2.5 bg-slate-100/80 border-none rounded-2xl text-sm md:text-base outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
          </header>

          <nav className="bg-white border-b sticky top-16 md:top-20 z-40 flex overflow-x-auto scrollbar-hide px-4 shadow-sm">
            {[ { id: 'map', label: 'AREA', icon: <MapIcon size={16} /> }, { id: 'list', label: 'LIST', icon: <Grid size={16} /> }, { id: 'favorites', label: 'HEART', icon: <Heart size={16} /> }].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-8 py-5 text-[10px] font-black tracking-widest transition-all shrink-0 ${activeTab === tab.id ? 'text-orange-600 border-b-4 border-orange-600' : 'text-slate-400 hover:text-slate-600'}`}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </nav>

          <main className="max-w-7xl mx-auto p-4 md:p-8 min-h-screen pb-32">
            {groupedData.map(([category, stores]) => (
              <div key={category} id={`category-section-${sanitizeId(category)}`} className="space-y-8 mb-16 scroll-mt-44 animate-in slide-in-from-bottom-4">
                <div className="flex items-center gap-5 px-2"><h3 className="text-2xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter italic"><Layers size={26} className="text-orange-500" /> {category}</h3><div className="flex-1 h-px bg-slate-200/60"></div><span className="bg-orange-500 text-white px-5 py-1.5 rounded-full text-[10px] font-black shadow-lg tracking-widest">{stores.length} ITEMS</span></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {stores.map(store => (
                    <div key={store.id} className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200/50 overflow-hidden hover:shadow-2xl transition-all duration-500 flex flex-col group relative">
                      <div className="relative h-60 overflow-hidden bg-slate-100">
                        <img 
                          src={store.imageURL && store.imageURL !== '' ? store.imageURL : `https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名||'').length}`} 
                          alt={store.店舗名} 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" 
                          onError={(e) => { if (e.currentTarget.dataset.fallback) return; e.currentTarget.dataset.fallback = "1"; e.currentTarget.src = `https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名||'').length}`; }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent opacity-90 group-hover:opacity-60 transition-opacity"></div>
                        <button onClick={() => toggleFavorite(store)} className={`absolute top-5 right-5 z-10 p-4 rounded-2xl backdrop-blur-md shadow-2xl transition-all active:scale-[1.5] ${store.isFavorite ? 'bg-rose-500 text-white' : 'bg-white/90 text-slate-300 hover:text-rose-500'}`}><Heart size={20} fill={store.isFavorite ? "currentColor" : "none"} /></button>
                        <div className="absolute bottom-6 left-7 right-7 text-white pointer-events-none"><div className="flex items-center gap-2 mb-2"><span className="px-2 py-0.5 bg-orange-500/80 rounded text-[9px] font-black tracking-widest uppercase">#{store.NO}</span></div><h4 className="text-2xl font-black truncate drop-shadow-lg tracking-tight uppercase italic">{store.店舗名}</h4></div>
                      </div>
                      <div className="p-8 flex-1 flex flex-col font-bold text-sm text-slate-500 space-y-4 tracking-tight">
                        <div className="flex items-start gap-4"><div className="bg-orange-50 p-2 rounded-xl text-orange-500 shrink-0 mt-0.5"><MapPin size={16} /></div><div className="pt-0.5"><p className="text-orange-600 text-[10px] font-black uppercase mb-1 tracking-widest">{store.都道府県} • {getSubArea(store.都道府県, store.住所)}</p><span className="line-clamp-2 leading-relaxed">{store.住所}</span></div></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </main>
        </>
      )}
    </div>
  );
};

const App = () => (
  <ErrorBoundary>
    <GourmetApp />
  </ErrorBoundary>
);

export default App;