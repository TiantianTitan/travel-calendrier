# 图图小分队三日游

面向五人图卢兹旅行的移动端共享行程，日期固定为 **2026 年 10 月 31 日、11 月 1 日、11 月 2 日**。使用 Next.js、React、TypeScript 与 Supabase，支持部署到 Vercel。

无需注册或登录，选择五个角色之一即可接龙。初始昵称为 **Hoting、Mia、James、Ganggang、Kada**，昵称和表情头像均可共享编辑；成员 ID 固定，修改资料不影响已有参与和点赞。角色只是协作署名，所有访问者均可添加、编辑、移动和删除活动。

## 功能

- 手机按天浏览，桌面并排展示三天；首页直接呈现行程与景点，不放旅行简介块。支持拖动，以及直接选择日期、时间和顺序。
- 角色资料可改昵称，头像可用昵称首字或预设表情，保存后共享。
- 活动可填写标题、起止时间、地点、分类和备注；编辑草稿保存在浏览器，冲突可比较后选择保留内容。
- 接龙提供“参加 / 不参加 / 感兴趣 / 考虑考虑”，默认未表态，也可清除选择；点赞和表情独立统计。
- 同日、有明确正时长的活动按实际区间判断直接重叠；边界相接、跨日、无结束或零时长不推断互斥。确认参加时列出直接冲突的已参加活动，经确认后原子切换；感兴趣、考虑考虑可选多项，不同成员可分别组团。
- 候选任意两项都相交时显示“N 选 1”，否则显示“部分重叠”和时间条。重叠不传递：A 14:00–15:00、B 14:30–16:00、C 15:30–17:00 中可参加 A+C，选择 B 才需撤回 A+C。
- 可扩展的真实景点目录：每处提供 4–8 张不同实景照片；点击先看照片、简介、地址和按日官方开放资料，再点“添加活动”进入预填表单；保存才创建，开放时间不自动写入备注。资料与照片依据见 [首批景点](docs/place-sources.md)、[新增景点](docs/places-extra-sources.md)、[更多景点](docs/places-more-sources.md)及[补充图库](docs/places-gallery-sources.md)。
- 品牌使用公有领域或 CC0 的图卢兹风景图作 Logo，[原图与 CC0 许可](docs/places-extra-sources.md#可用于图标的-cc0-风景照片)可查；界面保持白底、浅灰统一组件和简短动作，无渐变、阴影或多色日期。
- 所有浏览器连接同一 Supabase 行程，显示待同步与失败状态，支持重试。行程由大家自行添加，页面不会自动生成示例活动。

## 本地启动

使用 Node.js 22 与 npm。在项目根目录运行：

```bash
npm ci
npm run dev
```

本仓库是专用共享行程，默认连接 `ebbjeibnxywgyegcejzh` 项目；[公开配置](src/lib/supabase-project.ts)只包含浏览器可用的 publishable key，权限由数据库 RLS 和 RPC 限定。没有环境变量时仍连接共享数据库，不会进入本机模式。

如需使用独立开发或测试数据库，在 `.env.local` **同时**覆盖项目 URL 与公开 key：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

只需要公开的 publishable key；旧 anon key 也可填在同一变量，或使用兼容变量 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。不要填入 service-role key。

打开 [本地页面](http://localhost:3000)。默认本地开发也会读写实际共享行程；隔离测试应配置独立数据库。仅配置一个变量、格式错误或传入高权限 key 会使构建失败。修改环境变量后需重启开发服务。

早期版本保存在浏览器的实际新增活动，会在该浏览器、同一网站重新打开后补传到共享行程。迁移保留原记录，并记录已处理操作，重试不重复新增；历史示例及已删除活动不会自动恢复。其他设备无法直接读取原浏览器的本机记录。

## 数据库初始化

首次部署时，在 Supabase SQL Editor 中按文件名升序执行 [supabase/migrations](supabase/migrations) 内的全部 SQL 文件。第一份初始化表、权限、RPC、Realtime 与初始行程，后续迁移更新参与规则、确认保护与共享成员资料。

已有数据库按顺序执行尚未应用的后续迁移；不要遗漏更新。重新执行全部迁移时仍需保持此顺序。权限模型、验证 SQL 和数据规则见 [数据库说明](docs/database.md)。

历史初始化迁移包含 15 项示例活动，保留用于迁移与测试复现；应用运行时不回填这些示例。清空现有行程应使用活动删除接口，保留行程行、成员资料和幂等操作记录，不能删除整张表或重置版本。

## 验证

```bash
npm run typecheck
npm test
npm run build
./scripts/test-database.sh
```

前三项检查类型、业务逻辑与生产构建。数据库脚本需要 Docker、Python 3 和 `rg`，会创建并清理专用 PostgreSQL 临时容器；不连接线上数据库。生产构建可用 `npm start` 本地运行。

数据库验证记录、覆盖范围与限制见[数据库说明](docs/database.md#可重复的真实数据库验证)。

## 部署到 Vercel

1. 将仓库推送到 Git 平台，在 Vercel 导入仓库，项目目录选择仓库根目录，框架选择 **Next.js**；安装命令为 `npm ci`，构建命令为 `npm run build`，输出目录使用框架默认值。参见 [Next.js 部署文档](https://vercel.com/docs/frameworks/full-stack/nextjs)。
2. 在 Build and Deployment 中选择 **Node.js 22.x**，与仓库 `package.json` 中固定的 `engines.node` 保持一致。参见 [Node.js 版本规则](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)。
3. 本行程直接使用仓库内的公开项目配置即可。部署独立行程时，成对设置上述两个 `NEXT_PUBLIC_SUPABASE_*` 变量，并确保目标数据库已按顺序执行全部迁移；Preview 若需隔离，也必须配置独立项目。自定义域名时另设 `NEXT_PUBLIC_SITE_URL=https://你的正式域名`；未设置时，分享链接采用 Vercel 提供的生产域名。
4. 发起部署。环境变量修改只对新部署生效，需要重新构建部署。参见 [环境变量说明](https://vercel.com/docs/environment-variables)。
5. 使用两个独立浏览器打开部署链接，验证新增、编辑、接龙、候选切换和删除会同步，刷新后仍保留。

## 分享信息

首页输出标题、简介、canonical、Open Graph 和 Twitter Card metadata。图卢兹真实照片与图标由本站静态文件提供，无需登录或运行客户端 JavaScript 即可读取。部署后检查页面源码中的绝对地址，以及分享图片返回 HTTP 200。

这些 metadata 提供通用链接预览信息，不等于已配置微信 JS-SDK。微信聊天卡片需用正式地址在微信中实测；目前没有公众号签名配置，也未宣称已验证微信会采用指定缩略图。
