import React, { useState, useMemo, useEffect, Component, useDeferredValue } from 'react';
import {
  Search, MapPin, Upload, Trash2, Edit2, X, Store, Heart,
  Loader2, Map as MapIcon, Grid, Database, ChevronRight, Layers, ArrowDown,
  Cloud, ShieldAlert, Bug
} from 'lucide-react';

// Firebase SDK
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore, collection, doc, setDoc, onSnapshot,
  deleteDoc, writeBatch, serverTimestamp
} from 'firebase/firestore';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';

// ★ バージョン
const VERSION = "GTP_v3.71-PUBLIC-SYNC-NOAUTH-GUARD";

// --- A. ErrorBoundary ---
class ErrorBoundary extends Component<any, any> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
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
const PREF_ORDER = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県',
  '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'
];

const regions: Record<string, string[]> = {
  '北海道': ['北海道'],
  '東北': ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  '関東': ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
  '中部': ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'],
  '近畿': ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  '中国': ['鳥取県', '島根県', '岡山県', '広島県', '山口県'],
  '四国': ['徳島県', '香川県', '愛媛県', '高知県'],
  '九州・沖縄': ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']
};

const getSubArea = (pref: string, address = "") => {
  if (!address) return "エリア";
  const match = address.match(/^(.*?[市郡区])/);
  return match ? match[1].replace(pref, "") : "主要";
};

type StoreRow = {
  id: string;
  NO?: number | string;
  店舗名?: string;
  カテゴリ?: string;
  都道府県?: string;
  住所?: string;
  URL?: string;
  imageURL?: string;
  isFavorite?: boolean;
  updatedAt?: any;
};

// --- 1. Firebase ---
const getFirebaseConfig = () => {
  try {
    if (typeof (window as any).__firebase_config !== 'undefined' && (window as any).__firebase_config) {
      return { firebaseConfig: JSON.parse((window as any).__firebase_config), ok: true, source: "runtime" };
    }
    const env = (import.meta as any).env || {};
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
        ok: true,
        source: "env"
      };
    }
  } catch (e) { console.error(e); }
  return { firebaseConfig: null, ok: false, source: "none" };
};

const cfg = getFirebaseConfig();
const appId = typeof (window as any).__app_id !== 'undefined' ? (window as any).__app_id : 'gourmet-master-v1';

let firebaseApp: any = null, auth: any = null, db: any = null;
if (cfg.ok && cfg.firebaseConfig?.apiKey) {
  try {
    firebaseApp = getApps().length === 0 ? initializeApp(cfg.firebaseConfig) : getApps()[0];
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
  } catch (e) { console.error(e); }
}

const canUseCloud = Boolean(db); // ★ authが無くてもdbがあれば同期する

