import React, { useState, useMemo, useEffect, Component } from 'react';
import { 
  Search, MapPin, ExternalLink, Plus, 
  Upload, Trash2, Edit2, X, Store, Heart, Save, 
  Loader2, Map as MapIcon, Grid, Database, 
  ChevronRight, Layers, ArrowDown, 
  Cloud, Copy, RefreshCcw, ShieldAlert, List,
  Filter, PieChart, Info, ImageIcon, Navigation, Bug, ChevronUp, ChevronDown, RotateCcw, Trash, ToggleLeft, ToggleRight, Key, Link as LinkIcon
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

const VERSION = "v3.49-AUTH-FIXED-PRO";

// --- A. ErrorBoundary ---
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white p-8 font-mono flex flex-col items-center justify-center text-center text-xs">
          <ShieldAlert size={48} className="text-rose-500 mb-4" />
          <h1 className="text-lg font-black uppercase tracking-tighter">System Error</h1>
          <p className="mt-2 text-rose-400 font-bold">{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} className="mt-6 px-6 py-3 bg-white text-slate-900 rounded-xl font-black uppercase shadow-2xl active:scale-95 transition-all">Reload Application</button>
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
    return "都内・その他";
  }
  const match = address.match(/^.*?[市郡区]/);
  return match ? match[0].replace(pref, "") : "主要エリア";
};

const sanitizeId = (text) => encodeURIComponent(text || '').replace(/%/g, '_').replace(/\./g, '_');

