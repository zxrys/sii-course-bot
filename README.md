# SII Course Bot

上海创智学院个人课表助手：通过教务系统已有接口同步整学期课程，在本机查询和生成周课表图片，并提供飞书私聊查询及课前提醒接入口。

## 安装与查询

需要 Node.js 22.13+ 及 Google Chrome。首次使用：

```bash
git clone https://github.com/zxrys/sii-course-bot.git
cd sii-course-bot
npm ci
cp .env.example .env
chmod 600 .env

# 首次登录或令牌过期后：在弹出的独立 Chrome 中登录，程序会自动进入“我的课表”。
npm run login

# 读取整学期课程、日期和节次，以及调课/停课说明。
npm run sync

npm run query -- next
npm run query -- today
npm run query -- tomorrow
npm run query -- week
npm run query -- next-week
npm run query -- week 1
npm run query -- 2026-09-14
npm run query -- status

# 生成 output/week-1.png 与 output/week-1.html。
npm run render -- week 1
```

命令行参数统一使用英文，课程名称和输出仍显示中文；飞书私聊继续支持“下一节”“第1周”等中文查询。旧版中文命令行参数保留兼容。

`week`（本周）和 `next-week`（下周）遵循教务提供的教学周日期表（本学期为周日至周六），不是从周一自行推算。开学前查 `week` 会提示不在已同步学期内，可查 `week 1`。

## 本地运行与提醒预览

```bash
# 模拟某个时刻，仅显示应发送内容，不联网发送，也不标记已发送。
npm run reminders -- --dry-run --at 2026-09-14T08:25:00+08:00

# 本地常驻：每天同步，20 秒检查一次提醒，输出到终端；Ctrl+C 停止。
npm start -- --local

# 仅执行一次同步和提醒检查后退出，用于验收运行流程。
npm start -- --local --once
```

`--local` 的通知只显示在终端，**不会推送到手机或弹出 macOS 通知**。Mac 休眠或程序退出后不会运行。电脑恢复后只补发“已到提醒时间、尚未上课”的课程；已经开始的课程不再提醒。控制台和飞书分别记录发送状态，本地试运行不会阻止后续飞书提醒。

课前提醒默认提前 30 分钟，可在 `.env` 中修改 `REMINDER_MINUTES`。同步失败会保留旧课表；超过 `MAX_SCHEDULE_AGE_HOURS`（默认 48 小时）后暂停课程提醒，避免继续使用长期未核实的课表。日期模拟也会检查数据新鲜度，因此模拟时间太远时可能没有提醒。

在安装时复制的 `.env` 中修改配置；更新项目时保留已有的 `.env`。

## 飞书配置

无需飞书凭证也能在本机同步、查询、生成图片和预览提醒。实际飞书消息投递需要创建自建应用并联调。

