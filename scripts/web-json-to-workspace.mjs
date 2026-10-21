#!/usr/bin/env node
// 以苒纪 — 网页版导出的 JSON → 桌面版档案工作区文件夹
//
// 用法：
//   node scripts/web-json-to-workspace.mjs <导出的.json> [输出目录]
//
// 输入可以是单个工程对象，也可以是工程数组（控制台脚本一次导出多个项目时）。
// 输出结构与桌面版一致：
//   <输出目录>/<家谱名>/project.json
//   <输出目录>/<家谱名>/media/avatar_xxx.png ...
//
// 生成后，在桌面版欢迎页点「打开文件夹」，选中 <输出目录>/<家谱名> 即可。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/bmp': 'bmp', 'image/heic': 'heic', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac',
};

const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');

function extFromDataUrl(url) {
  const m = /^data:([^;,]+)/i.exec(url);
  const mime = (m?.[1] || '').toLowerCase();
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const sub = mime.split('/')[1]?.split('+')[0] || '';
  return sub.replace(/[^a-z0-9]/g, '') || 'bin';
}

function safeName(name) {
  const cleaned = String(name || '以苒纪家谱')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || '以苒纪家谱';
}

function uniqueDir(parent, base) {
  let candidate = path.join(parent, base);
  let i = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parent, `${base}(${i})`);
    i += 1;
  }
  return candidate;
}

function convertOne(rawProject, outRoot) {
  const project = JSON.parse(JSON.stringify(rawProject));
  if (!project?.meta || !project?.persons) {
    throw new Error('缺少 meta 或 persons，不是有效的以苒纪工程数据');
  }

  const workspace = uniqueDir(outRoot, safeName(project.meta.familyName));
  const mediaDir = path.join(workspace, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  // 与桌面版一致的路径写法：正斜杠
  const mediaBase = workspace.replace(/\\/g, '/').replace(/\/+$/, '') + '/media/';
  let mediaCount = 0;

  const take = (value, prefix) => {
    if (!isDataUrl(value)) return value;
    const filename = `${prefix}_${crypto.randomUUID()}.${extFromDataUrl(value)}`;
    const base64 = value.slice(value.indexOf(',') + 1);
    fs.writeFileSync(path.join(mediaDir, filename), Buffer.from(base64, 'base64'));
    mediaCount += 1;
    return mediaBase + filename;
  };

  Object.values(project.persons).forEach((person) => {
    person.avatar = take(person.avatar, 'avatar');
    person.avatarRect = take(person.avatarRect, 'avatar_rect');
    (person.photos || []).forEach((x) => { x.path = take(x.path, 'photo'); });
    (person.audioFiles || []).forEach((x) => { x.path = take(x.path, 'audio'); });
    (person.videoFiles || []).forEach((x) => {
      x.path = take(x.path, 'video');
      x.thumbnail = take(x.thumbnail, 'video_thumb');
    });
  });

  const personCount = Object.keys(project.persons).length;
  project.meta = { ...project.meta, updatedAt: new Date().toISOString() };

  fs.writeFileSync(
    path.join(workspace, 'project.json'),
    JSON.stringify(project, null, 2),
    'utf8'
  );

  return { workspace, personCount, mediaCount };
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('用法: node scripts/web-json-to-workspace.mjs <导出的.json> [输出目录]');
    process.exit(1);
  }
  const inputPath = path.resolve(input);
  if (!fs.existsSync(inputPath)) {
    console.error(`找不到文件：${inputPath}`);
    process.exit(1);
  }

  const outRoot = path.resolve(
    process.argv[3] || path.join(path.dirname(inputPath), '以苒纪档案')
  );
  fs.mkdirSync(outRoot, { recursive: true });

  const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : [parsed];

  console.log(`输出目录：${outRoot}`);
  console.log(`共 ${list.length} 个工程\n`);

  list.forEach((p, idx) => {
    try {
      const { workspace, personCount, mediaCount } = convertOne(p, outRoot);
      console.log(`✓ [${idx + 1}] ${p?.meta?.familyName || '(未命名)'}`);
      console.log(`    人员 ${personCount} 位，还原媒体 ${mediaCount} 个`);
      console.log(`    → ${workspace}\n`);
    } catch (e) {
      console.error(`✗ [${idx + 1}] 转换失败：${e.message}\n`);
    }
  });

  console.log('完成。桌面版欢迎页点「打开文件夹」，选中上面列出的目录即可。');
}

main();