// --- 1. Firebase 設定ハイブリッド ---
let configSource = "none";
const getFirebaseConfig = () => {
  try {
    if (typeof __firebase_config !== 'undefined' && __firebase_config) {
      configSource = "runtime";
      return { firebaseConfig: JSON.parse(__firebase_config), isEnvConfig: true };
    }
    const env = import.meta.env || {};
    if (env.VITE_FIREBASE_API_KEY) {
      configSource = "env";
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
  const [authError, setAuthError] = useState(null);
  const [fsError, setFsError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('map');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPrefecture, setSelectedPrefecture] = useState('すべて');
  const [viewMode, setViewMode] = useState('detail');
  const [libLoaded, setLibLoaded] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0); // 修正: 定義漏れ
  const [isLocating, setIsLocating] = useState(false); // 修正: 定義漏れ

  // --- 診断用ステート ---
  const [shareKey, setShareKey] = useState(() => localStorage.getItem('gourmet_share_key') || '');
  const [logs, setLogs] = useState([]);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [envStatus, setEnvStatus] = useState({});
  const [loginAttempted, setLoginAttempted] = useState(() => localStorage.getItem('gourmet_login_attempt') === 'true');
  const [forcePopupForiOS, setForcePopupForiOS] = useState(() => localStorage.getItem('diag_force_popup') === 'true');
  const [redirectResultLog, setRedirectResultLog] = useState({ status: 'wait', code: '-' });
  const [conclusion, setConclusion] = useState("");
  const [returnWithoutParams, setReturnWithoutParams] = useState(false);

  const addLog = (event, value = "-") => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    setLogs(prev => [{ time, event, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }, ...prev].slice(0, 50));
  };

  const isMobile = useMemo(() => checkIsMobile(), []);
  
  // 現在の Firestore データパスを決定
  const firestoreCollectionPath = shareKey 
    ? `artifacts/${appId}/shared/${shareKey}/stores` 
    : user && !user.isAnonymous 
      ? `artifacts/${appId}/users/${user.uid}/stores`
      : null;

  useEffect(() => {
    localStorage.setItem('gourmet_share_key', shareKey);
    addLog("SHARE_KEY_UPDATED", shareKey || "none");
  }, [shareKey]);

  // 初期診断とリスナー設定
  useEffect(() => {
    const testStorage = (type) => { try { const key = `__t_${type}`; window[type].setItem(key, "1"); window[type].removeItem(key); return "OK"; } catch(e) { return "FAIL"; } };
    
    const runDiag = async () => {
      const ls = testStorage('localStorage');
      const ss = testStorage('sessionStorage');
      setEnvStatus({ ls, ss, cookies: navigator.cookieEnabled });

      const href = window.location.href;
      const oauthKeys = ["code", "state", "apiKey", "authType", "firebaseError", "__auth"].filter(k => href.includes(k));
      const hasOAuth = oauthKeys.length > 0;
      
      addLog("FIREBASE_APP_NAME", firebaseApp?.name || "null");
      addLog("AUTH_DOMAIN", firebaseConfig?.authDomain || "null");
      addLog("CONFIG_SOURCE", configSource);
      addLog("ORIGIN", window.location.origin);
      addLog("HREF_FULL", href);
      addLog("URL_OAUTH_KEYS", oauthKeys.join(",") || "none");

      const hasPending = (() => { try { return Object.keys(sessionStorage).some(k => k.includes('firebase:pendingRedirect')); } catch(e) { return false; } })();
      if (loginAttempted && hasPending && !hasOAuth) {
        setReturnWithoutParams(true);
        setConclusion("Safari環境でリダイレクトチェーンが断絶した可能性があります");
      }
    };
    runDiag();

    const pageshowHandler = (e) => {
      addLog("PAGESHOW", { persisted: e.persisted });
      if (auth) performGetRedirect();
    };
    window.addEventListener("pageshow", pageshowHandler);
    window.addEventListener("visibilitychange", () => addLog("VISIBILITY", document.visibilityState));
    
    return () => window.removeEventListener("pageshow", pageshowHandler);
  }, []);

  const performGetRedirect = () => {
    if (!auth) return;
    addLog("GET_REDIRECT_START");
    getRedirectResult(auth)
      .then((res) => {
        if (res?.user) {
          addLog("GET_REDIRECT_SUCCESS", res.user.uid);
          setRedirectResultLog({ status: 'success', code: 'OK' });
          setUser(res.user);
          localStorage.removeItem('gourmet_login_attempt');
          setLoginAttempted(false);
        } else {
          addLog("GET_REDIRECT_NO_RESULT");
          setRedirectResultLog({ status: 'no_result', code: '-' });
        }
      })
      .catch((err) => {
        addLog("GET_REDIRECT_ERROR", `${err.code}: ${err.message}`);
        setRedirectResultLog({ status: 'error', code: err.code });
        if (err.code.includes("domain")) setConclusion("設定起因（承認済みドメイン等の不一致）");
      });
  };

  // 認証監視（匿名認証への自動フォールバック含む）
  useEffect(() => {
    if (!cloudMode || !auth) {
      if (!cloudMode) setUser({ uid: 'local-user', isAnonymous: true });
      setAuthChecked(true);
      return;
    }

    const unsub = onAuthStateChanged(auth, async (u) => {
      addLog("AUTH_STATE_CHANGED", u ? `${u.uid} (Anon:${u.isAnonymous})` : "null");
      if (u) {
        setUser(u);
        setAuthChecked(true);
        localStorage.removeItem('gourmet_login_attempt');
        setLoginAttempted(false);
      } else {
        addLog("SIGN_IN_ANONYMOUSLY_START");
        try {
          const res = await signInAnonymously(auth);
          addLog("SIGN_IN_ANONYMOUSLY_SUCCESS", res.user.uid);
        } catch (e) {
          addLog("SIGN_IN_ANONYMOUSLY_ERROR", e.code);
          setAuthChecked(true);
        }
      }
    });

    performGetRedirect();

    return () => unsub();
  }, [cloudMode]);

  const startLogin = async () => {
    if (!auth) return;
    addLog("START_LOGIN_CLICKED");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    setAuthError(null);
    localStorage.setItem('gourmet_login_attempt', 'true');
    setLoginAttempted(true);

    try {
      addLog("SET_PERSISTENCE_START");
      await setPersistence(auth, browserLocalPersistence);
      addLog("SET_PERSISTENCE_SUCCESS");

      if (forcePopupForiOS || !isMobile) {
        addLog("SIGN_IN_POPUP_START");
        const res = await signInWithPopup(auth, provider);
        if (res?.user) {
          addLog("SIGN_IN_POPUP_SUCCESS", res.user.uid);
          setUser(res.user);
        }
      } else {
        addLog("SIGN_IN_REDIRECT_CALL");
        signInWithRedirect(auth, provider);
      }
    } catch (err) {
      addLog("LOGIN_EXEC_ERROR", err.code);
      setAuthError(`認証失敗: ${err.code}`);
    }
  };

  const hardSignOut = async () => {
    addLog("HARD_SIGNOUT_START");
    try {
      await signOut(auth);
      Object.keys(localStorage).forEach(k => { if(k.includes("firebase") || k.includes("gourmet")) localStorage.removeItem(k); });
      addLog("HARD_SIGNOUT_SUCCESS");
      window.location.reload();
    } catch(e) { addLog("HARD_SIGNOUT_FAIL", e.message); }
  };

  // --- データ購読ロジック ---
  useEffect(() => {
    if (!user || !firestoreCollectionPath) { loadLocalData(); return; }
    setIsSyncing(true);
    addLog("FIRESTORE_SUBSCRIBE", firestoreCollectionPath);
    const q = collection(db, firestoreCollectionPath);
    const unsub = onSnapshot(q, (snap) => {
      setData(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setIsSyncing(false);
    }, (err) => { console.error(err); setIsSyncing(false); loadLocalData(); });
    return () => unsub();
  }, [user, firestoreCollectionPath, syncTrigger]);

  const loadLocalData = () => {
    const saved = localStorage.getItem('gourmetStores');
    if (saved) setData(JSON.parse(saved));
  };

  const saveData = async (storesToSave) => {
    const safeStores = Array.isArray(storesToSave) ? storesToSave.filter(Boolean) : [];
    if (canUseCloud && firestoreCollectionPath) {
      setIsSyncing(true);
      try {
        const batch = writeBatch(db);
        safeStores.forEach(s => {
          const docId = s.id || `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_");
          const docRef = doc(db, firestoreCollectionPath, docId);
          batch.set(docRef, { ...s, id: docId }, { merge: true });
        });
        await batch.commit();
      } catch (e) { setFsError(`Save Error: ${e.code}`); }
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
    if (canUseCloud && firestoreCollectionPath) {
      await setDoc(doc(db, firestoreCollectionPath, store.id), { isFavorite: !store.isFavorite }, { merge: true });
    } else {
      const updated = data.map(d => d.id === store.id ? { ...d, isFavorite: !d.isFavorite } : d);
      setData(updated);
      localStorage.setItem('gourmetStores', JSON.stringify(updated));
    }
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
    return <div className="min-h-screen bg-white flex flex-col items-center justify-center font-sans">
      <Loader2 className="animate-spin text-orange-500 w-12 h-12 mb-4" />
      <p className="font-black text-slate-400 uppercase tracking-tighter text-[10px]">Verifying System...</p>
    </div>;
  }

  // DiagnosticPanel UI
  const DiagnosticPanel = () => (
    <div className={`fixed bottom-0 right-0 z-[100] w-full sm:w-96 bg-slate-900 text-[9px] text-slate-300 font-mono border-t sm:border-l border-white/20 transition-transform ${isDebugOpen ? 'translate-y-0 h-[75vh]' : 'translate-y-[calc(100%-36px)] h-auto'}`}>
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 cursor-pointer shadow-lg" onClick={() => setIsDebugOpen(!isDebugOpen)}>
        <span className="font-bold text-orange-500 flex items-center gap-2 uppercase tracking-widest"><Bug size={12}/> Diagnostic Panel ({VERSION})</span>
        {isDebugOpen ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}
      </div>
      <div className="p-4 space-y-4 overflow-y-auto h-full pb-20 scrollbar-hide">
        <div className="bg-black/40 p-3 rounded-xl border border-white/5 space-y-2">
           <div className="flex justify-between items-center text-slate-500 mb-1"><span>Settings & Status</span></div>
           <div className="space-y-1">
              <label className="text-[8px] text-orange-500/80 font-bold flex items-center gap-1 uppercase tracking-tighter"><Key size={8}/> 共有キー (Share Key)</label>
              <input type="text" value={shareKey} onChange={(e) => setShareKey(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))} placeholder="例: my-sync-key" className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white outline-none focus:border-orange-500/50" />
           </div>
           <div className="flex justify-between items-center pt-2 border-t border-white/5">
            <span>Force Popup (iOS):</span>
            <button onClick={() => { const v = !forcePopupForiOS; setForcePopupForiOS(v); localStorage.setItem('diag_force_popup', String(v)); }} className="text-orange-500">
              {forcePopupForiOS ? <ToggleRight size={20}/> : <ToggleLeft size={20}/>}
            </button>
          </div>
           <div className="pt-2 space-y-1 text-[8px] opacity-70">
             <div className="flex justify-between"><span>AUTH_MODE:</span><span>{user?.isAnonymous ? 'anonymous' : 'google'}</span></div>
             <div className="flex justify-between"><span>SYNC:</span><span>{shareKey ? 'cloud' : 'local'}</span></div>
             <div className="flex justify-between"><span>LS/SS:</span><span>{envStatus.ls}/{envStatus.ss}</span></div>
           </div>
        </div>

        {conclusion && (
          <div className="p-3 bg-indigo-900/40 border border-indigo-500/50 rounded-xl text-indigo-100 font-bold text-[9px] leading-tight">
            {conclusion}
          </div>
        )}

        {returnWithoutParams && (
          <div className="p-3 bg-amber-900/40 border border-amber-500/50 rounded-xl text-amber-100 text-[8px] leading-relaxed">
            <p className="font-bold flex items-center gap-1"><ShieldAlert size={10}/> リダイレクトチェーン断絶検知</p>
            Safari設定の「サイト越えトラッキング防止」を確認するか、Force Popupを使用してください。
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => window.location.reload()} className="py-2.5 bg-slate-700 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-slate-600"><RotateCcw size={12}/> Refresh</button>
          <button onClick={hardSignOut} className="py-2.5 bg-rose-900/60 rounded-lg font-bold flex items-center justify-center gap-2 text-rose-100 hover:bg-rose-900"><Trash size={12}/> Reset</button>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between items-center font-black text-slate-500 uppercase tracking-widest"><span>Timeline</span><button onClick={() => { const txt = logs.map(l => `[${l.time}] ${l.event}: ${l.value}`).join("\n"); const el = document.createElement('textarea'); el.value = txt; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el); alert("Log Copied!"); }} className="text-orange-500 text-[8px] hover:underline">COPY ALL</button></div>
          <div className="bg-black/60 rounded-xl p-3 border border-white/5 space-y-2 h-64 overflow-y-auto text-[8px] scrollbar-hide">
            {logs.map((l, i) => ( <div key={i} className="flex gap-2 last:mb-8 border-b border-white/5 pb-1"><span className="text-slate-600 shrink-0">{l.time}</span><span className="text-orange-400 font-black shrink-0">{l.event}</span><span className="text-slate-400 break-all">{l.value}</span></div> ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-orange-100 relative overflow-x-hidden pb-20 sm:pb-0">
      <DiagnosticPanel />

      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200 h-16 md:h-20 flex items-center px-4 gap-4">
        <div className="flex items-center gap-3 shrink-0 cursor-pointer" onClick={() => setActiveTab('map')}>
          <div className="bg-orange-500 p-2.5 rounded-2xl text-white shadow-lg"><Store size={22} /></div>
          <h1 className="font-black text-xl tracking-tighter text-slate-800 uppercase hidden md:block italic">Gourmet Master</h1>
        </div>
        <div className="flex-1 max-w-xl relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-orange-500 transition-colors" size={18} />
          <input type="text" placeholder="店名や住所で検索..." className="w-full pl-11 pr-4 py-2.5 bg-slate-100/80 border-none rounded-2xl text-sm md:text-base outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
           <div className={`p-2 rounded-full ${isSyncing ? 'text-orange-500 animate-spin' : 'text-slate-300'}`}><Cloud size={20} /></div>
           <label className="p-2.5 bg-slate-900 text-white rounded-2xl hover:bg-slate-800 cursor-pointer shadow-xl transition-all active:scale-95 hidden sm:flex"><Upload size={20} /><input type="file" className="hidden" accept=".csv, .xlsx" /></label>
           {(!user || user.isAnonymous) && (
             <button onClick={startLogin} className="p-2.5 bg-white border border-slate-200 text-slate-400 rounded-2xl hover:bg-slate-50 transition-all hidden sm:flex" title="Googleログイン"><LinkIcon size={20} /></button>
           )}
        </div>
      </header>

      <nav className="bg-white border-b sticky top-16 md:top-20 z-40 flex overflow-x-auto scrollbar-hide px-4 shadow-sm">
        {[ { id: 'map', label: 'AREA', icon: <MapIcon size={16} /> }, { id: 'list', label: 'LIST', icon: <Grid size={16} /> }, { id: 'favorites', label: 'HEART', icon: <Heart size={16} /> }].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-8 py-5 text-[10px] font-black tracking-widest transition-all shrink-0 ${activeTab === tab.id ? 'text-orange-600 border-b-4 border-orange-600' : 'text-slate-400 hover:text-slate-600 border-b-4 border-transparent'}`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8 min-h-screen">
        {activeTab === 'map' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in duration-700">
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
          <div className="flex flex-col lg:flex-row gap-10">
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
              {groupedData.length === 0 ? <div className="bg-white p-20 rounded-[3rem] text-center text-slate-300 font-black italic shadow-inner">お店が見つかりませんでした</div> : groupedData.map(([category, stores]) => (
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
                          <p className="line-clamp-2 leading-relaxed italic">{store.住所 || "住所情報がありません。"}</p>
                          <div className="flex gap-3 pt-4 border-t border-slate-50">
                            {store.URL && store.URL !== 'Link' && (<a href={store.URL.startsWith('http') ? store.URL : `https://${store.URL}`} target="_blank" rel="noopener noreferrer" className="flex-1 py-3 bg-orange-50 text-orange-600 rounded-xl hover:bg-orange-600 hover:text-white transition-all text-center text-[10px] font-black uppercase tracking-widest">Visit Website</a>)}
                            <button className="p-3 bg-slate-50 text-slate-300 hover:text-indigo-600 hover:bg-white rounded-xl transition-all shadow-inner"><Edit2 size={18}/></button>
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
      </main>

      {(!user || user.isAnonymous) && (
        <button onClick={startLogin} className="fixed bottom-12 right-12 sm:hidden w-20 h-20 bg-gradient-to-br from-orange-500 to-rose-500 text-white rounded-full shadow-2xl flex items-center justify-center z-[90] active:scale-125 transition-all shadow-orange-500/50"><Cloud size={40}/></button>
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