/**
 * The app's name as people see it ("MC Bank"), from the build's label. The
 * dev build's label adds " Dev" for its home-screen icon; inside the app it's
 * the same name. (The project and repository are still called FinPair.)
 */
export const APP_NAME = (import.meta.env.VITE_APP_LABEL || 'MC Bank').replace(/ Dev$/, '');
