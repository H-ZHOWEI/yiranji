// 以苒纪 — 工程数据可移植化（网页版 ⇄ 桌面版迁移）
//
// 背景：
// - 网页版（浏览器）把整个工程塞在 localStorage 里，头像/照片/音视频都以 data URL（base64）内嵌，
//   用户在自己电脑上找不到任何"文件"。
// - 桌面版把工程存成工作区文件夹：project.json + media/ 实体文件，路径为工作区绝对路径。
// - 因此迁移时必须：导出侧把工程序列化成一个 json 文件（内嵌媒体保持 base64），
//   导入侧再把这些 base64 逐个还原成 media/ 下的实体文件，并改写为绝对路径。
//
// 本模块只做纯数据变换，不碰文件系统，方便单测。

import type { FamilyProject, Person } from '../types';
import { isTauri } from './tauri';

/** 内嵌媒体在导出 JSON 中的占位前缀，导入时替换成真实工作区路径 */
export const MEDIA_PLACEHOLDER_PREFIX = '__YIRANJI_MEDIA__/';

/** 一条需要落地为实体文件的内嵌媒体 */
export interface EmbeddedMediaItem {
  filename: string;
  /** 保证为 base64 形式的 data URL */
  dataUrl: string;
}

export interface ExtractedProject {
  project: FamilyProject;
  media: EmbeddedMediaItem[];
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
};

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function extFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;,]+)/i.exec(dataUrl);
  const mime = (m?.[1] || '').toLowerCase();
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const sub = mime.split('/')[1]?.split('+')[0];
  const cleaned = sub ? sub.replace(/[^a-z0-9]/g, '') : '';
  return cleaned || 'bin';
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * 统一成 `data:xxx;base64,` 形式。
 * 少数来源（如手写 SVG）会是 URL 编码而非 base64，这里转一下，
 * 否则后端按 base64 解码会得到损坏文件。
 */
export function ensureBase64DataUrl(raw: string): string {
  if (/^data:[^,]*;base64,/i.test(raw)) return raw;
  const idx = raw.indexOf(',');
  if (idx === -1) return raw;
  const header = raw.slice(0, idx);
  const payload = raw.slice(idx + 1);
  try {
    return `${header};base64,${toBase64(decodeURIComponent(payload))}`;
  } catch {
    return raw;
  }
}

/** 该字符串是否为内嵌媒体（data URL） */
function isDataUrl(value?: string): boolean {
  return !!value && value.startsWith('data:');
}

/** 工程里是否存在内嵌媒体（用于提示"导出体积会较大"） */
export function hasEmbeddedMedia(project: FamilyProject | null | undefined): boolean {
  if (!project?.persons) return false;
  return Object.values(project.persons).some((p) => {
    if (isDataUrl(p.avatar) || isDataUrl(p.avatarRect)) return true;
    if ((p.photos || []).some((x) => isDataUrl(x.path))) return true;
    if ((p.audioFiles || []).some((x) => isDataUrl(x.path))) return true;
    if ((p.videoFiles || []).some((x) => isDataUrl(x.path) || isDataUrl(x.thumbnail))) return true;
    return false;
  });
}

/**
 * 把工程中所有内嵌媒体抽出来，原位替换为占位路径。
 * 默认先深拷贝（调用方不希望原对象被改动）；导入流程传入 { clone: false }，
 * 避免给含大量照片/视频的工程再复制一份、撑爆浏览器内存。
 */
export function extractEmbeddedMedia(
  project: FamilyProject,
  options: { clone?: boolean } = {}
): ExtractedProject {
  const clone = options.clone === false
    ? project
    : (JSON.parse(JSON.stringify(project)) as FamilyProject);
  const media: EmbeddedMediaItem[] = [];

  const take = (value: string | undefined, prefix: string): string | undefined => {
    if (!isDataUrl(value)) return value;
    const dataUrl = ensureBase64DataUrl(value as string);
    const filename = `${prefix}_${genId()}.${extFromDataUrl(dataUrl)}`;
    media.push({ filename, dataUrl });
    return MEDIA_PLACEHOLDER_PREFIX + filename;
  };

  Object.values(clone.persons || {}).forEach((person: Person) => {
    person.avatar = take(person.avatar, 'avatar');
    person.avatarRect = take(person.avatarRect, 'avatar_rect');

    (person.photos || []).forEach((photo) => {
      photo.path = take(photo.path, 'photo') as string;
    });
    (person.audioFiles || []).forEach((audio) => {
      audio.path = take(audio.path, 'audio') as string;
    });
    (person.videoFiles || []).forEach((video) => {
      video.path = take(video.path, 'video') as string;
      video.thumbnail = take(video.thumbnail, 'video_thumb');
    });
  });

  return { project: clone, media };
}

