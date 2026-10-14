import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/unbounded/600.css';
import '@fontsource/unbounded/700.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/pt-serif/400.css';
import '@fontsource/pt-serif/700.css';
import './assets/fonts/fonts.css';
import './styles.css';

import { mountApp } from './ui/app';
import { mountExportPanel } from './ui/export-panel';
import { createStore } from './ui/state';
import './styles/studio-v3.css';

const root = document.getElementById('app');
if (!root) throw new Error('Не найден контейнер #app');

const store = createStore();
mountApp(root, store);
mountExportPanel(store);
