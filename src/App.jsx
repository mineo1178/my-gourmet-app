import React, { useState, useMemo, useEffect, Component } from 'react';
import { 
  Search, MapPin, ExternalLink, Plus, 
  Upload, Trash2, Edit2, X, Store, Heart, Save, 
  Loader2, Map as MapIcon, Grid, Database, 
  ChevronRight, Layers, ArrowDown, 
  Cloud, Copy, RefreshCcw, ShieldAlert
} from 'lucide-react';

// Firebase SDK インポート
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, doc, setDoc, onSnapshot, 
  deleteDoc
} from 'firebase/firestore';
import { 
  getAuth, 
  onAuthStateChanged, 
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  getRedirectResult,
  setPersistence, // ③ 追加
  browserLocalPersistence // ③ 追加
} from 'firebase/auth';

const VERSION = "v3.20-AUTH-STABLE";

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
            <div className="p-5 bg-black/50 rounded-2xl border border-white/5 text-left space-y-2">
              <p className="text-rose-400 font-bold text-xs">Error: {this.state.error?.message || "Render Error"}</p>
              <div className="text-[10px] text-slate-500 border-t border-white/5 pt-2 mt-2">
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
    // ③ 永続化を明示
    setPersistence(auth, browserLocalPersistence).catch(console.error);
    db = getFirestore(firebaseApp);
  } catch (e) { console.error("FIREBASE_INIT_CRASH", e); }
}

const canUseCloud = Boolean(isEnvConfig && auth && db);

