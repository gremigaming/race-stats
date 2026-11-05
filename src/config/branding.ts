const configuredAppName = import.meta.env.VITE_APP_NAME?.trim();

export const APP_NAME = configuredAppName || "GreMi Gaming F1 Lobby Manager";
export const APP_BRAND_LINE = configuredAppName || "GreMi Gaming";
export const APP_SUBTITLE = configuredAppName ? "" : "F1 Lobby Manager";
export const PNG_VERSION_TITLE_PREFIX = `${APP_NAME} - Save`;
