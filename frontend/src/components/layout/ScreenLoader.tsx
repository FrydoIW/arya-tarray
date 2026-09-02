export function ScreenLoader() {
  return (
    <div className="screen-loader" role="status" aria-live="polite">
      <span className="screen-loader-mark" aria-hidden="true" />
      <span>Loading workspace…</span>
    </div>
  );
}