// --- B. アプリ本体 ---
const GourmetApp = () => {
  const [data, setData] = useState<StoreRow[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<'map' | 'list' | 'favorites'>('map');
  const [selectedPrefecture, setSelectedPrefecture] = useState('すべて');
  const [authState, setAuthState] = useState<string>('unknown'); // purely diagnostic
  const [libLoaded, setLibLoaded] = useState(false);

  // 検索（入力は軽く、実検索はdeferred）
  const [searchTermInput, setSearchTermInput] = useState('');
  const searchTerm = useDeferredValue(searchTermInput);

  // デバッグ
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [logs, setLogs] = useState<{ time: string; event: string; value: string }[]>([]);
  const addLog = (event: string, value: any = "-") => {
    const d = new Date();
    const time = d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(d.getMilliseconds()).padStart(3, '0');
    setLogs(prev => [{ time, event, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }, ...prev].slice(0, 120));
  };

  // ★ パス固定：セキュリティ弱くていい（全員共有）
  const firestorePath = `artifacts/${appId}/public/data/stores`;

  // (任意) Anonymousログインは“試すだけ”。失敗しても同期処理は続行。
  useEffect(() => {
    addLog("BOOT", { VERSION, canUseCloud, appId, configSource: cfg.source, origin: window.location.origin });

    if (!auth) {
      setAuthState('no-auth-module');
      addLog("AUTH_SKIP", "auth instance not created");
      return;
    }
    const unsub = onAuthStateChanged(auth, async (u: any) => {
      if (u) {
        setAuthState(`signed:${u.isAnonymous ? 'anon' : 'user'}`);
        addLog("AUTH_STATE", { uid: u.uid?.slice(0, 6), anon: u.isAnonymous });
      } else {
        setAuthState("none");
        addLog("AUTH_STATE", "null");
        try {
          await setPersistence(auth, browserLocalPersistence);
          addLog("PERSISTENCE", "OK");
          await signInAnonymously(auth);
          addLog("ANON_LOGIN", "TRY");
        } catch (e: any) {
          // ここで落ちても同期は続行（rulesがpublicなら読める）
          addLog("ANON_LOGIN_FAIL", `${e?.code || 'unknown'} ${e?.message || ''}`.trim());
          setAuthState(`anon-fail:${e?.code || 'unknown'}`);
        }
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ Firestore 購読：user不要。dbさえあれば開始。
  useEffect(() => {
    if (!canUseCloud) {
      addLog("CLOUD_OFF", "Firestore not available");
      return;
    }
    setIsSyncing(true);
    addLog("SYNC_SUBSCRIBE_START", firestorePath);

    const q = collection(db, firestorePath);
    const unsub = onSnapshot(q, (snap: any) => {
      const rows: StoreRow[] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      setData(rows);
      setIsSyncing(false);
      addLog("SYNC_SUBSCRIBE_OK", `${rows.length} docs`);
    }, (err: any) => {
      setIsSyncing(false);
      addLog("SYNC_SUBSCRIBE_ERR", `${err?.code || 'unknown'} ${err?.message || ''}`.trim());
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestorePath, canUseCloud]);

  // XLSX ローダ
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => { setLibLoaded(true); addLog("XLSX_READY"); };
    script.onerror = () => addLog("XLSX_LOAD_FAIL");
    document.head.appendChild(script);
  }, []);

  const normalizeRows = (jsonData: any[]): StoreRow[] => {
    const base = Date.now();
    return (jsonData || []).map((item: any, index: number) => {
      const 店舗名 = item.店舗名 || item['店舗名'] || item.name || item['name'] || '名称不明';
      const 住所 = item.住所 || item['住所'] || item.address || item['address'] || '';
      const docId = (item.id || item.ID || `${店舗名}-${住所}-${base + index}`)
        .toString()
        .replace(/[.#$/[\]]/g, "_");

      return {
        id: docId,
        NO: item.NO ?? item['NO'] ?? (index + 1),
        店舗名,
        カテゴリ: item.カテゴリ || item['カテゴリ'] || item.category || item['category'] || '飲食店',
        都道府県: item.都道府県 || item['都道府県'] || item.pref || item['pref'] || 'その他',
        住所,
        URL: item.URL || item['URL'] || item.url || item['url'] || '',
        imageURL: item.imageURL || item['imageURL'] || item.image || item['image'] || '',
        isFavorite: Boolean(item.isFavorite ?? item['isFavorite'] ?? false),
        updatedAt: null
      };
    });
  };

  // ★ 保存：楽観反映（画面を先に更新）＋ Firestoreへ
  const saveData = async (storesToSave: StoreRow[]) => {
    const safeStores = Array.isArray(storesToSave) ? storesToSave.filter(Boolean) : [];
    if (safeStores.length === 0) return;

    // 楽観反映：まず画面に出す（Import押しても出ない問題を回避）
    setData(prev => {
      const map = new Map<string, StoreRow>();
      prev.forEach(p => map.set(p.id, p));
      safeStores.forEach(s => map.set(s.id, { ...(map.get(s.id) || {}), ...s }));
      return Array.from(map.values());
    });

    if (!canUseCloud) {
      addLog("SAVE_SKIP", "cloud not available");
      return;
    }

    setIsSyncing(true);
    addLog("SAVE_START", `${safeStores.length} rows`);

    try {
      const batch = writeBatch(db);
      safeStores.forEach(s => {
        const ref = doc(db, firestorePath, s.id);
        batch.set(ref, { ...s, updatedAt: serverTimestamp() }, { merge: true });
      });
      await batch.commit();
      addLog("SAVE_OK");
    } catch (e: any) {
      addLog("SAVE_ERR", `${e?.code || 'unknown'} ${e?.message || ''}`.trim());
    } finally {
      setIsSyncing(false);
    }
  };

  const deleteData = async (id: string) => {
    if (!window.confirm("削除しますか？")) return;

    // 楽観削除
    setData(prev => prev.filter(p => p.id !== id));

    if (!canUseCloud) return;
    try {
      await deleteDoc(doc(db, firestorePath, id));
      addLog("DEL_OK", id);
    } catch (e: any) {
      addLog("DEL_ERR", `${e?.code || 'unknown'} ${e?.message || ''}`.trim());
    }
  };

  const toggleFavorite = async (store: StoreRow) => {
    const next = !store.isFavorite;

    // 楽観反映
    setData(prev => prev.map(p => p.id === store.id ? { ...p, isFavorite: next } : p));

    if (!canUseCloud) return;
    try {
      await setDoc(doc(db, firestorePath, store.id), { isFavorite: next, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e: any) {
      addLog("FAV_ERR", `${e?.code || 'unknown'} ${e?.message || ''}`.trim());
    }
  };

  const handleFileUpload = (event: any) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // 同じファイル再選択でもonChangeが走るように
    if (!file) return;

    const XLSX = (window as any).XLSX;
    if (!XLSX) {
      alert("XLSXライブラリがまだ読み込み中です。少し待って再度お試しください。");
      addLog("IMPORT_FAIL", "XLSX not ready");
      return;
    }

    addLog("IMPORT_START", { name: file.name, size: file.size });

    const reader = new FileReader();
    reader.onerror = () => { addLog("FILE_READER_ERR"); alert("ファイル読み込みに失敗しました"); };
    reader.onload = (e: any) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheetName = wb.SheetNames?.[0];
        const sheet = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        addLog("IMPORT_PARSED", { sheetName, rows: json.length });

        const normalized = normalizeRows(json);
        saveData(normalized);
        setActiveTab('list');
      } catch (err: any) {
        addLog("IMPORT_PARSE_ERR", err?.message || "unknown");
        alert("解析に失敗しました（Excel/CSV形式を確認してください）");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const filteredData = useMemo(() => {
    let res = data.filter(Boolean);
    if (activeTab === 'favorites') res = res.filter(d => d.isFavorite);
    if (searchTerm) {
      const t = (searchTerm || '').toLowerCase();
      res = res.filter(d =>
        (d.店舗名 || '').toLowerCase().includes(t) ||
        (d.住所 || '').toLowerCase().includes(t) ||
        (d.カテゴリ || '').toLowerCase().includes(t)
      );
    }
    if (selectedPrefecture !== 'すべて') res = res.filter(d => d.都道府県 === selectedPrefecture);
    return res;
  }, [data, searchTerm, selectedPrefecture, activeTab]);

  const groupedData = useMemo(() => {
    const groups: Record<string, StoreRow[]> = {};
    filteredData.forEach(d => {
      const c = d.カテゴリ || '未分類';
      if (!groups[c]) groups[c] = [];
      groups[c].push(d);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filteredData]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-20 sm:pb-0">

      {/* デバッグボタン */}
      <button
        onClick={() => setIsDebugOpen(!isDebugOpen)}
        className="fixed bottom-4 right-4 z-[100] p-3 bg-slate-900 text-white rounded-full opacity-30 hover:opacity-100"
        title="Diagnostic"
      >
        <Bug size={18} />
      </button>

      {isDebugOpen && (
        <div className="fixed bottom-0 right-0 z-[110] w-full sm:w-[420px] h-[50vh] bg-slate-900 text-[10px] text-slate-300 font-mono p-4 border-t border-white/20 overflow-y-auto">
          <div className="flex justify-between items-center mb-2 border-b border-white/10 pb-2">
            <div className="space-y-1">
              <div className="text-orange-500 font-bold">SYSTEM LOG ({VERSION})</div>
              <div className="text-slate-500 text-[9px]">
                CLOUD={String(canUseCloud)} / AUTH={authState} / PATH={firestorePath}
              </div>
            </div>
            <button onClick={() => setIsDebugOpen(false)}><X size={14} /></button>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3 text-[9px]">
            <div className="p-2 rounded bg-white/5 border border-white/10">
              <div className="text-slate-500">Data</div>
              <div className="font-bold">{data.length} items</div>
            </div>
            <div className="p-2 rounded bg-white/5 border border-white/10">
              <div className="text-slate-500">Sync</div>
              <div className="font-bold">{isSyncing ? 'syncing...' : 'idle'}</div>
            </div>
          </div>

          {logs.map((l, i) => (
            <div key={i} className="flex gap-2 border-b border-white/5 py-1">
              <span className="text-slate-600 shrink-0 w-[84px]">{l.time}</span>
              <span className="text-orange-400 font-bold shrink-0">{l.event}</span>
              <span className="text-slate-300 break-all">{l.value}</span>
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
            placeholder="店名・住所・カテゴリで検索..."
            className="w-full pl-9 pr-3 py-2.5 bg-slate-100/80 border-none rounded-xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-orange-500/5 transition-all font-bold"
            value={searchTermInput}
            onChange={(e) => setSearchTermInput(e.target.value)}
          />
        </div>

        {/* 同期バッジ */}
        <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border shrink-0 ${canUseCloud ? 'bg-orange-50 border-orange-200' : 'bg-slate-100 border-slate-200'}`}>
          <Cloud size={14} className={canUseCloud ? (isSyncing ? 'text-orange-500 animate-pulse' : 'text-orange-500') : 'text-slate-400'} />
          <span className={`text-[10px] font-black uppercase ${canUseCloud ? 'text-orange-700' : 'text-slate-500'}`}>
            {canUseCloud ? 'Cloud' : 'Offline'}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-2">
          <label className="p-2.5 bg-slate-900 text-white rounded-xl cursor-pointer hover:bg-slate-800 active:scale-95 transition-all" title="Import">
            <Upload size={20} />
            <input type="file" className="hidden" accept=".csv,.xlsx" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      {/* ナビ */}
      <nav className="bg-white border-b sticky top-16 md:top-20 z-40 flex overflow-x-auto scrollbar-hide px-2 shadow-sm">
        {[
          { id: 'map', label: 'AREA', icon: <MapIcon size={16} /> },
          { id: 'list', label: 'LIST', icon: <Grid size={16} /> },
          { id: 'favorites', label: 'HEART', icon: <Heart size={16} /> }
        ].map((tab: any) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-6 py-5 text-[10px] font-black tracking-widest transition-all shrink-0
              ${activeTab === tab.id ? 'text-orange-600 border-b-4 border-orange-600' : 'text-slate-400 hover:text-slate-600 border-b-4 border-transparent'}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8 min-h-screen">
        {/* バージョン表示 */}
        <div className="mb-10 text-center">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.5em] mb-2 leading-none">
            SHARED GLOBAL DATABASE
          </p>
          <h2 className="text-5xl sm:text-7xl font-black text-slate-900 italic tracking-tighter leading-none mb-3">
            {VERSION}
          </h2>
          <div className="flex justify-center gap-3">
            <div className="px-5 py-2 bg-orange-500 text-white rounded-full font-black text-[10px] uppercase tracking-widest shadow-xl shadow-orange-200">
              PUBLIC SYNC MODE
            </div>
          </div>
        </div>

        {data.length === 0 ? (
          <div className="max-w-3xl mx-auto py-16 text-center bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100">
            <Database className="mx-auto text-orange-500 mb-6 opacity-20" size={80} />
            <h2 className="text-2xl font-black mb-3 text-slate-800 tracking-tight italic uppercase">No Shared Data</h2>
            <p className="text-sm text-slate-400 font-bold mb-8 leading-relaxed">
              WindowsでExcelを取り込むと、iPhoneにも自動で同期されます。<br />
              まずはWindowsでIMPORTを実行してください。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
              <button
                onClick={() => saveData([{ id: `sample-${Date.now()}`, NO: 1, 店舗名: "サンプル名店", カテゴリ: "和食", 都道府県: "東京都", 住所: "銀座", isFavorite: true }])}
                className="py-5 bg-orange-500 text-white rounded-3xl font-black shadow-xl hover:bg-orange-600 transition-all text-lg italic tracking-widest"
              >
                SAMPLE
              </button>
              <label className="py-5 border-2 border-slate-200 text-slate-700 rounded-3xl font-black cursor-pointer hover:bg-slate-50 transition-all text-lg flex items-center justify-center gap-2 italic tracking-widest uppercase">
                IMPORT
                <input type="file" className="hidden" accept=".csv,.xlsx" onChange={handleFileUpload} />
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-16 pb-32">
            {activeTab === 'map' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in duration-700">
                {Object.keys(regions).map(reg => {
                  const count = data.filter(Boolean).filter(d => (regions[reg] || []).includes(d.都道府県 || '')).length;
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
                        className="w-full px-5 py-4 bg-slate-50 text-left rounded-2xl text-[10px] font-black text-slate-600 hover:bg-orange-50 hover:text-orange-600 transition-all flex items-center justify-between group active:scale-95 shadow-sm"
                      >
                        <span className="truncate">{category}</span>
                        <span className="bg-white text-slate-900 px-2 py-0.5 rounded shadow-sm font-black text-[9px]">{stores.length}</span>
                      </button>
                    ))}
                  </div>
                </aside>

                <div className="flex-1 space-y-20 min-w-0 pb-32">
                  {groupedData.map(([category, stores]) => (
                    <div key={category} id={`category-section-${category}`} className="space-y-8 scroll-mt-44 animate-in fade-in duration-700">
                      <div className="flex items-center gap-6 px-4">
                        <h3 className="text-3xl font-black text-slate-800 flex items-center gap-4 uppercase tracking-tighter italic">
                          <Layers size={32} className="text-orange-500" /> {category}
                        </h3>
                        <div className="flex-1 h-px bg-slate-200/60"></div>
                        <span className="bg-orange-500 text-white px-6 py-2 rounded-full text-[10px] font-black shadow-lg tracking-widest">
                          {stores.length} ITEMS
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        {stores.map(store => (
                          <div key={store.id} className="bg-white rounded-[3rem] shadow-sm border border-slate-200/50 overflow-hidden hover:shadow-2xl transition-all duration-500 flex flex-col group relative">
                            <div className="relative h-64 overflow-hidden bg-slate-100">
                              <img
                                src={store.imageURL && store.imageURL !== '' ? store.imageURL : `https://loremflickr.com/500/350/gourmet,food?lock=${(store.店舗名 || '').length}`}
                                alt={store.店舗名 || ''}
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[2000ms]"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent opacity-90 group-hover:opacity-60 transition-opacity"></div>
                              <button
                                onClick={() => toggleFavorite(store)}
                                className={`absolute top-6 right-6 z-10 p-4 rounded-2xl backdrop-blur-md shadow-2xl transition-all active:scale-[1.8]
                                  ${store.isFavorite ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/50' : 'bg-white/90 text-slate-300 hover:text-rose-500'}`}
                              >
                                <Heart size={20} fill={store.isFavorite ? "currentColor" : "none"} />
                              </button>
                              <div className="absolute bottom-6 left-8 right-8 text-white pointer-events-none space-y-1">
                                <p className="text-[10px] font-black tracking-widest uppercase opacity-70 flex items-center gap-2">
                                  <MapPin size={12} className="text-orange-400" /> {store.都道府県} • {getSubArea(store.都道府県 || '', store.住所 || '')}
                                </p>
                                <h4 className="text-2xl font-black truncate drop-shadow-lg tracking-tight uppercase italic">{store.店舗名}</h4>
                              </div>
                            </div>

                            <div className="p-10 flex-1 flex flex-col justify-between gap-8 font-bold text-sm text-slate-500">
                              <p className="line-clamp-2 leading-relaxed italic">{store.住所 || "No address provided."}</p>
                              <div className="flex gap-4 pt-4 border-t border-slate-50">
                                {store.URL && store.URL !== 'Link' && (
                                  <a
                                    href={store.URL.startsWith('http') ? store.URL : `https://${store.URL}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 py-4 bg-orange-50 text-orange-600 rounded-2xl hover:bg-orange-600 hover:text-white transition-all text-center text-[10px] font-black uppercase tracking-widest shadow-sm"
                                  >
                                    Visit Website
                                  </a>
                                )}
                                <button
                                  onClick={() => deleteData(store.id)}
                                  className="p-4 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-white rounded-2xl transition-all shadow-inner"
                                  title="Delete"
                                >
                                  <Trash2 size={20} />
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

      {/* モバイル用IMPORT（ヘッダーに出ないので下にも置く） */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 sm:hidden z-[80]">
        <label className="px-6 py-4 bg-slate-900 text-white rounded-2xl font-black shadow-2xl flex items-center gap-3 active:scale-95 transition-all">
          <Upload size={18} /> IMPORT
          <input type="file" className="hidden" accept=".csv,.xlsx" onChange={handleFileUpload} />
        </label>
      </div>
    </div>
  );
};

const App = () => (
  <ErrorBoundary>
    <GourmetApp />
  </ErrorBoundary>
);

export default App;
