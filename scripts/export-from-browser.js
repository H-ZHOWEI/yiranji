// 以苒纪 — 网页版数据导出（浏览器控制台脚本）
//
// 使用场景：你用的是网页版（浏览器里打开的那个），想把数据搬到桌面版。
// 步骤：
//   1. 在网页版页面按 F12 打开开发者工具，切到「控制台 / Console」
//   2. 把本文件全部内容复制粘贴进去，回车
//   3. 浏览器会逐个下载 .json 文件（含全部照片、音频、视频）
//      如果弹出"是否允许下载多个文件"，点「允许」
//   4. 把下载到的 .json 交给桌面版「导入工程文件」，或用 scripts/web-json-to-workspace.mjs 转成档案文件夹
//
// 说明：网页版的数据存在浏览器的 localStorage 里，键名以 yiranji_project_ 开头。
// 清缓存 / 换浏览器 / 换电脑都会读不到，所以务必先导出备份。

(function exportYiranjiProjects() {
  var keys = Object.keys(localStorage).filter(function (k) {
    return k.indexOf('yiranji_project_') === 0;
  });

  if (!keys.length) {
    console.warn('没有找到以苒纪数据（localStorage 里没有 yiranji_project_ 开头的键）');
    alert('没有找到以苒纪数据。请确认当前页面就是你的家谱网页版，并已打开过家谱。');
    return;
  }

  var projects = keys
    .map(function (k) {
      try {
        var p = JSON.parse(localStorage.getItem(k));
        return p && p.meta && p.persons ? p : null;
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);

  if (!projects.length) {
    alert('找到了数据键，但内容无法解析，可能是数据已损坏。');
    return;
  }

  console.log('找到 ' + projects.length + ' 个家谱工程，开始导出…');

  projects.forEach(function (p, i) {
    setTimeout(function () {
      var name = (p.meta && p.meta.familyName ? p.meta.familyName : '以苒纪家谱') + '.json';
      var blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      console.log('已导出：' + name + '（' + Object.keys(p.persons).length + ' 位人员）');
    }, i * 900);
  });

  setTimeout(function () {
    alert('已开始导出 ' + projects.length + ' 个文件，请查看浏览器的下载记录。\n\n如果没反应，请允许本站点"下载多个文件"。');
  }, 300);
})();
