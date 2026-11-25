const configuredAppName = import.meta.env.VITE_APP_NAME?.trim();

export const APP_NAME = configuredAppName || "GridMi";
export const APP_BRAND_LINE = APP_NAME;
export const APP_SUBTITLE = "GreMi Gang race stats";
export const PNG_VERSION_TITLE_PREFIX = `${APP_NAME} - Save`;