1. 打开[开发者后台](https://open.feishu.cn/app)，登录后选择要使用的飞书组织，点击“创建企业自建应用”。名称可填“SII 课表助手”，描述填“个人课表查询与课前提醒”，设置图标。
2. 在“添加应用能力”中添加“机器人”，或进入“应用能力 → 机器人”启用。
3. 在“权限管理”开通下表三个**应用身份**权限。后台支持“批量导入/导出权限”时，可粘贴 [config/feishu-permissions.json](config/feishu-permissions.json) 的内容；以后台识别结果为准。
4. 在“凭证与基础信息”获取 App ID、App Secret，填入本地 `.env`。通过开放平台的用户 ID 获取工具选择自己，取得**当前应用下**的 `open_id`（`ou_...`），填入 `FEISHU_OWNER_OPEN_ID`。可从 API 调试台的用户 ID 参数旁查找获取入口，参见[官方 ID 获取说明](https://open.feishu.cn/document/home/user-identity-introduction/open-id)。它是消息接收者的 ID，不能填写应用 ID、机器人 ID 或群 ID。
5. 在本项目目录执行 `npm start` 并保持运行。然后进入开放平台“事件与回调 → 事件配置”，选择“使用长连接接收事件”，添加“接收消息 v2.0”（`im.message.receive_v1`）并保存。若后台提示尚未建立长连接，检查本地 App ID / Secret 与该应用一致，并保持程序在线后再保存。
6. 在“版本管理与发布”创建版本（例如 `1.0.0`），说明填“课表查询与提醒”；应用可用范围先设为本人，提交发布。根据组织设置可能需要管理员审批，审批并发布后权限和事件配置才生效。
7. 发布成功后在飞书搜索“SII 课表助手”，进入私聊，发送 `状态`、`下一节`、`第1周`、`刷新课表`。若刚发布时连接尚未生效，停止并重新执行 `npm start`。

| 应用身份权限 | 用途 |
| --- | --- |
| `im:message.p2p_msg:readonly` | 读取本人发给机器人的私聊查询 |
| `im:message:send_as_bot` | 发送查询结果和课前提醒 |
| `im:resource` | 上传周课表图片 |

本地 `.env` 中对应三项：

```dotenv
FEISHU_APP_ID=cli_你的应用ID
FEISHU_APP_SECRET=你的应用Secret
FEISHU_OWNER_OPEN_ID=ou_你的用户ID
```

当前实现采用长连接，本机能访问飞书即可接收消息，不需要公网回调地址或域名。配置完成后仍需实测消息投递；Mac 休眠期间程序不能收发提醒。

私聊联调成功后，可以把服务装为当前 Mac 用户的登录项，让它在登录后自动启动、异常退出后自动重启：

```bash
zsh scripts/macos-service.sh install
zsh scripts/macos-service.sh status
# 停用时：zsh scripts/macos-service.sh uninstall
```

安装脚本只在 `~/Library/LaunchAgents` 写入启动配置，不写入飞书凭证。日志在 `data/bot.stdout.log` 和 `data/bot.stderr.log`。更新 Node 安装路径后重新执行 `install`。Mac 休眠和关机时不能准时提醒；教务令牌过期后需重新运行 `npm run login`，服务会在下一次同步时恢复。

机器人只处理配置的本人发来的私聊文本消息；忽略群聊和其他用户。所有主动提醒也只发给该用户。周课表先发文字，再发图片；图片发送失败时保留文字结果。收到查询后立即确认事件，较慢的同步/制图在后台完成。

参考：[官方 SDK 与长连接](https://github.com/larksuite/node-sdk#subscribing-to-events-using-long-connection-mode)、[接收消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)、[发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)、[上传图片](https://open.feishu.cn/document/server-docs/im-v1/image/create)。

## 课表读取方式与数据边界

2026-09-12 检查网站公开前端代码后确认，课表页调用以下同源接口：

| 接口（共同前缀 `/educationalAdministrationBackend`） | 用途 |
| --- | --- |
| `POST /studentTimetable/getTimetableDayPanel` | 学年、教学周日期表、节次时间表 |
| `POST /studentTimetable/getTimetableDayDataList` | 课程实例列表，按具体日期排列 |
| `POST /studentTimetable/getTimetableDayAdjustmentClosedInfo` | 指定日期范围内的调课、停课说明 |
| `POST /studentTimetable/getTimetableWeekAdjustmentClosedInfo` | 学期调课、停课说明 |

请求体分别为 `{}`、`{}`、`{timetableStartDate,timetableEndDate}`、`{}`。认证使用教务 `Authorization` 请求头。成功响应的 `errorCode` 为 `00000`，登录异常为 `A0200`。程序的请求范围固定为上述四个只读查询接口，不执行选课、退课或资料修改。

首次登录使用独立临时浏览器，观察课表接口的成功响应并保存其教务令牌。网站登录前可能发送空令牌请求，因此仅观察到请求并不代表登录成功。程序不读取个人 Chrome 配置目录，不保存密码或完整 CAS 会话。

课程时间由 `startSectionId`、`sectionNumber` 与 `sectionList` 映射，不能简单用“节数 × 45 分钟”计算，因为节间有休息。`dataType=1` 为正常课程、`2` 为调课；前端将其他值显示为停课，程序仅接受明确的 `3` 为停课，遇到其他新值会停止同步待核实。课程主表用于查询和提醒，旁边的调课说明用于留存，不重复对主表应用调课规则。

接口可能随网站更新而变化。程序会验证整学期周数、连续日期、课程状态、节次范围及冲突记录；任何一项不符都保留上次成功课表。学期日期不覆盖目标日期时，会提示“超出范围”，不会把它当成“今天没课”。

## 文件与运行状态

| 路径 | 内容 |
| --- | --- |
| `.auth.json` | 教务登录令牌，权限 `600`，已忽略 |
| `.env` | 可选配置和飞书凭证，已忽略 |
| `data/course-bot.sqlite` | 完整课程快照、同步错误、待通知变动及发送记录 |
| `data/raw-latest.json` | 最近一次通过校验的原始课表数据，便于核对 |
| `output/week-N.png`、`.html` | 生成的周课表 |
| `research/site-contract.md` | 接口和页面字段的调查依据 |
| `test/` | 合成数据测试，不使用真实凭证 |

数据、图片和凭证不进入版本控制。提醒只有在发送成功后才记为已发送；失败在下一轮重试。飞书消息使用稳定 UUID 降低网络重试重复发送的概率。飞书的幂等窗口和“发送成功但本地写盘前崩溃”意味着不能承诺绝对只发送一次。单机数据库租约防止多个常驻进程同时发送；后续部署只运行一个服务实例。

## 测试与验收

```bash
npm test
```

自动测试覆盖节次映射、北京时间与教学周边界、课程变更、停课过滤、过期数据、提醒起止边界、发送失败重试、重启去重、单实例租约、私聊身份限制以及接口错误处理。

真实验收应包括：登录 → 同步 → 对照网页核对一周 → 再次同步无意外差异 → 生成图片 → 模拟提醒。飞书联调还应验证本人私聊、周课表图片和实际提醒投递；离线测试通过不代表这些外部环节已经完成。

后续迁移到常在线服务器时复制项目并安装依赖；在目标环境配置凭证与通知人，使用服务管理器运行 `npm start`。Linux 制图需要 Chromium 和中文字体，可将 `BROWSER_CHANNEL=chromium` 并安装 Playwright Chromium。Mac 上保存的教务令牌能否跨机器使用、有效期多长，需在目标环境重新验证。

## 许可证

项目代码采用 [MIT License](LICENSE)。本仓库只包含程序、合成测试数据和接口说明；个人登录凭证、真实课表、生成图片与运行日志均保存在各自的本地环境中。