/**
 * 把占位路径还原为工作区内的绝对媒体路径（统一用 / 拼接，与现有媒体路径写法一致）。
 */
export function applyWorkspaceMediaPaths(project: FamilyProject, workspacePath: string): FamilyProject {
  // 统一分隔符并压掉重复斜杠，避免出现 D://家谱//xxx 这类不合法路径
  const normalized = workspacePath.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  const base = `${normalized}/media/`;

  const fix = (value?: string): string | undefined => {
    if (!value || !value.startsWith(MEDIA_PLACEHOLDER_PREFIX)) return value;
    return base + value.slice(MEDIA_PLACEHOLDER_PREFIX.length);
  };

  Object.values(project.persons || {}).forEach((person: Person) => {
    person.avatar = fix(person.avatar);
    person.avatarRect = fix(person.avatarRect);

    (person.photos || []).forEach((photo) => {
      photo.path = fix(photo.path) as string;
    });
    (person.audioFiles || []).forEach((audio) => {
      audio.path = fix(audio.path) as string;
    });
    (person.videoFiles || []).forEach((video) => {
      video.path = fix(video.path) as string;
      video.thumbnail = fix(video.thumbnail);
    });
  });

  return project;
}

/**
 * 从另一台电脑同步回来的工程，媒体路径仍是那台电脑的绝对路径。
 * 这里把每条媒体路径重新指向本机工作区的 media/ 目录（按 /media/ 之后的相对路径还原）。
 *
 * @param onChange 每改写一条路径回调一次，调用方可据此判断是否需要回写 project.json
 */
export function rebaseMediaPathsToWorkspace(
  project: FamilyProject,
  workspacePath: string,
  onChange?: () => void
): FamilyProject {
  const normalized = workspacePath.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  const base = `${normalized}/media/`;
  const MEDIA_MARK = '/media/';

  const fix = (value?: string): string | undefined => {
    if (!value) return value;
    if (value.startsWith('data:') || value.startsWith('http') || value.startsWith('blob:')) {
      return value;
    }
    const posix = value.replace(/\\/g, '/');
    const idx = posix.lastIndexOf(MEDIA_MARK);
    const relative = idx >= 0 ? posix.slice(idx + MEDIA_MARK.length) : posix.split('/').pop() || '';
    if (!relative) return value;
    const target = base + relative;
    // 已经是本机正确路径就不动，避免无意义地改写
    if (target === posix) return value;
    onChange?.();
    return target;
  };

  Object.values(project.persons || {}).forEach((person: Person) => {
    person.avatar = fix(person.avatar);
    person.avatarRect = fix(person.avatarRect);

    (person.photos || []).forEach((photo) => {
      photo.path = fix(photo.path) as string;
    });
    (person.audioFiles || []).forEach((audio) => {
      audio.path = fix(audio.path) as string;
    });
    (person.videoFiles || []).forEach((video) => {
      video.path = fix(video.path) as string;
      video.thumbnail = fix(video.thumbnail);
    });
  });

  return project;
}

/** 校验一个对象是否像以苒纪工程（导入前的兜底检查） */
export function isValidProjectShape(value: any): value is FamilyProject {
  return !!value && typeof value === 'object' && !!value.meta && !!value.persons
    && typeof value.persons === 'object';
}

/** 从安全文件名中取出可用作文件夹名的家谱名 */
export function safeFolderName(familyName: string): string {
  const cleaned = (familyName || '以苒纪家谱')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || '以苒纪家谱';
}

/** 统计工程里的内嵌媒体数量（导出前提示用） */
export function countEmbeddedMedia(project: FamilyProject | null | undefined): number {
  if (!project?.persons) return 0;
  let count = 0;
  const add = (v?: string) => {
    if (isDataUrl(v)) count += 1;
  };
  Object.values(project.persons).forEach((p) => {
    add(p.avatar);
    add(p.avatarRect);
    (p.photos || []).forEach((x) => add(x.path));
    (p.audioFiles || []).forEach((x) => add(x.path));
    (p.videoFiles || []).forEach((x) => {
      add(x.path);
      add(x.thumbnail);
    });
  });
  return count;
}

/**
 * 把当前工程导出成一个独立的 .json 文件。
 * - 浏览器模式：直接触发下载（这就是网页版数据的"落地"方式）
 * - 桌面模式：弹原生保存对话框
 *
 * 导出的 JSON 是完整工程（含 base64 照片、音视频），桌面版导入后可完整还原。
 */
export async function exportProjectFile(
  project: FamilyProject,
  fileName: string
): Promise<'saved' | 'cancelled'> {
  const json = JSON.stringify(project, null, 2);

  if (isTauri()) {
    const { saveExportFile, textToBase64 } = await import('./exportUtils');
    return saveExportFile(fileName, '以苒纪工程数据 (*.json)', ['json'], textToBase64(json));
  }

  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'saved';
}
