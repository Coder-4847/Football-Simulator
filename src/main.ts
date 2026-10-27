import './ui/theme.css';
import { App } from './ui/app';

const params = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
if (params.get('debug') === 'pose') {
  const canvas = document.createElement('canvas'); root.appendChild(canvas);
  void import('./debug/posegrid').then((m) => m.poseGrid(canvas));
} else if (params.get('debug') === 'match') {
  const canvas = document.createElement('canvas'); const wrap = document.createElement('div'); wrap.appendChild(canvas); root.appendChild(wrap);
  void import('./debug/matchpreview').then((m) => m.matchPreview(canvas, params));
} else {
  const app = new App(root);
  (window as unknown as { __app: App }).__app = app;
  void import('./ui/extra').then((m) => m.registerExtras(app)).catch(() => undefined);
  void app.boot();
}
