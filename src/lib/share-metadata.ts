import { BRAND_IMAGE, BRAND_NAME } from "./brand";
import { getSiteUrl } from "./site-url";

export const SHARE_TITLE = BRAND_NAME;
export const SHARE_DESCRIPTION = "2026年10月31日–11月2日，图卢兹三日共享行程。添加活动，接龙报名。";
export const SHARE_IMAGE_ALT = "图卢兹加龙河、新桥与老城";
export const SITE_URL = getSiteUrl();
export const SHARE_IMAGE_URL = new URL(BRAND_IMAGE, SITE_URL).href;
