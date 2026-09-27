/** Path to a file in `public/`, respecting Vite `base` (e.g. GitHub Pages project URL). */
export function publicUrl(path: string): string {
  const trimmed = path.replace(/^\//, "");
  return `${import.meta.env.BASE_URL}${trimmed}`;
}

/** Absolute URL for a `public/` asset (needed when `origin` alone omits the deploy base path). */
export function publicAbsoluteUrl(path: string): string {
  return new URL(publicUrl(path), window.location.href).href;
}
