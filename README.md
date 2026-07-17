# AI 办公全景 3D

一个真·3D 等轴测办公室场景，基于 [PixiJS v8](https://pixijs.com/) + React 19 + Vite 8 + TypeScript 构建。

## 特性

- ✅ **3D 等轴测办公室**（PixiJS WebGL 渲染，无 Spine 依赖）
- ✅ **7 个工位**（前排 4 + 后排 3），对应 7 位中文同事
- ✅ **自动工作流**：员工按预定义脚本串门对话（VOC → 打分 → 盲盒 → 创意 → 压力 → 展厅）
- ✅ **时间流速控制**（1× / 20× / 100×）
- ✅ **昼夜循环**（白天 9-18 / 傍晚 18-21 / 夜晚 21+）
- ✅ **下班动画**（夜晚所有员工淡出）
- ✅ **点击小人弹操作菜单**（开始工作/思考/空闲/串门选择目标）
- ✅ **截图导出**（PNG 下载当前画面）
- ✅ **完整 UI 框架**：侧栏 + 顶部统计 + 右侧面板 + 底部工具栏
- ✅ **零图片资源依赖**（全部用 PixiJS Graphics 绘制）

## 启动

```bash
npm install
npm run dev
```

默认地址 `http://localhost:5173/`。

## 技术栈

| 层级 | 技术 |
|------|------|
| 渲染引擎 | PixiJS v8（WebGL 2D） |
| UI 框架 | React 19 + Vite 8 |
| 类型 | TypeScript 6 |
| 资源 | 纯程序绘制（PNG/SVG 零依赖） |

## 架构

```
src/
├── App.tsx + App.css        # 主布局（侧栏 + 中央 Canvas + 右栏 + 底栏）
├── main.tsx + index.css     # 入口
├── types/agent.ts           # 类型定义
├── store/officeStore.ts     # 状态管理（agents 实时同步）
├── services/                # HTTP 动作分发
├── components/
│   ├── OfficeCanvas.tsx     # PixiJS Canvas 容器 + 点击交互菜单
│   └── OfficeDashboardChrome.tsx  # 侧栏/顶栏/右栏/底栏
├── config/                  # 常量
└── scene/
    ├── OfficeScene.ts       # 主场景管理器（ticker + 渲染 + 时间 + 状态）
    ├── officeSceneBridge.ts # 场景 ↔ React 桥接
    ├── layout/officeLayout.ts  # 7 工位 + 7 同事
    ├── entities/            # AgentEntity / DeskEntity
    ├── systems/             # Movement / Animation / Depth sort
    ├── simulation/          # OfficeSimulator / desk visit
    ├── assets/              # 图片加载（带超时保护）
    ├── characters/          # 角色预设
    └── ui/                  # Bubble / StatusLabel
```

## 与主站集成

主站 `category-insight-hub.html` 的「原理展厅 → AI 办公全景」卡片通过 iframe 嵌入此项目。
本地开发时指向 `http://localhost:5173/`，部署后可指向具体部署地址。

## 后续 TODO

- [ ] 部署到 CloudStudio / Vercel / Netlify
- [ ] 主站 iframe 入口实现
- [ ] 替换/扩展场景背景为 AI 生成的等轴测图
