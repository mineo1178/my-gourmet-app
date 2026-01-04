import React, { useState, useMemo, useEffect, Component, useDeferredValue } from 'react';
import {
  Search, MapPin, Upload, Trash2, Edit2, X, Store, Heart,
  Loader2, Map as MapIcon, Grid, Database,
  ChevronRight, Layers, ArrowDown,
  Cloud, ShieldAlert, Bug, ChevronUp, ChevronDown, RotateCcw
} from 'lucide-react';

// Firebase SDK
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';

// ★ バージョン
const VERSION = "GTP_v3.70-PUBLIC-SYNC-FULL";

// ★ 重要：共有DBの識別子を固定（環境で __app_id が変わって同期パスがズレる事故を防ぐ）
const SHARED_APP_ID = "gourmet-master-shared-v1";

// --- ErrorBoundary ---
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
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- 定数 ---
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

const safeJsonParse = (txt, fallback) => {
  try { return JSON.parse(txt); } catch { return fallback; }
};

// --- Firebase 設定 ---
const getFirebaseConfig = () => {
  try {
    if (typeof __firebase_config !== 'undefined' && __firebase_config) {
      return { firebaseConfig: JSON.parse(__firebase_config), isEnvConfig: true, source: "runtime" };
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
        isEnvConfig: true,
        source: "env"
      };
    }
  } catch (e) {
    console.error("CONFIG_PARSE_ERR", e);
  }
  return { firebaseConfig: null, isEnvConfig: false, source: "none" };
};

const { firebaseConfig, isEnvConfig, source: configSource } = getFirebaseConfig();

let firebaseApp = null, auth = null, db = null;
if (isEnvConfig && firebaseConfig?.apiKey) {
  try {
    firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
  } catch (e) {
    console.error("FIREBASE_INIT_ERR", e);
  }
}

const canUseCloud = Boolean(auth && db);

