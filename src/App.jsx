import React, { useState, useEffect, Component } from 'react';
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
  Smartphone, Monitor, ShieldAlert, Zap, Search, Eye, Globe
} from 'lucide-react';

// ★ バージョン定義
const VERSION = "Gen_v3.90-RESCUE-FIXED";

// --- A. エラー保護 (クラッシュ防止) ---
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-white p-8 font-mono flex flex-col items-center justify-center text-center">
          <ShieldAlert size={64} className="text-rose-500 mb-6 animate-pulse" />
          <h1 className="text-xl font-black mb-2">システム・リカバリモード</h1>
          <p className="text-rose-400 text-xs mb-8">{this.state.error?.toString()}</p>
          <button onClick={() => window.location.reload()} className="px-10 py-4 bg-white text-black rounded-2xl font-black uppercase">再起動</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- B. 同期テスト本体 ---
const SyncTestApp = () => {
  const [logs, setLogs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [user, setUser] = useState(null);
  const [db, setDb] = useState(null);
  const [probeResult, setProbeResult] = useState([]);
  const [reScanCount, setReScanCount] = useState(0);

  // 接続工程ステート
  const [process, setProcess] = useState({
    env: 'waiting',  // 環境変数待ち
    sdk: 'waiting',  // Firebase起動待ち
    auth: 'waiting', // ログイン待ち
    sync: 'waiting'  // データの同期待ち
  });

  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 100));
  };

  // --- Step 1: 徹底的な環境変数スキャンとFirebase起動 ---
  useEffect(() => {
    const scanAndBoot = async () => {
      addLog(`[工程1] 環境スキャン開始 (試行 ${reScanCount + 1}回目)...`, "info");
      
      // windowオブジェクトを探索
      const foundVars = Object.keys(window).filter(k => k.startsWith('__'));
      setProbeResult(foundVars);

      try {
        let rawConfig = null;
        // 優先順位をつけて探索
        if (typeof __firebase_config !== 'undefined') {
          addLog("探索: グローバルスコープで __firebase_config を発見。", "info");
          rawConfig = __firebase_config;
        } else if (window.__firebase_config) {
          addLog("探索: window オブジェクト内で __firebase_config を発見。", "info");
          rawConfig = window.__firebase_config;
        }

        if (!rawConfig) {
          addLog("未検出: 設定がまだ届いていません。ブラウザがシステム変数を読み込むのを待っています。", "warn");
          setProcess(p => ({ ...p, env: 'error' }));
          // 自動再試行
          const timer = setTimeout(() => setReScanCount(c => c + 1), 3000);
          return () => clearTimeout(timer);
        }

        const config = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
        if (!config.apiKey) throw new Error("設定の中に apiKey が含まれていません。");

        addLog("設定完了: クラウド接続情報の解析に成功しました。", "success");
        setProcess(p => ({ ...p, env: 'success', sdk: 'loading' }));

        // SDK初期化
        const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
        const authInstance = getAuth(app);
        const dbInstance = getFirestore(app);
        setDb(dbInstance);

        addLog("SDK起動: Firebaseエンジンを正常に初期化しました。", "success");
        setProcess(p => ({ ...p, sdk: 'success', auth: 'loading' }));

        // 匿名認証
        await setPersistence(authInstance, browserLocalPersistence);
        let cred;
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          addLog("認証試行: カスタムトークンを使用します...", "info");
          cred = await signInWithCustomToken(authInstance, __initial_auth_token);
        } else {
          addLog("認証試行: 標準の匿名認証を実行中...", "info");
          cred = await signInAnonymously(authInstance);
        }

        setUser(cred.user);
        addLog(`認証成功: ユーザーID ${cred.user.uid.slice(0, 12)} でログイン完了。`, "success");
        setProcess(p => ({ ...p, auth: 'success' }));

      } catch (err) {
        addLog(`致命的エラー: ${err.message}`, "error");
        setProcess(p => ({ ...p, env: 'error' }));
      }
    };

    scanAndBoot();
  }, [reScanCount]);

  // --- Step 2: リアルタイム同期の開始 ---
  useEffect(() => {
    if (!user || !db) return;

    setProcess(p => ({ ...p, sync: 'loading' }));
    const appId = typeof __app_id !== 'undefined' ? __app_id : (window.__app_id || 'sync-rescue-v1');
    addLog(`同期準備: 同期パス artifacts/${appId.slice(0,6)}... を確立中。`, "info");
    
    const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'rescue_messages');
    
    const unsub = onSnapshot(colRef, (snap) => {
      addLog(`同期更新: クラウドから最新 ${snap.docs.length} 件のメッセージを取得。`, "success");
      setProcess(p => ({ ...p, sync: 'success' }));
      const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMessages(items.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    }, (err) => {
      addLog(`同期エラー: ${err.code} - ${err.message}`, "error");
      setProcess(p => ({ ...p, sync: 'error' }));
    });

    return () => unsub();
  }, [user, db]);

  // 送信処理
  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !user || !db) {
      addLog("送信拒否: 接続が完了していないか、文字が空です。", "warn");
      return;
    }

    const val = inputText;
    const appId = typeof __app_id !== 'undefined' ? __app_id : (window.__app_id || 'sync-rescue-v1');
    setInputText('');
    addLog(`クラウドへ書き込み開始: "${val}"`, "info");

    try {
      const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'rescue_messages');
      await addDoc(colRef, {
        text: val,
        device: /iPhone/i.test(navigator.userAgent) ? "iPhone" : "Windows/PC",
        timestamp: serverTimestamp(),
        sender: user.uid.slice(0, 4)
      });
      addLog("書き込み成功: メッセージが送信されました。", "success");
    } catch (err) {
      addLog(`書き込み失敗: ${err.message}`, "error");
    }
  };

  const StatusItem = ({ label, state }) => (
    <div className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
      state === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
      state === 'loading' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse' :
      state === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 font-bold' : 'bg-slate-800 border-white/5 text-slate-500'
    }`}>
      <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
      {state === 'success' ? <CheckCircle2 size={14} /> : state === 'loading' ? <Loader2 size={14} className="animate-spin" /> : state === 'error' ? <AlertCircle size={14} /> : null}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#020617] text-slate-300 font-sans p-4 md:p-10 flex flex-col items-center overflow-x-hidden">
      
      {/* 1. 接続チェックリスト */}
      <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden mb-8">
        <div className="bg-slate-800 px-8 py-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${user ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-amber-500 shadow-amber-500/20'} text-white shadow-xl transition-colors`}>
              <Zap className={!user ? "animate-pulse" : ""} size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tighter uppercase italic">Cloud Sync Engine</h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.3em] mt-1">{VERSION}</p>
            </div>
          </div>
          <button onClick={() => setReScanCount(c => c + 1)} className="flex items-center gap-2 px-5 py-2 bg-slate-700 hover:bg-slate-600 rounded-full transition-all active:scale-90">
            <RefreshCcw size={14} className="text-orange-400" />
            <span className="text-[10px] text-white font-black uppercase">再スキャン</span>
          </button>
        </div>

        <div className="p-8 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <StatusItem label="システム設定" state={process.env} />
            <StatusItem label="エンジン初期化" state={process.sdk} />
            <StatusItem label="クラウド認証" state={process.auth} />
            <StatusItem label="リアルタイム同期" state={process.sync} />
          </div>

          <div className="mt-6 p-5 bg-black/40 rounded-2xl border border-white/5 space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5 pb-2">
              <Eye size={12}/> ブラウザが検知している変数
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {probeResult.length === 0 ? <span className="text-[9px] italic opacity-40">変数を探しています...</span> : probeResult.map(v => (
                <span key={v} className="bg-blue-500/10 text-blue-400 text-[9px] px-2 py-1 rounded font-mono border border-blue-500/10">{v}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 2. 同期テスト入力 */}
      <div className="w-full max-w-2xl mb-12">
        <form onSubmit={handleSend} className="flex gap-4 bg-slate-900 p-4 rounded-[2.5rem] shadow-2xl border border-white/10">
          <input 
            type="text" 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={user ? "メッセージを入力して送信..." : "接続を待機しています..."}
            className="flex-1 bg-slate-800 border-none rounded-[1.8rem] px-8 py-5 outline-none focus:ring-4 focus:ring-blue-500/20 font-bold text-white placeholder-slate-600 text-lg"
            disabled={!user}
          />
          <button type="submit" disabled={!user || !inputText.trim()} className="bg-blue-600 hover:bg-blue-500 text-white w-20 h-20 rounded-[2rem] shadow-2xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-10 disabled:grayscale">
            <Send size={32} />
          </button>
        </form>
      </div>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-10">
        
        {/* 3. 同期データモニター */}
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-6 text-emerald-400">
            <Globe size={20} />
            <h2 className="text-sm font-black uppercase tracking-[0.3em] italic text-white">Live Data Monitor</h2>
          </div>
          <div className="space-y-4">
            {messages.length === 0 ? (
              <div className="bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-[3rem] p-24 text-center text-slate-700 font-bold italic">
                共有データはありません。<br/>Windowsからメッセージを送ってみてください。
              </div>
            ) : (
              messages.map(m => (
                <div key={m.id} className="bg-slate-900 p-8 rounded-[3rem] shadow-xl border border-white/5 animate-in slide-in-from-bottom-6 duration-700">
                  <div className="flex justify-between items-center mb-4">
                    <span className={`text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest ${m.device === 'iPhone' ? 'bg-orange-500/10 text-orange-400 border border-orange-400/20' : 'bg-blue-500/10 text-blue-400 border border-blue-400/20'}`}>
                      {m.device} (ID:{m.sender})
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {m.timestamp?.toDate().toLocaleTimeString('ja-JP')}
                    </span>
                  </div>
                  <p className="text-white font-black text-3xl tracking-tight leading-relaxed">{m.text}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 4. システム動作ログ (詳細) */}
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-6 text-blue-400">
            <Terminal size={20} />
            <h2 className="text-sm font-black uppercase tracking-[0.3em] italic text-white">Engine Logic Log</h2>
          </div>
          <div className="bg-black rounded-[3rem] p-10 h-[600px] overflow-y-auto scrollbar-hide shadow-inner border border-white/5 font-mono text-left">
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-800 italic text-sm">起動ログを生成中...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="flex gap-4 mb-4 text-[11px] leading-relaxed border-b border-white/5 pb-4 last:border-0">
                  <span className="text-slate-700 shrink-0 select-none">[{log.time}]</span>
                  <span className={`font-bold ${
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
          <button onClick={() => window.location.reload()} className="w-full py-8 bg-slate-800 hover:bg-slate-700 text-white rounded-[2.5rem] text-xs font-black uppercase tracking-[0.5em] transition-all active:scale-95 shadow-2xl border border-white/10">
            完全リブート
          </button>
        </div>

      </div>

      <footer className="mt-24 mb-12 text-[11px] font-black text-slate-600 uppercase tracking-[0.6em] text-center leading-loose">
        Authentication & Sync Diagnostic Engine<br/>
        Unified Hub Infrastructure • {VERSION}
      </footer>
    </div>
  );
};

const App = () => (
  <ErrorBoundary>
    <SyncTestApp />
  </ErrorBoundary>
);

export default App;