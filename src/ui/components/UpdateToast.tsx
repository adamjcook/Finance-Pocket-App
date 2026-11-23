import { useRegisterSW } from 'virtual:pwa-register/preact';

/** "Update available" prompt so both phones move to new versions deliberately. */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div class="toast" role="status">
      <span style="flex:1">A new version is ready.</span>
      <button class="btn-primary" onClick={() => void updateServiceWorker(true)}>
        Update
      </button>
      <button class="btn-quiet" onClick={() => (setNeedRefresh as (v: boolean) => void)(false)}>Later</button>
    </div>
  );
}
