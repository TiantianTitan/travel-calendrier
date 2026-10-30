# 共享行程数据库

此项目只公开 `toulouse-2026` 的三天行程。名字是协作署名，不是身份认证；任何拿到链接的人均可选择五个名字并修改行程。浏览器只需要 Supabase 项目 URL 与 publishable key（旧 anon key 也兼容），不使用 service-role key。

## SQL Editor 部署

目标项目：`ebbjeibnxywgyegcejzh`。在该项目的 SQL Editor 新建查询，全新项目按文件名顺序执行 `supabase/migrations/` 中的全部 SQL。第一份 `202610300001_trip_calendar.sql` 包含事务、表、权限、RPC、Realtime publication 和 15 项初始活动；第二份 `202610300002_participation_choices.sql` 升级四种参与状态、候选确认互斥及移动冲突保护；第三份 `202610300003_choice_confirmation_guard.sql` 增加改选确认的并发保护；第四份 `202610300004_default_activity_copy.sql` 精简初始标题和备注；第五份 `202610300005_overlapping_activity_choices.sql` 将参加互斥改为直接区间重叠；第六份 `202610300006_member_profiles.sql` 增加共享昵称与头像；第七份 `202610300007_emoji_avatars.sql` 将头像表情扩充为 36 个。已经部署前六份的项目只执行第七份。第二、三、五、六、七份只更新函数，不改现有行程；第四份逐字段核对旧默认文案后更新，不覆盖用户编辑，也不改写操作日志。重复部署仍需依次运行全部迁移，避免只重跑旧版而将函数降级。不要将测试 SQL 放到线上执行。

初始活动来源为 `src/lib/seed.ts`，JSON 副本为 `supabase/seed.json`。参与和表情最初全部为空，所有活动都是可编辑的旅行方案，不表示已经预约或确认开放时间。

上述种子仅保留作历史迁移和测试资料。当前应用运行时从空快照起步，再读取线上权威状态；未配置云端的新浏览器也从空行程开始。清空现有活动时，按最新 revision 调用已有 `delete` RPC，同步清理其参与与表情，保留成员资料、行程行、递增版本和私有幂等日志。不要删除 `trip_boards` 行，否则重新执行第一份迁移可能重新插入示例。已有本地缓存会被更新版本的空快照替换；未完成的用户操作仍按原队列规则处理。

以下只读 SQL 可在部署后核对：

```sql
select id, version,
       jsonb_array_length(state->'activities') as activity_count,
       jsonb_array_length(state->'responses') as response_count,
       jsonb_array_length(state->'reactions') as reaction_count
from public.trip_boards where id = 'toulouse-2026';
-- 全部七份迁移完成的全新项目：version=1, activity_count=15, response_count=0, reaction_count=0。
-- 初始活动 revision=2；线上已有修改时版本可能更高。

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public' and tablename = 'trip_boards';

select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'trip_boards';
-- SELECT only, id = 'toulouse-2026'

select has_table_privilege('anon', 'public.trip_boards', 'SELECT') as may_read,
       has_table_privilege('anon', 'public.trip_boards', 'INSERT,UPDATE,DELETE,TRUNCATE') as may_write,
       has_function_privilege('anon', 'public.apply_trip_operation(jsonb)', 'EXECUTE') as may_call_rpc;
-- true, false, true
```

客户端读取 `public.trip_boards` 中 `id=eq.toulouse-2026` 的 `state`，并订阅该行的 Postgres Changes `UPDATE`。所有写入通过 `apply_trip_operation({p_operation: operation})`。页面可用环境配置以项目 `.env.example` 为准；Vercel 配置完成后需要重新构建部署，使 `NEXT_PUBLIC_` 变量进入浏览器构建。

## 写入规则

