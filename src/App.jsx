import React, { useState, useEffect, Component, useRef } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, onSnapshot, 
  serverTimestamp, query, limit 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, 
  signInWithCustomToken, setPersistence, browserLocalPersistence 
} from 'firebase/auth';
import { 
  Cloud, WifiOff, Send, Terminal, Loader2, 
  CheckCircle2, Database, RefreshCcw, 
  Smartphone, Monitor, ShieldAlert, Zap, Search, Eye, Globe, Wifi, Activity, AlertTriangle, AlertCircle
} from 'lucide-react';

// ★ バージョン定義
const VERSION = "Gen_v3.92-STABLE-FIX";

// --- A. エラー保護 ---
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050510] text-white p-10 font-mono flex flex-col items-center justify-center text-center">
          <ShieldAlert size={80} className="text-rose-500 mb-8 animate-pulse" />
          <h1 className="text-3xl font-black mb-4 uppercase">System Interrupt</h1>
          <div className="bg-red-950/30 border border-red-500/50 p-6 rounded-2xl max-w-2xl mb-10 text-left">
            <p className="text-rose-400 font-bold mb-2">Diagnostic Data:</p>
            <code className="text-xs break-all leading-relaxed">{this.state.error?.stack || this.state.error?.toString()}</code>
          </div>
          <button onClick={() => window.location.reload()} className="px-12 py-5 bg-white text-black rounded-3xl font-black uppercase tracking-[0.2em] shadow-2xl transition-all active:scale-95">Reset Kernel</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- B. 同期テストアプリ本体 ---
