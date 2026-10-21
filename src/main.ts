import './styles.css';
import { App } from './app/App';

const app = new App(document.getElementById('viewport')!, document.getElementById('ui')!);
// development hook for automated visual checks
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
