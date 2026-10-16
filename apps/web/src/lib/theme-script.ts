// Server-safe half of the theme logic (theme.ts is a client module).

export const THEME_STORAGE_KEY = 'ie-theme';

/** Runs in <head> before hydration so the stored theme applies before first paint. */
export const themeInitScript = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
