import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

/**
 * StrictMode を付けていないのは意図的。
 * StrictMode は開発中に useEffect を2回走らせるため、サーバーの部屋に2回入ろうとして
 * 「満員で入れない」エラーになる。原因が分かりにくい割に v0 では得が無いので外してある。
 */
const root = document.getElementById('root');
if (!root) throw new Error('#root が見つからない');

createRoot(root).render(<App />);