// --- アプリ本体 ---
const GourmetApp = () => {
  const [data, setData] = useState([]);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const [activeTab, setActiveTab] = useState('map');
  const [selectedPrefecture, setSelectedPrefecture] = useState('すべて');

  // 検索（deferred）
  const [searchTermInput, setSearchTermInput] = useState('');
  const searchTerm = useDeferredValue(searchTermInput);

  // Debug panel
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [xlsxReady, setXlsxReady] = useState(false);

  // ローカル保存キー（Cloud死んでも表示できるように）
  const LOCAL_KEY = "gourmetStores_local_cache_v1";

  const addLog = (event, value = "-") => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
      '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    setLogs(prev => [{ time, event, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }, ...prev].slice(0, 120));
  };

  // ★ 共有パス（固定）
  const firestorePathSegments = useMemo(() => ['artifacts', SHARED_APP_ID, 'public', 'data', 'stores'], []);

  // ローカル読込（最初に必ず画面に出す）
  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_KEY);
    if (saved) {
      const rows = safeJsonParse(saved, []);
      if (Array.isArray(rows) && rows.length > 0) {
        setData(rows);
        addLog("LOCAL_LOAD_OK", `${rows.length} items`);
      }
    } else {
      addLog("LOCAL_EMPTY");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // XLSX 読み込み
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => { setXlsxReady(true); addLog("XLSX_READY"); };
    script.onerror = () => { setXlsxReady(false); addLog("XLSX_LOAD_FAIL"); };
    document.head.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 起動時の匿名ログイン
  useEffect(() => {
    if (!canUseCloud) {
      setAuthChecked(true);
      addLog("CLOUD_DISABLED", "auth/db not ready");
      return;
    }

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        setAuthChecked(true);
        addLog("AUTH_CONNECTED", `${u.uid.slice(0, 6)}... anon=${String(u.isAnonymous)}`);
      } else {
        try {
          addLog("AUTH_ANON_START");
          await setPersistence(auth, browserLocalPersistence);
          const res = await signInAnonymously(auth);
          addLog("AUTH_ANON_OK", `${res.user.uid.slice(0, 6)}...`);
        } catch (e) {
          addLog("AUTH_ERR", e.code || e.message);
          setAuthChecked(true);
        }
      }
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Firestore 購読（Cloudが使える場合だけ）
  useEffect(() => {
    if (!user || !canUseCloud) return;

    setIsSyncing(true);
    addLog("SYNC_START", firestorePathSegments.join('/'));

    const q = collection(db, ...firestorePathSegments);
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // ★ ここ重要：Cloudが取れたらローカルにも保存して “常に表示できる” 状態にする
      setData(rows);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
      setIsSyncing(false);
      addLog("SYNC_COMPLETE", `${rows.length} items`);
    }, (err) => {
      setIsSyncing(false);
      addLog("SYNC_ERROR", err.code || err.message);
      if ((err.code || "") === "permission-denied") {
        addLog("HINT", "Firestore Rulesがreadを拒否。環境(設定)起因。ローカル表示は継続。");
      }
    });

    return () => unsub();
  }, [user, firestorePathSegments]);

  // ★ まずローカルへ即反映（＝Windowsで必ずリストが出る）
  const applyLocal = (rows) => {
    const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    setData(safeRows);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(safeRows));
    addLog("LOCAL_APPLY_OK", `${safeRows.length} items`);
  };

  // ★ Cloud保存（失敗してもローカル表示は残る）
  const saveCloud = async (rows) => {
    if (!canUseCloud || !user) {
      addLog("SAVE_SKIPPED", "cloud not ready");
      return;
    }
    setIsSyncing(true);
    addLog("SAVE_START", `${rows.length} rows`);
    try {
      const batch = writeBatch(db);
      rows.forEach(s => {
        const docId = s.id || `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_");
        const docRef = doc(db, ...firestorePathSegments, docId);
        batch.set(docRef, { ...s, id: docId }, { merge: true });
      });
      await batch.commit();
      addLog("SAVE_OK");
    } catch (e) {
      addLog("SAVE_ERR", e.code || e.message);
      if ((e.code || "") === "permission-denied") {
        addLog("HINT", "Firestore Rulesがwriteを拒否。同期できない原因は環境(設定)。");
      }
    }
    setIsSyncing(false);
  };

  // IMPORT処理（Windowsで押下しても必ず反映）
  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    // 同じファイルを連続で選べるように
    event.target.value = "";

    if (!file) return;

    if (!window.XLSX || !xlsxReady) {
      alert("XLSXライブラリが未読み込みです。数秒待って再度IMPORTしてください。");
      addLog("IMPORT_BLOCKED", "XLSX not ready");
      return;
    }

    addLog("IMPORT_FILE", `${file.name} (${Math.round(file.size / 1024)} KB)`);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workbook = window.XLSX.read(e.target.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = window.XLSX.utils.sheet_to_json(sheet);

        const normalized = jsonData.map((item, index) => ({
          NO: item.NO || item['NO'] || (index + 1),
          店舗名: item.店舗名 || item['店舗名'] || '名称不明',
          カテゴリ: item.カテゴリ || item['カテゴリ'] || '飲食店',
          都道府県: item.都道府県 || item['都道府県'] || 'その他',
          住所: item.住所 || item['住所'] || '',
          URL: item.URL || item['URL'] || '',
          imageURL: item.imageURL || item['imageURL'] || '',
          isFavorite: Boolean(item.isFavorite ?? false),
        })).map((s) => {
          const docId = `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_");
          return { ...s, id: docId };
        });

        // ★ まずローカルへ即反映 → Windowsで必ずリストが出る
        applyLocal(normalized);

        // ★ 表示をリストへ切替
        setActiveTab('list');

        // ★ 裏でクラウドへ保存（失敗してもOK）
        saveCloud(normalized);

        addLog("IMPORT_OK", `${normalized.length} rows`);
      } catch (err) {
        console.error(err);
        alert("解析に失敗しました（Excel形式を確認してください）");
        addLog("IMPORT_ERR", err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const deleteData = async (id) => {
    if (!window.confirm("削除しますか？")) return;

    // ローカル即反映
    const next = data.filter(d => d.id !== id);
    applyLocal(next);

    // Cloudも削除（失敗してもOK）
    if (canUseCloud) {
      try {
        await deleteDoc(doc(db, ...firestorePathSegments, id));
        addLog("DELETE_OK", id);
      } catch (e) {
        addLog("DEL_ERR", e.code || e.message);
      }
    }
  };

  const toggleFavorite = async (store) => {
    // ローカル即反映
    const next = data.map(d => d.id === store.id ? { ...d, isFavorite: !d.isFavorite } : d);
    applyLocal(next);

    // Cloudも反映（失敗してもOK）
    if (canUseCloud) {
      try {
        await setDoc(
          doc(db, ...firestorePathSegments, store.id),
          { isFavorite: !store.isFavorite },
          { merge: true }
        );
      } catch (e) {
        addLog("FAV_ERR", e.code || e.message);
      }
    }
  };

  const filteredData = useMemo(() => {
    let res = data.filter(Boolean);

    if (activeTab === 'favorites') res = res.filter(d => d.isFavorite);

    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      res = res.filter(d =>
        d.店舗名?.toLowerCase().includes(t) ||
        d.住所?.toLowerCase().includes(t) ||
        d.カテゴリ?.toLowerCase().includes(t)
      );
    }

    if (selectedPrefecture !== 'すべて') {
      res = res.filter(d => d.都道府県 === selectedPrefecture);
    }

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

  const DiagnosticPanel = () => (
    <div className={`fixed bottom-0 right-0 z-[110] w-full sm:w-96 bg-slate-900 text-[9px] text-slate-300 font-mono border-t sm:border-l border-white/20 transition-transform ${isDebugOpen ? 'translate-y-0 h-[70vh]' : 'translate-y-[calc(100%-36px)] h-auto'}`}>
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 cursor-pointer shadow-lg" onClick={() => setIsDebugOpen(!isDebugOpen)}>
        <span className="font-bold text-orange-500 flex items-center gap-2 uppercase tracking-widest">
          <Bug size={12}/> Diagnostic ({VERSION})
        </span>
        {isDebugOpen ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}
      </div>
      <div className="p-4 space-y-3 overflow-y-auto h-full pb-20">
        <div className="bg-black/40 p-3 rounded-xl border border-white/10 space-y-1">
          <div className="flex justify-between"><span>config</span><span>{configSource}</span></div>
          <div className="flex justify-between"><span>canUseCloud</span><span className={canUseCloud ? "text-green-400" : "text-rose-400"}>{String(canUseCloud)}</span></div>
          <div className="flex justify-between"><span>user</span><span>{user ? (user.uid.slice(0, 8) + "...") : "null"}</span></div>
          <div className="flex justify-between"><span>xlsxReady</span><span className={xlsxReady ? "text-green-400" : "text-rose-400"}>{String(xlsxReady)}</span></div>
          <div className="flex justify-between"><span>path</span><span className="text-slate-400 break-all">{firestorePathSegments.join('/')}</span></div>
          <div className="flex justify-between"><span>items</span><span>{String(data.length)}</span></div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => window.location.reload()} className="py-2 bg-slate-700 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-slate-600">
            <RotateCcw size={12}/> Refresh
          </button>
          <button onClick={() => { setLogs([]); addLog("LOG_CLEAR"); }} className="py-2 bg-slate-700 rounded-lg font-bold hover:bg-slate-600">
            Clear Log
          </button>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-slate-500 uppercase tracking-widest font-black">Timeline</span>
            <button
              onClick={() => {
                const txt = logs.map(l => `[${l.time}] ${l.event}: ${l.value}`).join("\n");
                const el = document.createElement('textarea');
                el.value = txt;
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
                alert("Log Copied!");
              }}
              className="text-orange-500 text-[8px] hover:underline bg-orange-500/5 px-2 py-1 rounded"
            >
              COPY ALL
            </button>
          </div>

          <div className="bg-black/60 rounded-xl p-3 border border-white/10 space-y-2 h-64 overflow-y-auto text-[8px]">
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2 border-b border-white/5 pb-1">
                <span className="text-slate-600 shrink-0">{l.time}</span>
                <span className="text-orange-400 font-black shrink-0">{l.event}</span>
                <span className="text-slate-400 break-all">{l.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
        <Loader2 className="animate-spin text-orange-500 w-12 h-12 mb-4" />
        <p className="font-black text-slate-400 uppercase tracking-widest text-[10px]">CONNECTING...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-20 sm:pb-0">
      <DiagnosticPanel />

      {/* ヘッダー */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-xl border-b border-slate-200 h-16 md:h-20 flex items-center px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 shrink-0 cursor-pointer" onClick={() => setActiveTab('map')}>
          <div className="bg-orange-500 p-2 rounded-xl text-white shadow-lg"><Store size={20} /></div>
          <h1 className="font-black text-lg tracking-tighter text-slate-800 uppercase italic hidden lg:block">Gourmet Master</h1>
        </div>

        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
          <input
            type="text"
            placeholder="店名・住所・カテゴリで検索..."
            className="w-full pl-9 pr-3 py-2.5 bg-slate-100/80 border-none rounded-xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold"
            value={searchTermInput}
            onChange={(e) => setSearchTermInput(e.target.value)}
          />
        </div>

        {/* 同期バッジ */}
        <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border shrink-0 ${canUseCloud ? 'bg-orange-50 border-orange-200' : 'bg-slate-100 border-slate-200'}`}>
          <Cloud size={14} className={canUseCloud ? 'text-orange-500' : 'text-slate-400'} />
          <span className={`text-[10px] font-black uppercase ${canUseCloud ? 'text-orange-700' : 'text-slate-500'}`}>
            {isSyncing ? 'Syncing' : (canUseCloud ? 'Cloud' : 'Offline')}
          </span>
        </div>

        {/* ★ Windowsで必ず見えるIMPORT（sm制限を外す） */}
        <label className={`ml-1 p-2.5 rounded-xl cursor-pointer active:scale-95 transition-all ${xlsxReady ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed"}`}>
          <Upload size={18} />
          <input
            type="file"
            className="hidden"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileUpload}
            disabled={!xlsxReady}
          />
        </label>
      </header>

      {/* タブ */}
      <nav className="bg-white border-b sticky top-16 md:top-20 z-40 flex overflow-x-auto scrollbar-hide px-2 shadow-sm">
        {[
          { id: 'map', label: 'AREA', icon: <MapIcon size={16} /> },
          { id: 'list', label: 'LIST', icon: <Grid size={16} /> },
          { id: 'favorites', label: 'HEART', icon: <Heart size={16} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-6 py-5 text-[10px] font-black tracking-widest transition-all shrink-0 ${activeTab === tab.id ? 'text-orange-600 border-b-4 border-orange-600' : 'text-slate-400 hover:text-slate-600 border-b-4 border-transparent'}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8 min-h-screen">
        <div className="mb-10 text-center">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.5em] mb-2 leading-none">Shared Global Database</p>
          <h2 className="text-5xl sm:text-7xl font-black text-slate-900 italic tracking-tighter leading-none mb-3">{VERSION}</h2>
          <div className="flex justify-center gap-3">
            <div className="px-5 py-2 bg-orange-500 text-white rounded-full font-black text-[10px] uppercase tracking-widest shadow-xl shadow-orange-200">
              Public Sync Mode
            </div>
          </div>
        </div>

        {data.length === 0 ? (
          <div className="max-w-3xl mx-auto py-16 text-center bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100">
            <Database className="mx-auto text-orange-500 mb-6 opacity-20" size={72} />
            <h2 className="text-2xl font-black mb-3 text-slate-800 tracking-tight italic uppercase">No Data</h2>
            <p className="text-sm text-slate-400 font-bold mb-8 leading-relaxed">
              WindowsでIMPORTすると、まずローカルに即反映してリストが出ます。<br/>
              その後、Cloudへも保存を試みます（失敗しても表示は消えません）。
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
              <button
                onClick={() => {
                  const sample = [{ NO: 1, 店舗名: "サンプル名店", カテゴリ: "和食", 都道府県: "東京都", 住所: "銀座", isFavorite: true }];
                  const normalized = sample.map(s => ({ ...s, id: `${s.店舗名}-${s.住所}`.replace(/[.#$/[\]]/g, "_") }));
                  applyLocal(normalized);
                  setActiveTab("list");
                  saveCloud(normalized);
                }}
                className="py-4 bg-orange-500 text-white rounded-2xl font-black shadow-xl hover:bg-orange-600 transition-all text-lg italic tracking-widest"
              >
                SAMPLE
              </button>

              <label className={`py-4 border-2 rounded-2xl font-black cursor-pointer transition-all text-lg flex items-center justify-center gap-2 italic tracking-widest uppercase ${xlsxReady ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-slate-100 text-slate-300 cursor-not-allowed"}`}>
                IMPORT
                <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} disabled={!xlsxReady} />
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-16 pb-28">
            {activeTab === 'map' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in duration-700">
                {Object.keys(regions).map(reg => {
                  const count = data.filter(Boolean).filter(d => (regions[reg] || []).includes(d.都道府県)).length;
                  return (
                    <button
                      key={reg}
                      onClick={() => { setSelectedPrefecture('すべて'); setActiveTab('list'); }}
                      className="group bg-white rounded-[2.5rem] p-8 text-left border border-slate-100 shadow-sm hover:shadow-2xl transition-all flex flex-col justify-between min-h-[190px] relative overflow-hidden active:scale-95"
                    >
                      <div className="absolute -top-4 -right-4 p-8 opacity-5 group-hover:scale-125 transition-all rotate-12"><MapIcon size={120}/></div>
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
                  <div className="bg-white p-7 rounded-[3rem] border border-slate-200 shadow-sm sticky top-44 space-y-7 max-h-[65vh] overflow-y-auto">
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
                        className="w-full px-5 py-4 bg-slate-50 text-left rounded-2xl text-[10px] font-black text-slate-600 hover:bg-orange-50 hover:text-orange-600 transition-all flex items-center justify-between active:scale-95"
                      >
                        <span className="truncate">{category}</span>
                        <span className="bg-white text-slate-900 px-2 py-0.5 rounded shadow-sm font-black text-[9px]">{stores.length}</span>
                      </button>
                    ))}
                  </div>
                </aside>

                <div className="flex-1 space-y-20 min-w-0 pb-28">
                  {groupedData.map(([category, stores]) => (
                    <div key={category} id={`category-section-${category}`} className="space-y-8 scroll-mt-44">
                      <div className="flex items-center gap-5 px-4">
                        <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tighter italic">
                          <Layers size={26} className="text-orange-500" /> {category}
                        </h3>
                        <div className="flex-1 h-px bg-slate-200/60"></div>
                        <span className="bg-orange-500 text-white px-5 py-1.5 rounded-full text-[10px] font-black shadow-lg tracking-widest">
                          {stores.length} ITEMS
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        {stores.map(store => (
                          <div key={store.id} className="bg-white rounded-[3rem] shadow-sm border border-slate-200/50 overflow-hidden hover:shadow-2xl transition-all duration-500 flex flex-col group relative">
                            <div className="relative h-64 overflow-hidden bg-slate-100">
                              <img
                                src={store.imageURL && store.imageURL !== '' ? store.imageURL : `https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名||'').length}`}
                                alt={store.店舗名}
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[2000ms]"
                                onError={(e) => {
                                  if (e.currentTarget.dataset.fallback) return;
                                  e.currentTarget.dataset.fallback = "1";
                                  e.currentTarget.src = `https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名||'').length}`;
                                }}
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent opacity-90 group-hover:opacity-60 transition-opacity"></div>

                              <button
                                onClick={() => toggleFavorite(store)}
                                className={`absolute top-6 right-6 z-10 p-4 rounded-2xl backdrop-blur-md shadow-2xl transition-all active:scale-[1.5] ${store.isFavorite ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/50' : 'bg-white/90 text-slate-300 hover:text-rose-500'}`}
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
                                  className="flex-1 py-4 bg-slate-50 text-slate-500 hover:text-red-600 hover:bg-white rounded-2xl transition-all shadow-inner font-black text-[10px] uppercase tracking-widest"
                                  title="削除"
                                >
                                  Delete
                                </button>
                                <button
                                  onClick={() => toggleFavorite(store)}
                                  className="p-4 bg-orange-50 text-orange-600 hover:bg-orange-600 hover:text-white rounded-2xl transition-all shadow-sm"
                                  title="お気に入り"
                                >
                                  <Heart size={18} fill={store.isFavorite ? "currentColor" : "none"} />
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
        VER {VERSION} | LOCAL-FIRST + CLOUD-BEST-EFFORT
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
