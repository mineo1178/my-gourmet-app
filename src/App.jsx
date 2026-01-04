import React, { useState, useEffect, useMemo, useRef, Component } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, onSnapshot, 
  serverTimestamp, doc, setDoc 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, 
  setPersistence, browserLocalPersistence 
} from 'firebase/auth';
import { 
  Cloud, WifiOff, Send, Terminal, Loader2, 
  AlertCircle, CheckCircle2, Database, RefreshCcw, 
  Smartphone, Monitor, Globe, ShieldAlert, Activity, Search, Eye
} from 'lucide-react';

// ★ バージョン定義
const VERSION = "Gen_v3.87-BOOT-DIAGNOSTIC";

// --- A. ErrorBoundary ---
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-white p-8 font-mono flex flex-col items-center justify-center text-center">
          <ShieldAlert size={64} className="text-rose-500 mb-6 animate-pulse" />
          <h1 className="text-2xl font-black uppercase mb-2">CRITICAL SYSTEM ERROR</h1>
          <p className="text-rose-400 mb-8 max-w-md break-all">{this.state.error?.toString()}</p>
          <button onClick={() => window.location.reload()} className="px-10 py-4 bg-white text-black rounded-2xl font-black uppercase shadow-2xl transition-all active:scale-95">REBOOT NOW</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- B. アプリケーション本体 ---
