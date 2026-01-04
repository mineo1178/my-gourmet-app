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
  Smartphone, Monitor, Globe, ShieldAlert, Activity
} from 'lucide-react';

// ★ バージョン定義
const VERSION = "Gen_v3.86-SYNC-STABLE-TEST";

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
        <div className="min-h-screen bg-slate-900 text-white p-8 font-mono flex flex-col items-center justify-center text-center">
          <ShieldAlert size={64} className="text-rose-500 mb-6" />
          <h1 className="text-2xl font-black uppercase mb-2">システムエラー</h1>
          <p className="text-rose-400 mb-8">{this.state.error?.toString()}</p>
          <button onClick={() => window.location.reload()} className="px-10 py-4 bg-white text-black rounded-2xl font-black uppercase">再起動</button>
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
  const [status, setStatus] = useState('待機中');
  
  // Firebase インスタンス
  const [instances, setInstances] = useState({ auth: null, db: null });
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'sync-debug-v1';

  // 日本語ログ出力
  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 50));
  };

  // --- Step 1: 環境設定の注入を待機して初期化 ---
  useEffect(() => {
    const initEngine = async () => {
      addLog("システム初期化: Firebase設定をチェック中...", "info");
      
      try {
        // window変数を直接チェック (より確実な方法)
        const configRaw = window.__firebase_config || (typeof __firebase_config !== 'undefined' ? __firebase_config : null);

        if (!configRaw) {
          addLog("待機中: システム設定が見つかりません。再試行します...", "warn");
          setStatus("設定待ち");
          setTimeout(initEngine, 3000); // 3秒後にリトライ
          return;
        }

        const config = typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw;
        addLog("設定検知成功: クラウドエンジンを起動します。", "success");

        const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
        const auth = getAuth(app);
        const db = getFirestore(app);

        // 匿名認証
        addLog("認証開始: 匿名セッションを確立中...", "info");
        await setPersistence(auth, browserLocalPersistence);
        const cred = await signInAnonymously(auth);

        setUser(cred.user);
        setInstances({ auth, db });
        addLog(`認証成功: ユーザーID ${cred.user.uid.slice(0, 8)}`, "success");
        setStatus("接続完了");

      } catch (err) {
        addLog(`起動エラー: ${err.code || err.message}`, "error");
        setStatus("接続エラー");
        setTimeout(initEngine, 5000); // エラー時は5秒後にリトライ
      }
    };

    initEngine();
  }, []);

  // --- Step 2: リアルタイム同期の開始 ---
  useEffect(() => {
    if (!user || !instances.db) return;

    addLog("同期開始: 共有データベースを監視中...", "info");
    
    // パス: /artifacts/{appId}/public/data/debug_messages (Rule 1)
    const colRef = collection(instances.db, 'artifacts', appId, 'public', 'data', 'debug_messages');
    
    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      addLog(`同期更新: ${snapshot.docs.length} 件のデータを取得しました。`, "success");
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // 日時順ソート
      const sorted = items.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      setSyncItems(sorted);
    }, (err) => {
      addLog(`同期エラー: ${err.code}`, "error");
    });

    return () => unsubscribe();
  }, [user, instances.db, appId]);

  // --- Step 3: 送信処理 ---
  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !user || !instances.db) return;

    const val = inputText;
    setInputText('');
    addLog(`送信中: "${val}"`, "info");

    try {
      const colRef = collection(instances.db, 'artifacts', appId, 'public', 'data', 'debug_messages');
      await addDoc(colRef, {
        text: val,
        device: /iPhone/i.test(navigator.userAgent) ? "iPhone" : "Windows/PC",
        timestamp: serverTimestamp(),
        sender: user.uid.slice(0, 4)
      });
      addLog("送信完了", "success");
    } catch (err) {
      addLog(`送信失敗: ${err.message}`, "error");
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans p-4 md:p-8 flex flex-col items-center">
      
      {/* 1. 接続ステータス表示 */}
      <div className="w-full max-w-xl bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-white mb-6">
        <div className="bg-slate-900 p-6 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-orange-500 p-2 rounded-xl">
              <Activity className={user ? "animate-pulse" : ""} size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter italic">同期テストアプリ</h1>
              <p className="text-[10px] text-orange-300 font-bold uppercase tracking-widest">{VERSION}</p>
            </div>
          </div>
          <div className={`px-4 py-2 rounded-full text-xs font-black uppercase ${user ? 'bg-green-500/20 text-green-400' : 'bg-rose-500/20 text-rose-400 animate-pulse'}`}>
            {status}
          </div>
        </div>

        <div className="p-6 grid grid-cols-2 gap-4 border-b bg-slate-50/50">
          <div className="space-y-1">
            <p className="text-[10px] font-black text-slate-400 uppercase">実行デバイス</p>
            <p className="flex items-center gap-2 font-bold text-sm text-slate-700">
              {/iPhone/i.test(navigator.userAgent) ? <Smartphone size={16} /> : <Monitor size={16} />}
              {/iPhone/i.test(navigator.userAgent) ? "iPhone (Safari)" : "Windows (PC)"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-black text-slate-400 uppercase">セッションUID</p>
            <p className="font-mono text-[10px] text-blue-600 truncate bg-blue-50 px-2 py-1 rounded-lg">
              {user ? user.uid : '接続待ち...'}
            </p>
          </div>
        </div>
      </div>

      {/* 2. 送信テストフォーム */}
      <div className="w-full max-w-xl mb-10">
        <form onSubmit={handleSend} className="flex gap-3 bg-white p-3 rounded-[2rem] shadow-lg border border-white">
          <input 
            type="text" 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={user ? "ここに文字を入力して送信" : "クラウドに接続されるまでお待ちください"}
            className="flex-1 bg-slate-50 border-none rounded-2xl px-6 py-4 outline-none focus:ring-4 focus:ring-orange-500/10 font-bold text-slate-700"
            disabled={!user}
          />
          <button 
            type="submit" 
            disabled={!user || !inputText.trim()}
            className="bg-slate-900 text-white w-14 h-14 rounded-2xl shadow-xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-30"
          >
            <Send size={24} />
          </button>
        </form>
        <p className="text-center text-[10px] text-slate-400 mt-4 font-black uppercase tracking-widest">
          {user ? "送信した文字は全端末でリアルタイム共有されます" : "Firebase設定の読み込みを待機しています..."}
        </p>
      </div>

      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        
        {/* 3. クラウド受信リスト */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-2">
            <Database size={16} className="text-orange-500" />
            <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest italic">Shared Messages</h2>
          </div>
          <div className="space-y-3">
            {syncItems.length === 0 ? (
              <div className="bg-white/50 border-2 border-dashed rounded-[2.5rem] p-12 text-center text-slate-300 font-bold italic">
                データがまだありません。<br/>Windows側で送信してください。
              </div>
            ) : (
              syncItems.map(item => (
                <div key={item.id} className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 animate-in slide-in-from-bottom-2 duration-500">
                  <div className="flex justify-between items-center mb-2">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-tighter ${item.device === 'iPhone' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                      {item.device} (SENDER:{item.sender})
                    </span>
                    <span className="text-[9px] text-slate-300 font-mono">
                      {item.timestamp?.toDate().toLocaleTimeString('ja-JP')}
                    </span>
                  </div>
                  <p className="text-slate-800 font-black text-xl">{item.text}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 4. 日本語デバッグログコンソール */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-2">
            <Terminal size={16} className="text-slate-500" />
            <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest italic">System Logic Logs</h2>
          </div>
          <div className="bg-slate-900 rounded-[2.5rem] p-8 h-[500px] overflow-y-auto scrollbar-hide shadow-2xl border border-slate-800 font-mono">
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-700 italic text-xs">ログ出力を待機中...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="flex gap-3 mb-2.5 text-[10px] leading-relaxed border-b border-white/5 pb-2.5 last:border-0">
                  <span className="text-slate-600 shrink-0 select-none">[{log.time}]</span>
                  <span className={`font-bold ${
                    log.type === 'success' ? 'text-green-400' : 
                    log.type === 'error' ? 'text-rose-400' : 
                    log.type === 'warn' ? 'text-yellow-400' : 'text-blue-300'
                  }`}>
                    {log.msg}
                  </span>
                </div>
              ))
            )}
          </div>
          <button 
            onClick={() => window.location.reload()} 
            className="w-full py-5 bg-white hover:bg-slate-50 text-slate-900 rounded-3xl text-[10px] font-black uppercase tracking-[0.3em] shadow-xl border border-slate-200 transition-all active:scale-95"
          >
            システム再起動 (REBOOT)
          </button>
        </div>

      </div>

      <footer className="mt-16 mb-8 text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] text-center leading-loose">
        Unified Data Synchronization Test System<br/>
        Public Cloud Infrastructure • Gen_v3.86
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