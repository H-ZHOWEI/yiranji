// 以苒纪 — 应用级偏好设置（与具体家谱项目无关，存 localStorage）
//
// 目前包含：
// - defaultSaveDir：新建家谱档案时的默认父目录（用户可在"设置 → 档案存储"中修改）

const PREFS_KEY = 'yiranji_app_prefs';

export interface AppPrefs {
  /** 新建档案默认保存到的父目录；为空表示每次新建都弹出选择框 */
  defaultSaveDir?: string;
}

export function getAppPrefs(): AppPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as AppPrefs;
  } catch {
    return {};
  }
}

function saveAppPrefs(prefs: AppPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage 不可用时静默失败
  }
}

/** 读取默认保存目录（未设置返回空字符串） */
export function getDefaultSaveDir(): string {
  return getAppPrefs().defaultSaveDir || '';
}

/** 设置默认保存目录；传空字符串表示清除（恢复为每次询问） */
export function setDefaultSaveDir(dir: string) {
  const prefs = getAppPrefs();
  if (dir) {
    prefs.defaultSaveDir = dir;
  } else {
    delete prefs.defaultSaveDir;
  }
  saveAppPrefs(prefs);
}

/** 取路径的最后一级目录名，用于界面提示 */
export function getFolderName(path: string): string {
  if (!path) return '';
  const normalized = path.replace(/[\\/]+$/, '');
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}
