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

const VERSION = "v3.41-AUTH-iOS-STABLE";

// --- A. ErrorBoundary ---
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return <div className="p-8 text-center text-xs font-mono bg-slate-900 text-white min-h-screen flex flex-col justify-center">
        <ShieldAlert size={48} className="text-rose-500 mx-auto mb-4" />
        <p className="text-rose-400">{this.state.error?.message}</p>
        <button onClick={() => window.location.reload()} className="mt-6 px-4 py-2 bg-white text-black rounded font-bold">Reload</button>
      </div>;
    }
    return this.props.children;
  }
}

// --- 1. Firebase 設定と初期化 ---
const getFirebaseConfig = () => {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    return { firebaseConfig: JSON.parse(__firebase_config), isEnvConfig: true };
  }
  return { firebaseConfig: null, isEnvConfig: false };
};

const { firebaseConfig, isEnvConfig } = getFirebaseConfig();
const appId = typeof __app_id !== 'undefined' ? __app_id : 'gourmet-master-v1';

let auth = null;
let db = null;

if (isEnvConfig && firebaseConfig?.apiKey) {
  try {
    const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    // 指示1: 永続化設定は初期化時に一度だけ実行（UIスレッドをブロックしない）
    setPersistence(auth, browserLocalPersistence);
  } catch (e) { console.error("INIT_ERR", e); }
}

const canUseCloud = Boolean(auth && db);
const checkIsMobile = () => /iPhone|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));

const GourmetApp = () => {
  const [data, setData] = useState([]);
  const [user, setUser] = useState(null);
  const [cloudMode, setCloudMode] = useState(canUseCloud);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [activeTab, setActiveTab] = useState('map');
  const [logs, setLogs] = useState([]);

  const addLog = (event, value = "-") => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [{ time, event, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }, ...prev].slice(0, 50));
  };

  const isMobile = useMemo(() => checkIsMobile(), []);

  // --- 指示2: ページロード時の挙動改善 ---
  useEffect(() => {
    if (!auth || !cloudMode) {
      if (!cloudMode) setUser({ uid: 'local-user' });
      setAuthChecked(true);
      return;
    }

    const href = window.location.href;
    addLog("AFTER_RETURN_HREF", href);
    const hasOAuth = href.includes("code=") || href.includes("state=") || href.includes("__auth") || href.includes("apiKey");
    addLog("HAS_OAUTH_PARAMS", String(hasOAuth));

    // リダイレクト結果の回収
    addLog("GET_REDIRECT_START");
    getRedirectResult(auth)
      .then((res) => {
        if (res?.user) {
          addLog("GET_REDIRECT_SUCCESS", res.user.uid);
          setUser(res.user);
          localStorage.removeItem('gourmet_login_attempt');
        } else {
          addLog("GET_REDIRECT_NO_RESULT");
        }
      })
      .catch((err) => {
        addLog("GET_REDIRECT_ERROR", err.code);
        setAuthError(`Auth Error: ${err.code}`);
      });

    // 認証状態の監視
    const unsub = onAuthStateChanged(auth, (u) => {
      addLog("AUTH_STATE_CHANGED", u ? u.uid : "null");
      if (u) {
        setUser(u);
        setNeedsLogin(false);
      } else {
        setNeedsLogin(true);
        setUser(null);
      }
      setAuthChecked(true);
    });

    return () => unsub();
  }, [cloudMode]);

  // --- 指示3: ユーザー操作直後のリダイレクト実行 ---
  const startLogin = () => {
    if (!auth) return;
    addLog("START_LOGIN_CLICKED");
    
    const provider = new GoogleAuthProvider();
    setAuthError(null);
    localStorage.setItem('gourmet_login_attempt', 'true');

    try {
      // await を一切挟まず、即座にリダイレクトを発火させる
      if (isMobile) {
        addLog("SIGN_IN_REDIRECT_CALL");
        signInWithRedirect(auth, provider);
      } else {
        addLog("SIGN_IN_POPUP_CALL");
        signInWithPopup(auth, provider).then(res => {
          if (res?.user) setUser(res.user);
        });
      }
    } catch (err) {
      addLog("LOGIN_EXEC_ERROR", err.code);
      setAuthError(`認証失敗: ${err.code}`);
    }
  };

  // --- 以下、既存のデータ処理ロジック ---
  useEffect(() => {
    if (!user || user.uid.startsWith('local')) return;
    const storesCol = collection(db, 'artifacts', appId, 'public', 'data', 'stores');
    const unsub = onSnapshot(storesCol, (snap) => {
      setData(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error(err));
    return () => unsub();
  }, [user]);

  if (!authChecked) {
    return <div className="min-h-screen flex flex-col items-center justify-center font-mono">
      <Loader2 className="animate-spin text-orange-500 mb-4" />
      <p className="text-[10px] uppercase font-black">Connecting...</p>
    </div>;
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-orange-100 pb-20 overflow-x-hidden">
      {/* Auth Timeline Panel */}
      <div className="fixed top-0 left-0 right-0 z-[100] bg-slate-900/90 backdrop-blur text-[9px] text-slate-400 font-mono border-b border-white/10 max-h-40 overflow-y-auto p-2 scrollbar-hide">
        <div className="flex justify-between items-center mb-1 text-orange-500 font-bold border-b border-white/5 pb-1">
          <span>AUTH TIMELINE ({VERSION})</span>
          <button onClick={() => {
            const txt = logs.map(l => `[${l.time}] ${l.event}: ${l.value}`).join("\n");
            const el = document.createElement('textarea'); el.value = txt; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
            alert("Copied");
          }} className="bg-white/10 px-2 py-0.5 rounded">COPY</button>
        </div>
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2 leading-relaxed">
            <span className="opacity-50">{l.time}</span>
            <span className="text-slate-200 font-bold">{l.event}</span>
            <span className="truncate max-w-[200px]">{l.value}</span>
          </div>
        ))}
      </div>

      {!user ? (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-orange-500 p-5 rounded-[2.5rem] text-white shadow-2xl mb-8"><Store size={40} /></div>
          <h2 className="text-3xl font-black text-slate-800 mb-2 italic">Gourmet Master</h2>
          {authError && <div className="my-4 p-4 bg-rose-50 text-rose-600 rounded-2xl text-[10px] font-bold border border-rose-100">{authError}</div>}
          <button onClick={startLogin} className="w-full max-w-xs py-5 bg-slate-900 text-white rounded-3xl font-black shadow-xl flex items-center justify-center gap-3 text-lg hover:bg-slate-800 active:scale-95 transition-all">
            <Cloud size={24} /> Googleでログイン
          </button>
        </div>
      ) : (
        <div className="p-4 pt-44">
           <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm text-center">
              <h3 className="font-black text-xl mb-4">ログイン完了</h3>
              <p className="text-xs text-slate-400 mb-6">UID: {user.uid}</p>
              <button onClick={() => signOut(auth)} className="px-6 py-3 bg-slate-100 text-slate-600 rounded-2xl font-bold text-xs">ログアウト</button>
           </div>
        </div>
      )}
    </div>
  );
};

const App = () => <ErrorBoundary><GourmetApp /></ErrorBoundary>;
export default App;