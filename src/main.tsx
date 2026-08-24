import { render } from 'preact';
import { App } from './app';
import './style.css';
import './sync/testhook';

// Keep IndexedDB from being evicted under storage pressure.
if (navigator.storage?.persist) {
  void navigator.storage.persist();
}

render(<App />, document.getElementById('app')!);
