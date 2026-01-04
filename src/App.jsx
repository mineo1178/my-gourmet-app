import React, { useState, useEffect, useMemo, useRef, Component } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, onSnapshot, 
  query, serverTimestamp, doc, setDoc 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, 
  signInWithCustomToken, setPersistence, browserLocalPersistence 
} from 'firebase/auth';
import { 
  Cloud, WifiOff, Send, Terminal, Loader2, 
  AlertCircle, CheckCircle2, Database, RefreshCcw, 
  Smartphone, Monitor, Globe, ShieldAlert
} from 'lucide-react';

// ★ バージョン定義
const VERSION = "Gen_v3.85-SYNC-DEBUG-FIX";

// --- A. ErrorBoundary コンポーネント (修正: 定義を追加) ---
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white p-8 font-mono flex flex-col items-center justify-center text-center">
          <ShieldAlert size={64} className="text-rose-500 mb-6 animate-pulse" />
          <h1 className="text-2xl font-black uppercase mb-2">システムエラーが発生しました</h1>
          <div className="bg-black/50 p-6 rounded-2xl border border-rose-500/30 max-w-lg mb-8 text-left overflow-auto">
            <p className="text-rose-400 font-bold text-sm break-all">
              {this.state.error?.toString() || "不明なレンダリングエラー"}
            </p>
          </div>
          <button 
            onClick={() => window.location.reload()} 
            className="px-10 py-4 bg-white text-slate-900 rounded-2xl font-black uppercase shadow-2xl active:scale-95 transition-all"
          >
            アプリを再起動する
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- B. アプリケーション本体 ---
const AppContent = () => {
  const [logs, setLogs] = useState([]);
  const [syncData, setSyncData] = useState([]);
  const [inputText, setInputText] = useState('');
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('初期化中...');
  const [isConnecting, setIsConnecting] = useState(false);

  // Firebase インスタンス管理
  const [instances, setInstances] = useState({ auth: null, db: null });
  
  // アプリIDと環境設定の取得
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'debug-sync-v1';

  // ログ追加関数
  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 100));
  };

  // --- Step 1: Firebase エンジンの起動 ---
  useEffect(() => {
    const boot = async () => {
      addLog("システム起動: 設定のチェックを開始...", "info");
      
      try {
        if (typeof __firebase_config === 'undefined' || !__firebase_config) {
          addLog("警告: Firebase設定が見つかりません。環境からの注入を待機中...", "warn");
          setStatus("設定待機中");
          setTimeout(boot, 3000);
          return;
        }

        addLog("設定検知: SDKの初期化を実行します。", "info");
        const config = JSON.parse(__firebase_config);
        const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
        const auth = getAuth(app);
        const db = getFirestore(app);

        addLog("初期化完了: 認証シーケンスへ移行します。", "success");

        // 匿名認証の実行 (Rule 3)
        addLog("認証試行: 匿名ログインを開始...", "info");
        await setPersistence(auth, browserLocalPersistence);
        
        let cred;
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          addLog("カスタムトークンを使用してログインします...", "info");
          cred = await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          addLog("標準の匿名認証を使用してログインします...", "info");
          cred = await signInAnonymously(auth);
        }

        setUser(cred.user);
        setInstances({ auth, db });
        addLog(`認証成功: ユーザーID ${cred.user.uid.slice(0, 12)}...`, "success");
        setStatus("接続済み");
      } catch (err) {
        addLog(`起動致命的エラー: ${err.message}`, "error");
        setStatus("エラー発生");
        setTimeout(boot, 5000); // 5秒後に再試行
      }
    };

    boot();
  }, []);

  // --- Step 2: リアルタイム同期の開始 (Rule 1 & 3) ---
  useEffect(() => {
    if (!user || !instances.db) return;

    addLog(`同期準備: パス /artifacts/${appId}/public/data/debug_messages を監視します。`, "info");
    setIsConnecting(true);

    const colRef = collection(instances.db, 'artifacts', appId, 'public', 'data', 'debug_messages');
    
    addLog("Firestore: 監視リスナー(onSnapshot)を登録しました。", "info");
    
    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      addLog(`更新検知: クラウドから ${snapshot.docs.length} 件のデータを取得しました。`, "success");
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const sorted = items.sort((a, b) => {
        const timeA = a.timestamp?.seconds || 0;
        const timeB = b.timestamp?.seconds || 0;
        return timeB - timeA;
      });
      
      setSyncData(sorted);
      setIsConnecting(false);
    }, (err) => {
      setIsConnecting(false);
      addLog(`Firestoreエラー検知: ${err.code} - ${err.message}`, "error");
      if (err.code === 'permission-denied') {
        addLog("致命的: 権限エラーです。パス設定(Rule 1)が正しくありません。", "error");
      }
    });

    return () => {
      addLog("同期解除: リスナーを破棄しました。", "info");
      unsubscribe();
    };
  }, [user, instances.db, appId]);

  // --- 送信処理 ---
  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !user || !instances.db) {
      addLog("送信拒否: 接続が完了していないか入力が空です。", "warn");
      return;
    }

    const textToSend = inputText;
    setInputText('');
    addLog(`書き込み開始: "${textToSend}" をクラウドへ送信します。`, "info");

    try {
      const colRef = collection(instances.db, 'artifacts', appId, 'public', 'data', 'debug_messages');
      await addDoc(colRef, {
        text: textToSend,
        senderId: user.uid.slice(0, 5),
        device: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "iPhone" : "Windows/PC",
        timestamp: serverTimestamp()
      });
      addLog("書き込み成功: クラウドDBへの保存が完了しました。", "success");
    } catch (err) {
      addLog(`書き込み失敗: ${err.message}`, "error");
    }
  };

  return (
    <div className="min-h-screen bg-[#F0F2F5] text-slate-900 font-sans p-4 md:p-8 flex flex-col items-center">
      
      {/* ヘッダーパネル */}
      <div className="w-full max-w-2xl bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-white mb-6">
        <div className="bg-slate-900 p-6 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl">
              <RefreshCcw className={`${isConnecting ? 'animate-spin' : ''}`} size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter italic">Cloud Sync Monitor</h1>
              <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">{VERSION}</p>
            </div>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black uppercase ${user ? 'bg-green-500/20 text-green-400' : 'bg-rose-500/20 text-rose-400 animate-pulse'}`}>
            {user ? <CheckCircle2 size={14} /> : <Loader2 size={14} className="animate-spin" />}
            {status}
          </div>
        </div>

        <div className="p-6 grid grid-cols-2 gap-4 border-b bg-slate-50/50">
          <div className="space-y-1">
            <p className="text-[10px] font-black text-slate-400 uppercase">デバイス</p>
            <p className="flex items-center gap-2 font-bold text-sm text-slate-700">
              {/iPhone/i.test(navigator.userAgent) ? <Smartphone size={16} /> : <Monitor size={16} />}
              {/iPhone/i.test(navigator.userAgent) ? "iPhone (Safari/Mobile)" : "Windows (Chrome/PC)"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-black text-slate-400 uppercase">同期フォルダ</p>
            <p className="flex items-center gap-2 font-bold text-[10px] text-blue-600 truncate bg-blue-50 px-2 py-1 rounded-lg">
              <Globe size={12} /> public/data/debug_messages
            </p>
          </div>
        </div>
      </div>

      {/* 送信フォーム */}
      <div className="w-full max-w-2xl mb-8">
        <form onSubmit={handleSend} className="flex gap-3 bg-white p-3 rounded-[2rem] shadow-lg border border-white">
          <input 
            type="text" 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={user ? "メッセージを入力して送信..." : "接続準備中..."}
            className="flex-1 bg-slate-50 border-none rounded-2xl px-6 py-4 outline-none focus:ring-4 focus:ring-blue-500/10 font-bold text-slate-700"
            disabled={!user}
          />
          <button 
            type="submit" 
            disabled={!user || !inputText.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white w-14 h-14 rounded-2xl shadow-xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-30 disabled:grayscale"
          >
            <Send size={24} />
          </button>
        </form>
        <p className="text-center text-[10px] text-slate-400 mt-3 font-bold uppercase tracking-widest">Real-time Cross-Platform Communication</p>
      </div>

      <div className="w-full max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        
        {/* 同期データリスト */}
        <div className="space-y-4 order-2 md:order-1">
          <div className="flex items-center gap-2 px-2">
            <Database size={16} className="text-blue-500" />
            <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest italic">Shared Cloud Data</h2>
          </div>
          <div className="space-y-3">
            {syncData.length === 0 ? (
              <div className="bg-white/50 border-2 border-dashed rounded-[2.5rem] p-12 text-center text-slate-300 font-bold italic">
                データがありません。<br/>Windows側で送信してください。
              </div>
            ) : (
              syncData.map(item => (
                <div key={item.id} className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-100 animate-in slide-in-from-bottom-2 duration-500">
                  <div className="flex justify-between items-center mb-2">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-tighter ${item.device === 'iPhone' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                      {item.device} (ID:{item.senderId})
                    </span>
                    <span className="text-[9px] text-slate-300 font-mono">
                      {item.timestamp?.toDate().toLocaleTimeString('ja-JP')}
                    </span>
                  </div>
                  <p className="text-slate-800 font-black text-lg">{item.text}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 詳細デバッグコンソール */}
        <div className="space-y-4 order-1 md:order-2">
          <div className="flex items-center gap-2 px-2">
            <Terminal size={16} className="text-slate-500" />
            <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest italic">Debug Engine Log</h2>
          </div>
          <div className="bg-slate-900 rounded-[2.5rem] p-8 h-[450px] overflow-y-auto scrollbar-hide shadow-2xl border border-slate-800 font-mono">
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-700 italic text-xs">
                ブートログを待機中...
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="flex gap-3 mb-2.5 text-[10px] leading-relaxed border-b border-white/5 pb-2.5 last:border-0">
                  <span className="text-slate-600 shrink-0 select-none">[{log.time}]</span>
                  <span className={`font-bold ${
                    log.type === 'success' ? 'text-green-400' : 
                    log.type === 'error' ? 'text-rose-400' : 
                    log.type === 'warn' ? 'text-yellow-400' : 
                    log.type === 'info' ? 'text-blue-300' : 'text-slate-400'
                  }`}>
                    {log.msg}
                  </span>
                </div>
              ))
            )}
          </div>
          <button 
            onClick={() => window.location.reload()} 
            className="w-full py-5 bg-white hover:bg-slate-100 text-slate-900 rounded-3xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl transition-all active:scale-95 border border-slate-200"
          >
            システム再起動
          </button>
        </div>

      </div>

      <footer className="mt-16 mb-8 text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] text-center leading-loose">
        Authentication & Synchronization Resilient Engine<br/>
        Unified Cloud Infrastructure • Gen_v3.85
      </footer>
    </div>
  );
};

// メインの App コンポーネント (ErrorBoundary で包む)
const App = () => (
  <ErrorBoundary>
    <AppContent />
  </ErrorBoundary>
);

export default App;