const HyperSyncApp = () => {
  const [logs, setLogs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [user, setUser] = useState(null);
  const [db, setDb] = useState(null);
  const [detectedVars, setDetectedVars] = useState([]);
  const [scanCount, setScanCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  // 接続シーケンス
  const [stage, setStage] = useState({
    envCheck: 'pending',
    jsonParse: 'pending',
    sdkInit: 'pending',
    authSession: 'pending',
    dbLink: 'pending'
  });

  // 日本語ログ出力
  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 150));
  };

  useEffect(() => {
    const handleOnlineStatus = () => {
      setIsOnline(navigator.onLine);
      addLog(`ネットワーク状態変更: ${navigator.onLine ? '接続' : '切断'}`, navigator.onLine ? 'success' : 'warn');
    };
    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);
    return () => {
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, []);

  // --- 接続エンジン ---
  useEffect(() => {
    const runBootSequence = async () => {
      addLog(`[工程 ${scanCount + 1}] 環境設定の探索を開始します。`, "info");
      
      const allKeys = Object.keys(window);
      const targetKeys = allKeys.filter(k => k.startsWith('__') || k.toLowerCase().includes('firebase'));
      setDetectedVars(targetKeys);

      try {
        setStage(s => ({ ...s, envCheck: 'loading' }));
        
        let raw = null;
        if (typeof __firebase_config !== 'undefined') {
          addLog("検知: 直接参照で __firebase_config を確認。", "success");
          raw = __firebase_config;
        } else if (window.__firebase_config) {
          addLog("検知: window オブジェクト内に __firebase_config を確認。", "success");
          raw = window.__firebase_config;
        }

        if (!raw) {
          addLog("待機中: Firebase設定が見つかりません。注入を待っています...", "warn");
          setStage(s => ({ ...s, envCheck: 'error' }));
          const timer = setTimeout(() => setScanCount(c => c + 1), 3000);
          return () => clearTimeout(timer);
        }

        setStage(s => ({ ...s, envCheck: 'success', jsonParse: 'loading' }));
        
        addLog("解析: 設定情報を展開します。", "info");
        const config = typeof raw === 'string' ? JSON.parse(raw) : raw;
        
        if (!config.apiKey) {
          addLog("エラー: 設定内に apiKey が存在しません。", "error");
          setStage(s => ({ ...s, jsonParse: 'error' }));
          return;
        }

        addLog("解析成功: ライセンス情報を確認しました。", "success");
        setStage(s => ({ ...s, jsonParse: 'success', sdkInit: 'loading' }));

        addLog("初期化: SDKエンジンの起動を開始します。", "info");
        const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
        const authInstance = getAuth(app);
        const dbInstance = getFirestore(app);
        setDb(dbInstance);

        addLog("初期化成功: クラウドプロトコルが確立されました。", "success");
        setStage(s => ({ ...s, sdkInit: 'success', authSession: 'loading' }));

        addLog("認証: セッションの確立を試行中...", "info");
        await setPersistence(authInstance, browserLocalPersistence);
        
        const cred = await signInAnonymously(authInstance);
        setUser(cred.user);
        addLog(`認証成功: UID ${cred.user.uid.slice(0, 12)}...`, "success");
        setStage(s => ({ ...s, authSession: 'success' }));

      } catch (err) {
        addLog(`致命的エラー: ${err.message}`, "error");
        setStage(s => ({ ...s, envCheck: 'error' }));
      }
    };

    runBootSequence();
  }, [scanCount]);

  // --- リアルタイム同期 ---
  useEffect(() => {
    if (!user || !db) return;

    setStage(s => ({ ...s, dbLink: 'loading' }));
    const appId = typeof __app_id !== 'undefined' ? __app_id : (window.__app_id || 'sync-stable-v1');
    addLog(`同期: artifacts/${appId.slice(0,6)}... を監視開始。`, "info");
    
    const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'test_stream');
    
    const unsub = onSnapshot(colRef, (snap) => {
      addLog(`同期完了: クラウドから最新データ (${snap.docs.length}件) を同期。`, "success");
      setStage(s => ({ ...s, dbLink: 'success' }));
      const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMessages(items.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    }, (err) => {
      addLog(`通信エラー: Firestore ${err.code}`, "error");
      setStage(s => ({ ...s, dbLink: 'error' }));
    });

    return () => unsub();
  }, [user, db]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !user || !db) return;

    const val = inputText;
    const appId = typeof __app_id !== 'undefined' ? __app_id : (window.__app_id || 'sync-stable-v1');
    setInputText('');
    addLog(`送信中: "${val}"`, "info");

    try {
      const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'test_stream');
      await addDoc(colRef, {
        text: val,
        device: /iPhone/i.test(navigator.userAgent) ? "iPhone" : "Windows/PC",
        timestamp: serverTimestamp(),
        sender: user.uid.slice(0, 4)
      });
      addLog("送信成功: データベースへ反映されました。", "success");
    } catch (err) {
      addLog(`書き込み失敗: ${err.message}`, "error");
    }
  };

  const ProgressItem = ({ label, state, info }) => (
    <div className={`p-4 rounded-2xl border transition-all duration-500 ${
      state === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
      state === 'loading' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse' :
      state === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 font-bold' : 'bg-slate-900 border-white/5 text-slate-600'
    }`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-black uppercase tracking-widest leading-none">{label}</span>
        {state === 'success' ? <CheckCircle2 size={16} /> : state === 'loading' ? <Loader2 size={16} className="animate-spin" /> : state === 'error' ? <AlertCircle size={16} /> : null}
      </div>
      <p className="text-[10px] font-bold opacity-60 truncate">{info}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#020208] text-slate-300 font-sans p-4 md:p-10 flex flex-col items-center overflow-x-hidden">
      
      {/* 1. 接続状況インジケーター */}
      <div className="w-full max-w-4xl bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden mb-8">
        <div className="bg-slate-800 px-10 py-6 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${user ? 'bg-emerald-500' : 'bg-amber-500'} text-white shadow-xl`}>
              <Zap className={!user ? "animate-pulse" : ""} size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tighter uppercase italic leading-none">Cloud Sync Master</h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.4em] mt-1">{VERSION}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black tracking-widest ${isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
               <Wifi size={14} /> {isOnline ? 'ONLINE' : 'DISCONNECTED'}
            </div>
            <button onClick={() => setScanCount(c => c + 1)} className="p-3 bg-slate-700 hover:bg-slate-600 rounded-2xl transition-all active:scale-90 text-white">
              <RefreshCcw size={20} />
            </button>
          </div>
        </div>

        <div className="p-10 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ProgressItem label="環境スキャン" state={stage.envCheck} info={stage.envCheck === 'success' ? '変数検知完了' : '注入待機中'} />
            <ProgressItem label="設定解析" state={stage.jsonParse} info={stage.jsonParse === 'success' ? '解析完了' : '待機中'} />
            <ProgressItem label="SDK起動" state={stage.sdkInit} info={stage.sdkInit === 'success' ? '正常動作中' : '待機中'} />
            <ProgressItem label="認証" state={stage.authSession} info={stage.authSession === 'success' ? 'ログイン済' : '待機中'} />
            <ProgressItem label="同期回路" state={stage.dbLink} info={stage.dbLink === 'success' ? '回線接続済' : '待機中'} />
          </div>

          <div className="bg-black/60 rounded-3xl p-6 border border-white/5 space-y-4">
            <div className="flex items-center gap-3 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5 pb-3">
              <Eye size={14} className="text-blue-400"/> 検知済グローバル変数
            </div>
            <div className="flex flex-wrap gap-2">
              {detectedVars.length === 0 ? (
                <span className="text-[10px] italic text-rose-400 font-black animate-pulse">※ 変数を一つも検出できません。ブラウザ側で読み込みが止まっています。</span>
              ) : detectedVars.map(v => (
                <span key={v} className="bg-blue-500/10 text-blue-400 text-[10px] px-3 py-1.5 rounded-xl font-mono border border-blue-500/20">{v}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 2. メッセージ送信フォーム */}
      <div className="w-full max-w-4xl mb-12">
        <form onSubmit={handleSend} className="flex gap-4 bg-slate-900 p-5 rounded-[3rem] shadow-2xl border border-white/10">
          <input 
            type="text" 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={user ? "ここに打った文字がiPhoneに届きます..." : "接続工程が完了するまでお待ちください..."}
            className="flex-1 bg-slate-800 border-none rounded-[2rem] px-10 py-6 outline-none focus:ring-8 focus:ring-blue-500/10 font-black text-white placeholder-slate-600 text-xl"
            disabled={!user}
          />
          <button type="submit" disabled={!user || !inputText.trim()} className="bg-blue-600 hover:bg-blue-500 text-white w-24 h-24 rounded-[2.5rem] shadow-2xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-5 disabled:grayscale">
            <Send size={40} />
          </button>
        </form>
      </div>

      <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
        
        {/* 3. 同期受信モニター */}
        <div className="space-y-6">
          <div className="flex items-center gap-4 px-6 text-emerald-400">
            <Globe size={20} />
            <h2 className="text-lg font-black uppercase tracking-[0.2em] italic text-white">Live Cloud Monitor</h2>
          </div>
          <div className="space-y-4">
            {messages.length === 0 ? (
              <div className="bg-slate-900/40 border-2 border-dashed border-slate-800 rounded-[4rem] py-32 text-center text-slate-700 font-black italic">
                共有データはありません。<br/>Windows側で送信を実行してください。
              </div>
            ) : (
              messages.map(m => (
                <div key={m.id} className="bg-slate-900 p-10 rounded-[3.5rem] shadow-xl border border-white/5 animate-in slide-in-from-bottom-8 duration-700">
                  <div className="flex justify-between items-center mb-6">
                    <span className={`text-[11px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest ${m.device === 'iPhone' ? 'bg-orange-500/20 text-orange-400 border border-orange-400/20' : 'bg-blue-500/20 text-blue-400 border border-blue-400/20'}`}>
                      {m.device} (USER:{m.sender})
                    </span>
                    <span className="text-[11px] text-slate-600 font-mono font-bold tracking-tighter">
                      {m.timestamp?.toDate().toLocaleTimeString('ja-JP')}
                    </span>
                  </div>
                  <p className="text-white font-black text-4xl tracking-tight leading-tight">{m.text}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 4. システム診断ログ */}
        <div className="space-y-6">
          <div className="flex items-center gap-4 px-6 text-blue-400">
            <Terminal size={20} />
            <h2 className="text-lg font-black uppercase tracking-[0.2em] italic text-white">Logic Diagnostic Log</h2>
          </div>
          <div className="bg-black rounded-[4rem] p-12 h-[700px] overflow-y-auto scrollbar-hide shadow-inner border border-white/5 font-mono text-left relative">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-800 italic gap-4">
                <Loader2 className="animate-spin" size={40} />
                <span>Generating runtime logs...</span>
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`flex gap-5 mb-5 text-[12px] leading-relaxed border-b border-white/5 pb-5 last:border-0 ${log.type === 'error' ? 'bg-rose-500/10 rounded' : ''}`}>
                  <span className="text-slate-700 shrink-0 font-bold">[{log.time}]</span>
                  <span className={`font-black ${
                    log.type === 'success' ? 'text-emerald-400' : 
                    log.type === 'error' ? 'text-rose-400 font-black' : 
                    log.type === 'warn' ? 'text-amber-400' : 'text-blue-400'
                  }`}>
                    {log.msg}
                  </span>
                </div>
              ))
            )}
          </div>
          <button onClick={() => window.location.reload()} className="w-full py-8 bg-slate-800 hover:bg-slate-700 text-white rounded-[2.5rem] text-xs font-black uppercase tracking-[0.4em] transition-all active:scale-95 shadow-2xl border border-white/5">
            システム再起動 (REBOOT)
          </button>
        </div>

      </div>

      <footer className="mt-32 mb-20 text-[11px] font-black text-slate-700 uppercase tracking-[1em] text-center leading-loose">
        UNIFIED CLOUD PROTOCOL • GEN_V3.92
      </footer>
    </div>
  );
};

const App = () => (
  <ErrorBoundary>
    <HyperSyncApp />
  </ErrorBoundary>
);

export default App;