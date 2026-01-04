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
  Smartphone, Monitor, Globe, ShieldAlert, Activity, 
  Search, Eye, HardDrive, Lock, Unlock, Zap
} from 'lucide-react';

// ★ バージョン定義
const VERSION = "Gen_v3.88-CONNECT-PRO-DEBUG";

// --- A. ErrorBoundary (クラッシュ防止) ---
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
          <h1 className="text-2xl font-black uppercase mb-2">システム・パニック</h1>
          <p className="text-rose-400 mb-8 max-w-md break-all">{this.state.error?.toString()}</p>
          <button onClick={() => window.location.reload()} className="px-10 py-4 bg-white text-black rounded-2xl font-black uppercase shadow-2xl">Reboot</button>
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
  const [steps, setSteps] = useState({
    config: 'pending', // pending, loading, success, error
    sdk: 'pending',
    auth: 'pending',
    db: 'pending'
  });
  
  const [instances, setInstances] = useState({ auth: null, db: null });
  const [retryCount, setRetryCount] = useState(0);

  // 日本語ログ出力
  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 100));
  };

  // --- Step 1: 接続設定のキャッチとSDK初期化 ---
  useEffect(() => {
    const findAndInit = async () => {
      addLog(`[工程1] 環境スキャン開始 (試行 ${retryCount + 1}回目)`, "info");
      setSteps(s => ({ ...s, config: 'loading' }));

      try {
        // 全方位から設定を探索
        let config = null;
        if (typeof __firebase_config !== 'undefined') config = __firebase_config;
        else if (window.__firebase_config) config = window.__firebase_config;
        else if (globalThis.__firebase_config) config = globalThis.__firebase_config;

        if (!config || (typeof config === 'string' && config.length < 10)) {
          addLog("未検出: Firebase設定がまだ環境から届いていません。ブラウザが準備中です。", "warn");
          setSteps(s => ({ ...s, config: 'error' }));
          // 3秒後に自動リトライ
          setTimeout(() => setRetryCount(r => r + 1), 3000);
          return;
        }

        const parsedConfig = typeof config === 'string' ? JSON.parse(config) : config;
        if (!parsedConfig.apiKey) throw new Error("APIキーが設定内に見つかりません。");

        addLog("設定検知成功: クラウドエンジンのライセンスを確認しました。", "success");
        setSteps(s => ({ ...s, config: 'success', sdk: 'loading' }));

        // SDK初期化
        const app = getApps().length === 0 ? initializeApp(parsedConfig) : getApps()[0];
        const authInstance = getAuth(app);
        const dbInstance = getFirestore(app);

        addLog("SDK初期化完了: 通信プロトコルを確立しました。", "success");
        setSteps(s => ({ ...s, sdk: 'success', auth: 'loading' }));

        // 匿名認証
        await setPersistence(authInstance, browserLocalPersistence);
        const cred = await signInAnonymously(authInstance);
        
        setUser(cred.user);
        setInstances({ auth: authInstance, db: dbInstance });
        setSteps(s => ({ ...s, auth: 'success' }));
        addLog(`認証成功: ユーザーID ${cred.user.uid.slice(0, 8)} を発行。`, "success");

      } catch (err) {
        addLog(`致命的エラー: ${err.message}`, "error");
        setSteps(s => ({ ...s, config: 'error' }));
      }
    };

    findAndInit();
  }, [retryCount]);

  // --- Step 2: リアルタイム同期 ---
  useEffect(() => {
    if (!user || !instances.db) return;

    setSteps(s => ({ ...s, db: 'loading' }));
    const activeAppId = typeof __app_id !== 'undefined' ? __app_id : (window.__app_id || 'sync-debug-v1');
    addLog(`同期確立: パス artifacts/${activeAppId.slice(0,8)}... を監視します。`, "info");
    
    const colRef = collection(instances.db, 'artifacts', activeAppId, 'public', 'data', 'debug_messages');
    
    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      addLog(`クラウド通信成功: ${snapshot.docs.length} 件のデータをリアルタイム受信。`, "success");
      setSteps(s => ({ ...s, db: 'success' }));
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSyncItems(items.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    }, (err) => {
      addLog(`同期エラー: ${err.code}`, "error");
      setSteps(s => ({ ...s, db: 'error' }));
    });

    return () => unsubscribe();
  }, [user, instances.db]);

  // 送信処理
  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !user || !instances.db) return;
    const val = inputText;
    const activeAppId = typeof __app_id !== 'undefined' ? __app_id : (window.__app_id || 'sync-debug-v1');
    setInputText('');
    addLog(`送信試行: "${val}"`, "info");
    try {
      const colRef = collection(instances.db, 'artifacts', activeAppId, 'public', 'data', 'debug_messages');
      await addDoc(colRef, {
        text: val,
        device: /iPhone/i.test(navigator.userAgent) ? "iPhone" : "Windows/PC",
        timestamp: serverTimestamp(),
        sender: user.uid.slice(0, 4)
      });
      addLog("クラウド送信に成功しました。", "success");
    } catch (err) {
      addLog(`送信失敗: ${err.message}`, "error");
    }
  };

  const StepItem = ({ label, status, icon: Icon }) => (
    <div className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
      status === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
      status === 'loading' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse' :
      status === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-slate-800/50 border-white/5 text-slate-500'
    }`}>
      <div className="flex items-center gap-3">
        <Icon size={18} />
        <span className="text-xs font-black uppercase tracking-widest">{label}</span>
      </div>
      {status === 'success' ? <CheckCircle2 size={16} /> : status === 'loading' ? <Loader2 size={16} className="animate-spin" /> : status === 'error' ? <AlertCircle size={16} /> : null}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#020617] text-slate-300 font-sans p-4 md:p-8 flex flex-col items-center">
      
      {/* 1. 接続チェックリスト */}
      <div className="w-full max-w-2xl bg-slate-900 border border-white/5 rounded-[2.5rem] shadow-2xl overflow-hidden mb-8">
        <div className="bg-slate-800 px-8 py-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${user ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-amber-500 shadow-amber-500/20'} text-white shadow-xl`}>
              <Zap className={!user ? "animate-pulse" : ""} size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tighter italic leading-none">Cloud Link Wizard</h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.3em] mt-1">{VERSION}</p>
            </div>
          </div>
          <button 
            onClick={() => setRetryCount(r => r + 1)}
            className="flex items-center gap-2 px-5 py-2 bg-slate-700 hover:bg-slate-600 rounded-full transition-all active:scale-90"
          >
            <RefreshCcw size={14} className="text-orange-400" />
            <span className="text-[10px] text-white font-black">再試行</span>
          </button>
        </div>

        <div className="p-8 space-y-3 bg-gradient-to-b from-slate-900 to-slate-950">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 text-center">接続工程の進捗確認</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <StepItem label="システム設定の取得" status={steps.config} icon={HardDrive} />
            <StepItem label="Firebase SDK 起動" status={steps.sdk} icon={Activity} />
            <StepItem label="セッション認証" status={steps.auth} icon={Lock} />
            <StepItem label="クラウドDB 接続" status={steps.db} icon={Database} />
          </div>
        </div>
      </div>

      {/* 2. 送信フォーム */}
      <div className="w-full max-w-2xl mb-12">
        <form onSubmit={handleSend} className="flex gap-4 bg-slate-900 p-4 rounded-[2.5rem] shadow-2xl border border-white/10">
          <input 
            type="text" 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={user ? "メッセージを入力して全端末に同期送信..." : "接続工程が完了するまでお待ちください..."}
            className="flex-1 bg-slate-800 border-none rounded-[1.8rem] px-8 py-5 outline-none focus:ring-4 focus:ring-blue-500/20 font-bold text-white placeholder-slate-600 text-lg"
            disabled={!user}
          />
          <button 
            type="submit" 
            disabled={!user || !inputText.trim()}
            className="bg-blue-600 hover:bg-blue-500 text-white w-20 h-20 rounded-[2rem] shadow-2xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-10 disabled:grayscale"
          >
            <Send size={32} />
          </button>
        </form>
      </div>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-10">
        
        {/* 3. 同期データリスト */}
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-6">
            <Globe size={20} className="text-emerald-500" />
            <h2 className="text-sm font-black text-white uppercase tracking-[0.3em] italic">Real-time Cloud Stream</h2>
          </div>
          <div className="space-y-4">
            {syncItems.length === 0 ? (
              <div className="bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-[3rem] p-24 text-center text-slate-700 font-bold italic">
                クラウドにデータがありません。<br/>Windows側で送信ボタンを押してください。
              </div>
            ) : (
              syncItems.map(item => (
                <div key={item.id} className="bg-slate-900 p-8 rounded-[3rem] shadow-xl border border-white/5 animate-in slide-in-from-bottom-6 duration-700">
                  <div className="flex justify-between items-center mb-4">
                    <span className={`text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest ${item.device === 'iPhone' ? 'bg-orange-500/10 text-orange-400 border border-orange-400/20' : 'bg-blue-500/10 text-blue-400 border border-blue-400/20'}`}>
                      {item.device} (USER:{item.sender})
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {item.timestamp?.toDate().toLocaleTimeString('ja-JP')}
                    </span>
                  </div>
                  <p className="text-white font-black text-3xl tracking-tight leading-relaxed">{item.text}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 4. 詳細デバッグログ */}
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-6">
            <Terminal size={20} className="text-blue-400" />
            <h2 className="text-sm font-black text-white uppercase tracking-[0.3em] italic">Logic Diagnostic Logs</h2>
          </div>
          <div className="bg-black rounded-[3rem] p-10 h-[600px] overflow-y-auto scrollbar-hide shadow-inner border border-white/5 font-mono">
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-800 italic text-sm">Waiting for logs...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="flex gap-4 mb-4 text-[11px] leading-relaxed border-b border-white/5 pb-4 last:border-0">
                  <span className="text-slate-700 shrink-0 select-none">[{log.time}]</span>
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
            className="w-full py-8 bg-slate-800 hover:bg-slate-700 text-white rounded-[2.5rem] text-xs font-black uppercase tracking-[0.5em] transition-all active:scale-95 shadow-2xl border border-white/10"
          >
            ハード・リブート
          </button>
        </div>

      </div>

      <footer className="mt-24 mb-12 text-[11px] font-black text-slate-700 uppercase tracking-[0.6em] text-center leading-loose">
        Unified Cross-Platform Sync Architecture<br/>
        Enterprise Debug Engine • {VERSION}
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