- 整个行程是一个有版本号的 JSON 快照，额外提供生成列 `version` 和 `updated_at`。小型五人行程的每次写入锁住这一行，在同一事务中完成检查、修改、递增版本和记录操作 ID。
- `anon` 和 `authenticated` 只能直接读取该行，不能直接插入、修改、删除、truncate 表。RLS 不影响项目中的其他表；此迁移不扩大其他数据的可见性。
- 写入口为 `SECURITY DEFINER`，固定空 `search_path` 并使用完整对象名称。内部辅助函数和操作日志在 `travel_private`，不给公开角色访问。
- 操作 ID 是稳定的重试凭据。相同 ID、完全相同请求返回当前权威快照以及 `duplicate: true`；相同 ID、不同请求拒绝。私有日志保存规范化 JSON 请求作为精确指纹及生效版本，不保存可公开访问的历史快照。日志保留，以保证跨刷新重试仍幂等。
- 每个唯一成功操作都使 `state.version` 增加 1，包括设置已经相同的目标状态。重试不会再次增加版本。
- 活动创建版本为 1；活动字段更新使 `activity.revision` 增加 1。参与、表情和成员资料不改变活动 revision。
- 更新只提交脏字段，`base` 与 `patch` 的键必须完全相同。同字段的当前值既不同于基线、又不同于提交目标时返回冲突。不同字段的同时编辑可合并。移动可同时提交日期、开始/结束时间、排序，整笔成功或整笔失败。
- 一个活动可以有多位成员，每个成员仅有一个当前参与状态：`going` 参加、`not-going` 不参加、`interested` 感兴趣、`maybe` 考虑考虑；`null` 撤回。活动只有在同一天、两者均有严格正时长（结束晚于开始），且 `a.start < b.end && b.start < a.end` 时才直接冲突。边界相接、跨日、空结束时间、零时长均不推断冲突。确认参加时，同一事务仅将该成员所有直接重叠活动的 `going` 撤回为未表态；其他成员及感兴趣、考虑、不参加均保留。此关系不传递：A 14:00–15:00、B 14:30–16:00、C 15:30–17:00 中可同时参加 A+C，选择 B 时则需确认撤回 A+C。界面连通分组只影响展示，不扩大互斥范围。旧格式无确认基线的两个同时请求依次生效，最终只有一个确认；带确认基线的新请求会检查用户刚查看的候选组与原选择，过期则拒绝，旧请求重试不反转最后结果。
- 新的确认参加请求带可选 `choice: { key, previousIds }`，`key` 是 `${date}|${time}|${endTime}`，`previousIds` 为本人其他直接重叠 `going` 活动 ID 的集合，顺序无关、不能重复。RPC 获取行锁后比较当前时段和当前旧选择集合；若目标时段或直接冲突集合在确认面板打开期间改变，返回 `CONFLICT: 候选安排刚有变化，请查看后重新确认。`，不撤回任何未被用户审阅的新选择。此字段只允许用于 `going`，省略时兼容旧队列；已生效请求的幂等重试直接返回当前快照，不重新触发确认检查。
- 修改日期或时间如果使活动与同一成员已确认的其他活动直接重叠，返回 `CONFLICT: 这次移动会让已参加的安排重合，请先调整接龙。`，整笔活动与参与状态均不变。只改标题等不变更时段的修改仍可进行。为原本空结束时间的活动补充时长，也按更新后的实际区间检查。
- 表情按活动、成员、表情唯一，提交 `active: true/false`，不改变参与状态。
- `state.profiles` 是可选的成员资料对象，键仍为固定的 `hoting`、`mia`、`james`、`ganggang`、`kada`。缺省时显示原来的名字和首字母头像。`profile` 操作提交 `{id,type:"profile",memberId,patch,base}`，字段只允许 `name` / `avatar`；与活动相同，两个字段可独立合并，同字段过期时整笔冲突。修改昵称不迁移或更改接龙、表情中的成员 ID。资料也公开共享，不是认证身份。
- 昵称必须已经去除首尾空白，长度 1–24 个 Unicode 码点，不能含 ASCII / C1 控制字符。当前界面只提供首字母头像与 `src/lib/member-profiles.ts` 的 36 个表情，不再提供照片上传。数据库与读取校验继续兼容旧照片和既有重试请求：允许空字符串、上述表情，或规范 Base64 编码的 `data:image/jpeg;base64,...` / PNG / WebP；检查对应栅格格式签名、拒绝外部 URL 与 SVG，解码后最多 24 KiB。旧版客户端照片会保留，数据库不承担图片解码或裁剪。五个成员头像总量最多约 160 KiB 编码文本，旧快照不需回填。
- 删除必须提供最新活动 revision，并同时移除对应参与和表情。远端删除后修改返回 `NOT_FOUND`，不会复活活动。
- 拒绝未知字段、未知成员、三天外的日期、无效时间、非空结束时间早于开始、非法类别、空标题和超长文本；上限为标题 120、地点 160、备注 2000 个 UTF-16 单位（与 JavaScript `string.length` 一致）。排序绝对值最多 `1e9`，活动上限 500。非资料请求最大 16 KiB；成员资料请求最大 72 KiB，以同时容纳头像的基线与新值。结束时间可留空（空字符串），填写时必须为 HH:MM 且不早于开始。
- 可预期错误以 `CONFLICT:`、`NOT_FOUND:` 或 `VALIDATION:` 开头，SQLSTATE 为 `P0001`，附中文说明。客户端保留草稿并区分冲突、输入错误和网络错误。

