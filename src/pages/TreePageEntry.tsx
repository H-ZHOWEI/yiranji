import { useEffect, useState } from 'react';
import TreePage from './TreePage';
import TreePageClassic from './TreePageClassic';
import { getTreeDisplayMode, TREE_DISPLAY_MODE_EVENT, type TreeDisplayMode } from '../utils/appPrefs';

/**
 * 家谱树入口：按用户的「家谱树显示」设置选择页面实现。
 * - classic（经典模式）：完全使用作者原版页面 TreePageClassic（原布局、原卡片、原连线）
 * - enhanced（增强模式）：使用改良版 TreePage（生父/生母贴牌、横杠只画一次、同辈长幼标记等）
 * 两套页面互不影响，切换后重新挂载，避免状态串味。
 */
export default function TreePageEntry() {
  const [mode, setMode] = useState<TreeDisplayMode>(() => getTreeDisplayMode());

  useEffect(() => {
    const onChange = () => setMode(getTreeDisplayMode());
    window.addEventListener(TREE_DISPLAY_MODE_EVENT, onChange);
    return () => window.removeEventListener(TREE_DISPLAY_MODE_EVENT, onChange);
  }, []);

  return mode === 'classic' ? <TreePageClassic key="classic" /> : <TreePage key="enhanced" />;
}