const checkIsMobile = () => {
  if (typeof navigator === 'undefined') return false;
  if (navigator.userAgentData?.mobile) return true;
  const ua = navigator.userAgent;
  return /iPhone|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua));
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
  const [authChecked, setAuthChecked] = useState(false); // ② 追加
  const [syncTrigger, setSyncTrigger] = useState(0);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPrefecture, setSelectedPrefecture] = useState('すべて');
  const [viewMode, setViewMode] = useState('detail'); 
  const [activeTab, setActiveTab] = useState('map'); 
  const [editingStore, setEditingStore] = useState(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  const isMobileDevice = useMemo(() => checkIsMobile(), []);
  const firestorePath = user?.uid ? `artifacts/${appId}/users/${user.uid}/stores` : 'N/A';

  const scrollToCategory = (id) => {
    const safeId = sanitizeId(id);
    const el = document.getElementById(`category-section-${safeId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // XLSX / CSV ローダー
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

  // ② 認証 useEffect 修正
  useEffect(() => {
    let unsubAuth = null;
    let isMounted = true;

    if (cloudMode && canUseCloud) {
      // リダイレクト結果の拾い上げ
      getRedirectResult(auth)
        .then((res) => { 
          if (res?.user && isMounted) console.log("Login Success via Redirect Result");
        })
        .catch((err) => {
          if (isMounted) {
            setAuthError(`Auth Error: ${err.code}`);
            setNeedsLogin(true);
            setAuthChecked(true); // エラーでもチェック完了
          }
        });

      // 認証状態の監視
      unsubAuth = onAuthStateChanged(auth, (u) => { 
        if (!isMounted) return;
        if (!u) { 
          setNeedsLogin(true); 
          setUser(null);
        } else { 
          setNeedsLogin(false);
          setUser(u); 
        }
        // 状態が確定したのでフラグを立てる
        setAuthChecked(true);
      });
    } else {
      if (isMounted) { 
        setNeedsLogin(false); 
        setUser({ uid: 'local-user-static' }); 
        setAuthChecked(true); // ローカルモードでもチェック完了
      }
    }
    return () => { isMounted = false; if (typeof unsubAuth === "function") unsubAuth(); };
  }, [cloudMode, syncTrigger]);

  const startLogin = async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    setAuthError(null);
    try {
      if (isMobileDevice) await signInWithRedirect(auth, provider);
      else await signInWithPopup(auth, provider);
    } catch (err) {
      setAuthError(`認証失敗: ${err.code}`);
      setNeedsLogin(true);
    }
  };

  // 同期
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
    const newDataMap = new Map(data.map(item => [item.id, item]));
    storesToSave.forEach(s => {
      const docId = s.id || `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_");
      newDataMap.set(docId, { ...s, id: docId });
    });
    const allData = Array.from(newDataMap.values());
    if (canUseCloud && cloudMode && db && user && !user.uid.startsWith('local-user')) {
      setIsSyncing(true);
      try {
        for (const store of storesToSave) {
          const docId = store.id || `${store.店舗名}-${store.住所}`.replace(/[.#$/[\]]/g, "_");
          await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'stores', docId), { ...store, id: docId }, { merge: true });
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
      const updated = data.map(item => item.id === store.id ? { ...item, isFavorite: !item.isFavorite } : item);
      setData(updated);
      localStorage.setItem('gourmetStores', JSON.stringify(updated));
    }
  };

  const deleteData = async (id) => {
    if (!window.confirm("削除しますか？")) return;
    if (canUseCloud && cloudMode && db && user && !user.uid.startsWith('local-user')) {
      try { await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'stores', id)); } catch (e) { setFsError(`Delete Error: ${e.code}`); }
    } else {
      const filtered = data.filter(item => item.id !== id);
      setData(filtered);
      localStorage.setItem('gourmetStores', JSON.stringify(filtered));
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
          id: `${item.店舗名 || 'no-name'}-${item.住所 || index}`.replace(/[.#$/[\]]/g, "_"),
          NO: item.NO || (data.length + index + 1),
          店舗名: item.店舗名 || item['店舗名'] || '不明な店舗',
          カテゴリ: item.カテゴリ || item['カテゴリ'] || '飲食店',
          都道府県: item.都道府県 || item['都道府県'] || '',
          住所: item.住所 || item['住所'] || '',
          URL: item.URL || item['URL'] || '',
          isFavorite: false
        }));
        saveData(normalized);
        setActiveTab('list');
      } catch (err) { alert("データ解析に失敗しました。"); }
    };
    reader.readAsArrayBuffer(file);
  };

  const filteredData = useMemo(() => {
    let res = data;
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

  // ② 表示制御: 認証チェックが終わるまでスピナー
  if (!authChecked || !libLoaded) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center font-sans">
        <Loader2 className="animate-spin text-orange-500 w-12 h-12 mb-4" />
        <p className="font-black text-slate-400 uppercase tracking-tighter text-[10px]">
          {!libLoaded ? "LOADING_ENGINE..." : "VERIFYING_AUTH_STATE..."}
        </p>
      </div>
    );
  }

  // 認証チェック完了後、ユーザーがいない場合はログイン画面
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white p-6 font-sans">
        <div className="animate-in fade-in duration-700 max-w-sm text-center">
          <div className="bg-orange-500 p-5 rounded-[2.5rem] text-white shadow-2xl mb-8 inline-block"><Store size={40} /></div>
          <h2 className="text-3xl font-black text-slate-800 mb-2 uppercase italic tracking-tighter">Gourmet Master</h2>
          <p className="text-slate-400 font-bold mb-10 text-sm leading-relaxed">美食リストをクラウド同期・共有管理します。</p>
          {authError && <div className="mb-6 p-4 bg-rose-50 text-rose-600 rounded-2xl text-[10px] font-bold border border-rose-100 flex items-center gap-2"><ShieldAlert className="shrink-0" size={16}/> {authError}</div>}
          <button onClick={startLogin} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black shadow-2xl hover:bg-slate-800 active:scale-95 transition-all flex items-center justify-center gap-3 text-lg">
            <Cloud size={24} /> Googleでログイン
          </button>
          <button onClick={() => { setCloudMode(false); setUser({uid: 'local-user-manual'}); }} className="mt-8 text-xs font-black text-slate-300 hover:text-orange-500 transition-colors tracking-widest uppercase">ログインせずに開始</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-orange-100 relative overflow-x-hidden pb-20 sm:pb-0">
      {/* デバッグバー */}
      <div className="fixed bottom-4 left-4 right-4 z-[100] flex pointer-events-none justify-end">
        <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-xl text-[8px] font-mono text-white/50 px-4 py-2 rounded-full shadow-2xl flex items-center gap-4 border border-white/5 whitespace-nowrap overflow-x-auto scrollbar-hide">
          <span className="text-orange-500 font-black">{VERSION}</span>
          <span>MODE: <span className={canUseCloud && cloudMode ? "text-green-400" : "text-amber-400"}>{canUseCloud && cloudMode ? "CLOUD" : "LOCAL"}</span></span>
          <span className="hidden md:inline">UID: {user.uid.slice(0, 12)}...</span>
          <button onClick={() => setSyncTrigger(t => t + 1)} className="p-1 hover:text-white transition-colors"><RefreshCcw size={10}/></button>
          <button onClick={() => {
            const el = document.createElement('textarea'); el.value = firestorePath; 
            document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
            alert("PATH_COPIED");
          }} className="p-1 hover:text-white transition-colors"><Copy size={10}/></button>
        </div>
      </div>

      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200 h-16 md:h-20 flex items-center px-4 gap-4">
        <div className="flex items-center gap-3 shrink-0 cursor-pointer" onClick={() => {setSelectedPrefecture('すべて'); setActiveTab('map');}}>
          <div className="bg-orange-500 p-2.5 rounded-2xl text-white shadow-lg"><Store size={22} /></div>
          <h1 className="font-black text-xl tracking-tighter text-slate-800 uppercase hidden md:block italic">Gourmet<span className="text-orange-500">Master</span></h1>
        </div>
        <div className="flex-1 max-w-xl relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-orange-500 transition-colors" size={18} />
          <input type="text" placeholder="店名や住所で検索..." className="w-full pl-11 pr-4 py-2.5 bg-slate-100/80 border-none rounded-2xl text-sm md:text-base outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
           <div className={`p-2 rounded-full ${isSyncing ? 'text-orange-500 animate-spin' : 'text-slate-300'}`}>
             {(canUseCloud && cloudMode) ? <Cloud size={20} /> : <Database size={20} />}
           </div>
           <label className="p-2.5 bg-slate-900 text-white rounded-2xl hover:bg-slate-800 cursor-pointer shadow-xl transition-all active:scale-95 hidden sm:flex">
             <Upload size={20} /><input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
           </label>
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
        {(activeTab === 'list' || activeTab === 'favorites') && (
          <div className="mb-8 flex flex-col sm:flex-row items-center gap-4 bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><MapPin size={12} /> 都道府県絞り込み:</label>
            <select value={selectedPrefecture} onChange={(e) => setSelectedPrefecture(e.target.value)} className="w-full sm:w-64 p-3 bg-slate-50 border-none rounded-2xl text-xs font-black appearance-none focus:ring-4 focus:ring-orange-500/10 cursor-pointer">
              <option value="すべて">すべて (ALL JAPAN)</option>
              {PREF_ORDER.map(pref => (
                <option key={pref} value={pref}>{pref} ({data.filter(d => d.都道府県 === pref).length})</option>
              ))}
            </select>
            <div className="flex-1" />
            <div className="flex p-1 bg-slate-100 rounded-xl">
              <button onClick={() => setViewMode('detail')} className={`p-2 rounded-lg transition-all ${viewMode === 'detail' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400'}`}><Grid size={14}/></button>
              <button onClick={() => setViewMode('compact')} className={`p-2 rounded-lg transition-all ${viewMode === 'compact' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400'}`}><List size={14}/></button>
            </div>
          </div>
        )}

        {data.length === 0 ? (
          <div className="max-w-3xl mx-auto py-20 text-center bg-white p-12 rounded-[4rem] shadow-xl border border-slate-100 animate-in zoom-in duration-700">
              <Database className="mx-auto text-orange-500 mb-8 opacity-20" size={80} />
              <h2 className="text-4xl font-black mb-6 text-slate-800 tracking-tight italic uppercase">Import Required</h2>
              <p className="text-slate-400 mb-12 font-bold max-w-sm mx-auto leading-relaxed">エクセルデータを読み込んで同期を開始してください。</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
                <button onClick={() => saveData([{id:'sample-1',店舗名:"サンプル名店 銀座",住所:"東京都中央区銀座1-1-1",カテゴリ:"和食",都道府県:"東京都",isFavorite:true,NO:1}])} className="py-5 bg-orange-500 text-white rounded-[2rem] font-black shadow-xl hover:bg-orange-600 transition-all active:scale-95 text-lg italic tracking-widest uppercase">Sample Data</button>
                <label className="py-5 border-2 border-slate-200 text-slate-600 rounded-[2rem] font-black cursor-pointer hover:bg-slate-50 transition-all text-lg flex items-center justify-center gap-2 italic tracking-widest uppercase">Upload CSV/XLSX<input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} /></label>
              </div>
          </div>
        ) : (
          <div className="space-y-16 animate-in fade-in duration-700 pb-32">
            {activeTab === 'map' && (
              <div className="space-y-10">
                <h2 className="text-4xl font-black text-slate-800 italic tracking-tighter uppercase border-l-[12px] border-orange-500 pl-6">Explore <span className="text-orange-500">Areas</span></h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {Object.keys(regions).map(reg => {
                    const count = data.filter(d => (regions[reg] || []).includes(d.都道府県)).length;
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
              </div>
            )}
            
            {(activeTab === 'list' || activeTab === 'favorites') && (
              <div className="flex flex-col lg:flex-row gap-10">
                <aside className="lg:w-72 shrink-0 hidden lg:block">
                   <div className="bg-white p-7 rounded-[3rem] border border-slate-200/60 shadow-sm sticky top-44 space-y-7">
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
                  {groupedData.length === 0 ? <div className="bg-white p-20 rounded-[3rem] text-center text-slate-300 font-black italic shadow-inner">EMPTY_RESULT</div> : groupedData.map(([category, stores]) => (
                    <div key={category} id={`category-section-${sanitizeId(category)}`} className="space-y-8 scroll-mt-44 animate-in slide-in-from-bottom-4">
                      <div className="flex items-center gap-5 px-2"><h3 className="text-2xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter italic"><Layers size={26} className="text-orange-500" /> {category}</h3><div className="flex-1 h-px bg-slate-200/60"></div><span className="bg-orange-500 text-white px-5 py-1.5 rounded-full text-[10px] font-black shadow-lg tracking-widest">{stores.length} ITEMS</span></div>
                      <div className={viewMode === 'detail' ? "grid grid-cols-1 md:grid-cols-2 gap-8" : "space-y-3"}>
                        {stores.map(store => (
                          viewMode === 'detail' ? (
                            <div key={store.id} className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200/50 overflow-hidden hover:shadow-2xl transition-all duration-500 flex flex-col group relative">
                              <div className="relative h-60 overflow-hidden bg-slate-100">
                                <img src={`https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名||'').length + (store.カテゴリ?.length || 0)}`} alt={store.店舗名} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" />
                                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent opacity-90 group-hover:opacity-60 transition-opacity"></div>
                                <button onClick={() => toggleFavorite(store)} className={`absolute top-5 right-5 z-10 p-4 rounded-2xl backdrop-blur-md shadow-2xl transition-all active:scale-[1.5] ${store.isFavorite ? 'bg-rose-500 text-white' : 'bg-white/90 text-slate-300 hover:text-rose-500'}`}><Heart size={20} fill={store.isFavorite ? "currentColor" : "none"} /></button>
                                <div className="absolute bottom-6 left-7 right-7 text-white pointer-events-none"><div className="flex items-center gap-2 mb-2"><span className="px-2 py-0.5 bg-orange-500/80 rounded text-[9px] font-black tracking-widest uppercase">#{store.NO}</span></div><h4 className="text-2xl font-black truncate drop-shadow-lg tracking-tight uppercase italic">{store.店舗名}</h4></div>
                              </div>
                              <div className="p-8 flex-1 flex flex-col font-bold text-sm text-slate-500 space-y-4 tracking-tight">
                                <div className="flex items-start gap-4">
                                  <div className="bg-orange-50 p-2 rounded-xl text-orange-500 shrink-0 mt-0.5"><MapPin size={16} /></div>
                                  <div className="pt-0.5"><p className="text-orange-600 text-[10px] font-black uppercase mb-1 tracking-widest">{store.都道府県} • {getSubArea(store.都道府県, store.住所)}</p><span className="line-clamp-2 leading-relaxed">{store.住所}</span></div>
                                </div>
                                {store.URL && store.URL !== '' && store.URL !== 'Link' && (
                                  <a href={store.URL.startsWith('http') ? store.URL : `https://${store.URL}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-4 bg-blue-50 text-blue-600 rounded-2xl hover:bg-blue-600 hover:text-white transition-all group/link font-black text-center"><span className="truncate text-xs tracking-widest uppercase flex-1">Visit Website</span></a>
                                )}
                                <div className="mt-8 pt-6 border-t border-slate-50 flex gap-3 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                                  <button onClick={() => setEditingStore(store)} className="p-3 bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-2xl transition-all flex-1 flex items-center justify-center gap-2 text-[10px] font-black shadow-inner uppercase tracking-widest"><Edit2 size={16}/> Edit</button>
                                  <button onClick={() => deleteData(store.id)} className="p-3 bg-slate-50 text-slate-400 hover:text-rose-600 hover:bg-white rounded-2xl transition-all flex-1 flex items-center justify-center gap-2 text-[10px] font-black shadow-inner uppercase tracking-widest"><Trash2 size={16}/> Kill</button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div key={store.id} className="bg-white px-8 py-4 rounded-[2rem] border border-slate-200/60 shadow-sm hover:border-orange-500 hover:shadow-xl transition-all flex items-center justify-between group">
                              <div className="flex items-center gap-6 min-w-0"><div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0 font-black text-sm group-hover:bg-orange-50 group-hover:rotate-12 transition-all shadow-lg">#{store.NO}</div><div className="min-w-0">{store.URL && store.URL !== '' ? (<a href={store.URL.startsWith('http') ? store.URL : `https://${store.URL}`} target="_blank" rel="noopener noreferrer" className="font-black text-slate-800 hover:text-orange-600 transition-colors truncate text-xl flex items-center gap-2 italic uppercase tracking-tighter">{store.店舗名} <ExternalLink size={16} className="text-slate-200 group-hover:text-orange-300"/></a>) : (<h4 className="font-black text-slate-800 truncate text-xl uppercase italic tracking-tighter">{store.店舗名}</h4>)}<div className="flex items-center gap-5 text-[10px] text-slate-400 font-black mt-1.5 uppercase tracking-[0.2em] leading-none"><span className="flex items-center gap-2"><MapPin size={12} className="text-orange-400"/> {getRegionFromPref(store.都道府県)} | {store.都道府県}</span><span className="bg-slate-100 px-2.5 py-0.5 rounded-xl text-slate-500 group-hover:bg-orange-50 group-hover:text-orange-500 transition-colors">{(store.カテゴリ || '飲食店')}</span></div></div></div>
                              <div className="flex items-center gap-2"><button onClick={() => toggleFavorite(store)} className={`p-3.5 rounded-2xl transition-all active:scale-150 ${store.isFavorite ? 'text-rose-500 bg-rose-50' : 'text-slate-200 hover:text-rose-300 hover:bg-slate-50'}`}><Heart size={22} fill={store.isFavorite ? "currentColor" : "none"} /></button><button onClick={() => setEditingStore(store)} className="p-3 text-slate-200 hover:text-indigo-500 hover:bg-slate-50 rounded-2xl transition-colors"><Edit2 size={22}/></button></div>
                            </div>
                          )
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

      {(editingStore || isAddingNew) && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-300 px-4">
          <form onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const updated = Object.fromEntries(fd.entries());
            await saveData([ { ...editingStore, ...updated } ]);
            setEditingStore(null); setIsAddingNew(false);
          }} className="bg-white w-full max-w-lg rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-white/20">
            <div className="px-10 py-8 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10"><h2 className="font-black text-2xl text-slate-800 tracking-tight flex items-center gap-3 italic underline decoration-orange-500 decoration-4 underline-offset-8 uppercase tracking-widest">{editingStore ? 'Edit Store' : 'New Store'}</h2><button type="button" onClick={() => {setEditingStore(null); setIsAddingNew(false);}} className="p-2.5 text-slate-300 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"><X size={32} /></button></div>
            <div className="p-10 space-y-8 overflow-y-auto scrollbar-hide">
              <div className="space-y-3"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Store Name</label><input name="店舗名" defaultValue={editingStore?.店舗名} required className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-orange-500/10 focus:bg-white font-bold transition-all text-lg" /></div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-3"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Prefecture</label><input name="都道府県" defaultValue={editingStore?.都道府県} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-orange-500/10 font-bold transition-all" /></div>
                <div className="space-y-3"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Category</label><input name="カテゴリ" defaultValue={editingStore?.カテゴリ} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-orange-500/10 font-bold transition-all" /></div>
              </div>
              <div className="space-y-3"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Address</label><input name="住所" defaultValue={editingStore?.住所} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-orange-500/10 font-bold transition-all" /></div>
              <div className="space-y-3"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block text-blue-500 italic">Website / Image URL</label><input name="URL" defaultValue={editingStore?.URL} placeholder="https://..." className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-orange-500/10 font-bold transition-all text-blue-600" /></div>
            </div>
            <div className="p-10 bg-slate-50 flex gap-4 border-t sticky bottom-0 z-10"><button type="button" onClick={() => {setEditingStore(null); setIsAddingNew(false);}} className="flex-1 py-5 font-black text-slate-400 hover:text-slate-700 transition-colors text-xs tracking-widest uppercase">Cancel</button><button type="submit" className="flex-[2] py-5 bg-slate-900 text-white font-black rounded-[2rem] shadow-2xl hover:bg-slate-800 active:scale-95 transition-all text-sm tracking-widest flex items-center justify-center gap-3 uppercase"><Save size={18}/> Update Store</button></div>
          </form>
        </div>
      )}

      <button onClick={() => setIsAddingNew(true)} className="fixed bottom-24 right-8 w-20 h-20 bg-gradient-to-br from-orange-500 to-rose-500 text-white rounded-full shadow-2xl flex items-center justify-center z-[90] active:scale-110 transition-all md:hidden"><Plus size={40} strokeWidth={3} /></button>
    </div>
  );
};

// --- ErrorBoundary で包んでエクスポート ---
const App = () => (
  <ErrorBoundary>
    <GourmetApp />
  </ErrorBoundary>
);

export default App;