这是明确公开、无认证的小组协作模型，不防止链接持有者代选他人名字。没有加入验证码、限流或离线服务端。操作日志可能随使用增长；若未来清理日志，应先明确重试保留窗口，不能随意清空后仍声称无限期幂等。

## 默认文案更新

第四份迁移的数据来源为 `docs/seed-copy-updates.json`。它在同一行锁事务中逐活动、逐字段比较当前 `title` / `note` 与旧默认值，只对完全相同的字段替换新文案。自定义标题不妨碍未改备注更新，自定义备注也不妨碍未改标题更新；日期、时间、地点、顺序、分类、成员状态、表情与活动 ID 均不变。已删除活动不恢复，用户新建活动不受影响。

每个实际发生内容变化的活动 revision 加 1，整板有任意变化时 version 只加 1。没有匹配旧字段时不写数据库、不增加版本，因此重复运行幂等。新项目完整运行七份迁移后，最终状态与新版 `SEED_STATE` / `supabase/seed.json` 逐值一致。

## 可重复的真实数据库验证

运行：

```bash
./scripts/test-database.sh
```

脚本启动专用 `postgres:17-alpine` 临时 Docker 容器，名称前缀为 `travel-calendrier-pg-test-`，不开放端口，不连接现有数据库，不使用任何生产凭据，退出时删除自己创建的容器。需要本机 Docker、Python 3、项目已安装的 `tsx` 和 `rg`。

2026-10-30 实际验证通过：258 条断言，覆盖 36 个头像表情逐个经 RPC 写入、共享昵称与头像的默认值兼容、Unicode 码点边界、图片签名与大小上限、最大新旧图片替换、资料字段合并/并发冲突/重复重试、保留既有成员接龙和活动 revision、迁移/种子一致性、重复部署保护、RLS 和真实权限拒绝、未知/无效输入、文本 Unicode 边界、可选结束时间的新增／清空／移动、四态参与、任意重叠区间确认互斥、非传递链的两端可共存、相接边界/跨日/空结束/零时长独立、不同区间并发确认与桥接选择原子替换、并发候选确认和旧请求重试、确认基线过期拒绝、等待远端移动行锁后重新校验、移动冲突保护、参与撤回/去重、表情独立性、删除清理、字段基线冲突、原子版本、8 个同时重复请求仅生效一次、同字段并发一个成功一个冲突、不同字段同时合并、五人同时接龙、日志隐私以及默认文案更新的逐字段保护、版本递增与重复执行幂等。

本测试证明 PostgreSQL 逻辑和 publication 配置。Supabase 托管服务的 WebSocket 传输、真实移动设备触控及线上双客户端同步仍需应用端分别验收；本地 PostgreSQL 测试不能替代这些证据。

实现依据：Supabase 官方 [Database Functions](https://supabase.com/docs/guides/database/functions)、[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)。
