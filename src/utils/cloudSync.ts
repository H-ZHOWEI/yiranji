// 以苒纪 — 多设备云同步（WebDAV）
//
// 云端只存三样东西：project.json、media/ 下的媒体文件、sync.json（同步元信息）。
// 上传时只补齐云端缺失的媒体，所以同一个家谱反复同步几乎不消耗流量。

import type { FamilyProject } from '../types';

const SETTINGS_KEY = 'yiranji_sync_settings_v1';

export interface SyncSettings {
  /** 总开关：关掉后不显示云端更新提示 */
  enabled: boolean;
  /** WebDAV 服务地址，如 https://dav.jianguoyun.com/dav/ */
  server: string;
  username: string;
  password: string;
  /** 云端根目录（每个家谱会再建一个以同步 ID 命名的子目录） */
  remoteRoot: string;
  /** 打开档案时自动检查云端是否有更新 */
  autoCheck: boolean;
  /** 保存档案后自动把改动传到云端（静默、去抖，失败不影响保存） */
  autoPush: boolean;
  /** 允许用本地覆盖云端的较新版本 */
  forceOverwrite: boolean;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: false,
  server: '',
  username: '',
  password: '',
  remoteRoot: 'yiranji',
  autoCheck: true,
  autoPush: false,
  forceOverwrite: false,
};

/** 常见免费 WebDAV 服务，用于输入框提示 */
export const WEBDAV_PRESETS = [
  {
    name: '坚果云',
    server: 'https://dav.jianguoyun.com/dav/',
    hint: '账号为注册邮箱；密码需在「账户信息 → 安全选项 → 添加应用密码」生成，不是登录密码。',
  },
  {
    name: 'InfiniCLOUD',
    server: 'https://(你的服务器号).teracloud.jp/dav/',
    hint: '注册即免费 20GB，无流量限制；服务器号在个人中心首页可见。',
  },
  {
    name: 'Nextcloud / 群晖',
    server: 'https://your-host/remote.php/dav/files/用户名/',
    hint: '自建服务请使用 WebDAV 完整地址，路径一般以 remote.php/dav/files/ 开头。',
  },
];

export function getSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SYNC_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    return { ...DEFAULT_SYNC_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SYNC_SETTINGS };
  }
}

export function saveSyncSettings(patch: Partial<SyncSettings>): SyncSettings {
  const next = { ...getSyncSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/** 是否已经填好足够发起同步的信息 */
export function isSyncConfigured(s: SyncSettings = getSyncSettings()): boolean {
  return !!s.server.trim() && !!s.username.trim() && !!s.password;
}

/** 同步目录名：每个家谱一个稳定 ID，改名 / 换电脑都不会错位 */
export function remoteDirFor(settings: SyncSettings, syncKey: string): string {
  const root = (settings.remoteRoot || 'yiranji').trim().replace(/^\/+|\/+$/g, '');
  return `${root}/${syncKey}`;
}

/** 取家谱的同步 ID，没有则生成（调用方负责写回 meta 并保存） */
export function ensureSyncKey(project: FamilyProject): { key: string; created: boolean } {
  const existing = project.meta.syncKey;
  if (existing) return { key: existing, created: false };
  const key =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return { key, created: true };
}

/** 把 ISO 时间格式化成「10-19 14:24」 */
export function formatSyncTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 人类可读的体积 */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