const AppContent = () => {
  const [logs, setLogs] = useState([]);
  const [syncItems, setSyncItems] = useState([]);
  const [inputText, setInputText] = useState('');
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('環境スキャン中');
  const [availableVars, setAvailableVars] = useState([]);
  
  // Firebase インスタンス
  const [instances, setInstances] = useState({ auth: null, db: null });
  const [appConfig, setAppConfig] = useState(null);

  // 日本語ログ出力
  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 100));
  };

  // --- Step 1: 環境変数の「監視」と「取得」 ---
  useEffect(() => {
    let checkInterval;
    
    const findConfig = () => {
      addLog("環境スキャン: グローバル変数を調査中...", "info");
      
      // 1. 利用可能な __ で始まる変数をすべてリストアップ (デバッグ用)
      const vars = Object.keys(window).filter(key => key.startsWith('__'));
      setAvailableVars(vars);

      // 2. 複数のルートから設定を試行
      let raw = null;
      try {
        if (typeof __firebase_config !== 'undefined') raw = __firebase_config;
        else if (window.__firebase_config) raw = window.__firebase_config;
        else if (globalThis.__firebase_config) raw = globalThis.__firebase_config;
      } catch (e) {
        addLog("アクセスエラー: 変数への直接アクセスが制限されています。", "error");
      }

      if (raw) {
        addLog("設定検知: クラウド設定を発見しました。", "success");
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (parsed && parsed.apiKey) {
            setAppConfig(parsed);
            clearInterval(checkInterval); // ループ停止
            return true;
          }
        } catch (e) {
          addLog(`パースエラー: 設定が壊れています (${e.message})`, "error");
        }
      } else {
        addLog(`未検出: 現在見えているグローバル変数 [${vars.join(', ') || 'なし'}]`, "warn");
        setStatus("設定待機中...");
      }
      return false;
    };

    // 初回実行
    if (!findConfig()) {
      // 見つかるまで 2秒おきにチェック (プレビュー環境の遅延対策)
      checkInterval = setInterval(findConfig, 2000);
    }

    return () => clearInterval(checkInterval);
  }, []);

  // --- Step 2: 設定が確定した後の Firebase 初期化 ---
  useEffect(() => {
    if (!appConfig) return;

    const startEngine = async () => {
      try {
        addLog("エンジン始動: Firebase SDKを初期化します。", "info");
        const app = getApps().length === 0 ? initializeApp(appConfig) : getApps()[0];
        const auth = getAuth(app);
        const db = getFirestore(app);

        addLog("認証開始: 匿名セッションを確立します...", "info");
        await setPersistence(auth, browserLocalPersistence);
        const cred = await signInAnonymously(auth);

        setUser(cred.user);
        setInstances({ auth, db });
        addLog(`接続成功: ユーザー ${cred.user.uid.slice(0, 8)} としてログインしました。`, "success");
        setStatus("同期中");
      } catch (err) {
        addLog(`エンジンエラー: ${err.message}`, "error");
        setStatus("エラー発生");
      }
    };

    startEngine();
  }, [appConfig]);

  // --- Step 3: データのリアルタイム購読 ---
  useEffect(() => {
    if (!user || !instances.db) return;

    const activeAppId = typeof __app_id !== 'undefined' ? __app_id : (window.__app_id || 'sync-debug-v1');
    addLog(`同期開始: パス artifacts/${activeAppId}/public/... を監視します。`, "info");
    
    const colRef = collection(instances.db, 'artifacts', activeAppId, 'public', 'data', 'debug_messages');
    
    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      addLog(`クラウド更新: ${snapshot.docs.length} 件のメッセージを同期しました。`, "success");
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sorted = items.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      setSyncItems(sorted);
    }, (err) => {
      addLog(`同期エラー(Firestore): ${err.code}`, "error");
    });

    return () => unsubscribe();
  }, [user, instances.db]);

  // --- 送信処理 ---
  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !user || !instances.db) return;

    const val = inputText;
    const activeAppId = typeof __app_id !== 'undefined' ? __app_id : (window.__app_id || 'sync-debug-v1');
    setInputText('');
    addLog(`送信中: "${val}"`, "info");

    try {
      const colRef = collection(instances.db, 'artifacts', activeAppId, 'public', 'data', 'debug_messages');
      await addDoc(colRef, {
        text: val,
        device: /iPhone/i.test(navigator.userAgent) ? "iPhone" : "Windows/PC",
        timestamp: serverTimestamp(),
        sender: user.uid.slice(0, 4)
      });
      addLog("クラウド送信成功", "success");
    } catch (err) {
      addLog(`送信失敗: ${err.message}`, "error");
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-300 font-sans p-4 md:p-8 flex flex-col items-center">
      
      {/* 1. 診断パネル (最上部) */}
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-[2.5rem] shadow-2xl overflow-hidden mb-6">
        <div className="bg-slate-800 px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${user ? 'bg-emerald-500' : 'bg-amber-500'} text-white shadow-lg`}>
              <Activity className={!user ? "animate-spin" : ""} size={20} />
            </div>
            <div>
              <h1 className="text-lg font-black text-white tracking-tighter uppercase italic">Sync Diagnostic</h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{VERSION}</p>
            </div>
          </div>
          <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${user ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'}`}>
             {status}
          </div>
        </div>

        <div className="p-8 grid grid-cols-1 sm:grid-cols-2 gap-6 border-b border-white/5">
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Eye size={12}/> 検出済みグローバル変数</p>
            <div className="flex flex-wrap gap-2">
              {availableVars.length === 0 ? <span className="text-[10px] italic opacity-30">スキャン中...</span> : availableVars.map(v => (
                <span key={v} className="bg-blue-500/10 text-blue-400 text-[9px] px-2 py-1 rounded border border-blue-500/20 font-mono">{v}</span>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Smartphone size={12}/> デバイス情報</p>
            <p className="font-bold text-sm text-white">
              {/iPhone/i.test(navigator.userAgent) ? "iPhone / Safari" : "Windows / PC Browser"}
            </p>
          </div>
        </div>
      </div>

      {/* 2. メッセージ送信 */}
      <div className="w-full max-w-2xl mb-12">
        <form onSubmit={handleSend} className="flex gap-3 bg-slate-900 p-3 rounded-[2.5rem] shadow-xl border border-white/5">
          <input 
            type="text" 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={user ? "メッセージを入力して全端末に送信..." : "接続を待機しています..."}
            className="flex-1 bg-slate-800 border-none rounded-[2rem] px-8 py-5 outline-none focus:ring-4 focus:ring-blue-500/20 font-bold text-white placeholder-slate-600"
            disabled={!user}
          />
          <button 
            type="submit" 
            disabled={!user || !inputText.trim()}
            className="bg-blue-600 hover:bg-blue-500 text-white w-16 h-16 rounded-[1.8rem] shadow-2xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-20 disabled:grayscale"
          >
            <Send size={24} />
          </button>
        </form>
      </div>

      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
        
        {/* 3. クラウド共有リスト */}
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-4">
            <Database size={20} className="text-orange-500" />
            <h2 className="text-sm font-black text-white uppercase tracking-[0.2em] italic">Shared Real-time Data</h2>
          </div>
          <div className="space-y-4">
            {syncItems.length === 0 ? (
              <div className="bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-[3rem] p-20 text-center text-slate-600 font-bold italic">
                クラウドにデータがありません。<br/>Windowsで送信してみてください。
              </div>
            ) : (
              syncItems.map(item => (
                <div key={item.id} className="bg-slate-900 p-8 rounded-[2.5rem] shadow-lg border border-white/5 animate-in slide-in-from-bottom-4 duration-700">
                  <div className="flex justify-between items-center mb-4">
                    <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${item.device === 'iPhone' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
                      {item.device} (SENDER:{item.sender})
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {item.timestamp?.toDate().toLocaleTimeString('ja-JP')}
                    </span>
                  </div>
                  <p className="text-white font-black text-2xl tracking-tight leading-relaxed">{item.text}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 4. システム動作ログ (日本語) */}
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-4">
            <Terminal size={20} className="text-blue-400" />
            <h2 className="text-sm font-black text-white uppercase tracking-[0.2em] italic">Diagnostic Console</h2>
          </div>
          <div className="bg-black rounded-[2.5rem] p-10 h-[550px] overflow-y-auto scrollbar-hide shadow-2xl border border-white/5 font-mono">
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-700 italic text-sm">システムログを生成中...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="flex gap-4 mb-3 text-[11px] leading-relaxed border-b border-white/5 pb-3 last:border-0">
                  <span className="text-slate-600 shrink-0 select-none">[{log.time}]</span>
                  <span className={`font-bold ${
                    log.type === 'success' ? 'text-emerald-400' : 
                    log.type === 'error' ? 'text-rose-400' : 
                    log.type === 'warn' ? 'text-amber-400' : 'text-blue-400'
                  }`}>
                    {log.msg}
                  </span>
                </div>
              ))
            )}
          </div>
          <button 
            onClick={() => window.location.reload()} 
            className="w-full py-6 bg-slate-800 hover:bg-slate-700 text-white rounded-[2rem] text-[11px] font-black uppercase tracking-[0.4em] transition-all active:scale-95 shadow-2xl border border-white/5"
          >
            システム再起動 (REBOOT)
          </button>
        </div>

      </div>

      <footer className="mt-20 mb-10 text-[10px] font-black text-slate-600 uppercase tracking-[0.6em] text-center leading-loose">
        Unified Cross-Platform Sync Test Engine<br/>
        Real-time Debug System • Gen_v3.87
      </footer>
    </div>
  );
};

const App = () => (
  <ErrorBoundary>
    <AppContent />
  </ErrorBoundary>
);

export default App;