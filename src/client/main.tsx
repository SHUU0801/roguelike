import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startSync } from './account';
import './styles.css';

/**
 * StrictMode を付けていないのは意図的。
 * StrictMode は開発中に useEffect を2回走らせるため、サーバーの部屋に2回入ろうとして
 * 「満員で入れない」エラーになる。原因が分かりにくい割に v0 では得が無いので外してある。
 */
/*
 * ログインしていれば、記録が変わるたびにサーバーへ上げる。
 * React の外で始めるのは、**潜っている最中も効かせたいから**。
 * 画面のどこを開いていても関係なく、保存した瞬間に効く。
 */
startSync();

const root = document.getElementById('root');
if (!root) throw new Error('#root が見つからない');

createRoot(root).render(<App />);
