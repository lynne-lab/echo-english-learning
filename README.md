# Echo — 英语精听 · 跟读工作台

Windows 桌面英语听力/口语学习软件。把本地音视频或网页链接变成**可逐句精听**的时间轴字幕，点词查释义、带原声保存生词；用 **FSRS 间隔重复**复习生词，用**默写自动批改**检验听写，用**学习统计**看长期进步。

当前版本：**v0.6.1 · 腾讯云智聆发音评测 + 24 周学习计划**。

## 已完成的功能

### 素材与转写

- 导入本地音频/视频，或粘贴 YouTube / B 站等链接（yt-dlp 下载）
- faster-whisper 在本地转写，生成句子级 + 词级时间戳
- 默认 `small.en`，NVIDIA GPU（CUDA）自动启用，失败时自动回退 CPU
- 设置页可切换 `base.en` / `small.en` / `medium.en` / `large-v3`

### 精听

- 逐句高亮、点句跳转、单句循环（`L`）
- 0.5x–1.5x 变速不变调、字幕浮层开关（`S`）、原文列表开关
- 前进/后退 5 秒、视频全屏、键盘操作
- 每句可校对，保留原始转写文本
- 点击任意单词：ECDICT 离线英汉词典（340 万词条）+ 英文释义 + TTS 发音
- 一键加入生词本，自动保存原句和原声音频片段

### 学习计划

- 内置 **24 周三阶段计划**：恢复期（第 1–4 周）、提升期（第 5–12 周）、真实语速（第 13–24 周）
- 每天生成 4 个任务：复习 5 分钟、精听 10 分钟、抠词默写 10 分钟、跟读 10 分钟
- 每项任务可一键跳到对应的复习 / 精听 / 默写 / 跟读页面，不需要自己在页面之间找素材
- 计划绑定一个「主材料」，精听、默写和跟读共用；随时可以更换
- 记录今日完成、连续学习天数、全勤天数、任务完成率和最近 7 天完成情况
- 每个阶段附带推荐素材（VOA、6 Minute English、ELLLO、All Ears English、TED-Ed、CNN 10 等），可打开官网或去素材库导入
- 计划不预装版权音频，也不自动判断你是否真的练了 10 分钟；完成状态由你手动勾选

### 今日复习（FSRS）

- 生词自动进入 FSRS 间隔重复队列，按 **Again / Hard / Good / Easy** 四档评分
- 复习时先听原句（目标单词被遮住），回忆后显示单词、释义和完整原句
- 评分按钮直接显示预计下次间隔；到期的旧卡始终出现，每日新词上限可配置
- 支持键盘：`Space` 显示答案、`1`–`4` 评分、`R` 重听原句
- 完成一轮后显示各评分数量、今日复习量和下次到期时间

### 默写自动批改

- 两种模式：
  - **整句默写**：听音频写完整句子
  - **抠词默写**：随机遮住约 30% 关键词，补全整句
- 逐句播放、0.75x / 1x 变速、再听一遍
- 提交后自动批改，标注：
  - **漏词**（原文有、你没写）
  - **拼写**（接近但拼错）
  - **听错**（差异较大）
  - **多写**（你多写的词）
  - **标点**（单独提示，不影响单词准确率）
- 显示单词级准确率、逐句得分、你的答案和订正列表
- 每次默写保存为记录，可在默写首页删除

### 跟读录音与 A/B 对比

- 素材卡片或精听页进入「跟读」，逐句练习
- 麦克风录音（WebM/Opus），录音保存到本地，可反复回听
- 原声与录音双波形显示在**同一时间轴**上，直观看到长度和停顿差异
- 一键 A/B 连续对比：先播原声，再自动播你的录音
- 0.75x / 1x 变速，原声和录音同时生效
- 每次跟读保存为一条记录，可选中、删除、按时间回看
- **本地跟读评测**：用本地 Whisper 重新识别你的录音，和目标句做词级 diff，给出识别准确率、漏词/拼写/听错/多写/标点，以及语速对比
- 首次录音如被 Windows 拦截，界面会提示去「设置 → 隐私和安全性 → 麦克风」放行

> 本地评测是**识别级反馈**，不是音素级发音评分；它能发现明显漏读和听不清，但不会像专业发音评测那样给出音素分数。

### 音素级发音评分（可选，腾讯云智聆 / Azure）

在线评分是可选功能，默认优先使用腾讯云智聆，也可以继续使用 Microsoft Azure。

**腾讯云智聆（推荐）**

- 在腾讯云控制台开通「智聆口语评测」，在「访问管理 → API 密钥管理」创建 SecretId/SecretKey，并记下账号 AppID
- 在设置页填入 AppID、SecretId、SecretKey 后，跟读页会出现「腾讯云 评分」
- 点击评分前会弹窗确认；确认后把当前录音发送到腾讯云进行句子/音素级评估
- 结果包含：综合发音、准确度、流利度、完整度，以及单词和音素级分数、错误类型（发音错误/漏读/多读）
- 录音最长 60 秒；凭据只保存在本机 SQLite 数据库，前端只显示末四位

**Microsoft Azure（可选）**

- 在设置页填入 Azure Speech 的**密钥**和**区域**（例如 `eastus`）后，跟读页会出现「Azure 评分」
- 字段与腾讯云一致，但录音最长 30 秒
- 腾讯云和 Azure 都配置时优先使用腾讯云；需要改用 Azure 时先清除腾讯云配置

- 只影响选中的那一次录音；未配置时完全不影响本地跟读评测和其他功能
- 两个服务分别由腾讯云 / Microsoft 计费，请以你自己的配额为准

### 学习统计

- 连续学习天数、今日复习/默写量、记忆保持率、默写正确率
- 最近 7 天复习/默写柱状图
- 最近 16 周学习热力图
- 未来 7 天 FSRS 到期预测
- 默写错误类型分布（漏词/拼写/听错/多写/标点）
- 生词卡片状态、最近默写记录
- 所有图表都有数据表视图，图表颜色通过 CVD/对比度校验

## 快捷键

### 精听页

| 按键 | 功能 |
| --- | --- |
| `Space` | 播放 / 暂停 |
| `←` / `→` | 后退 / 前进 5 秒 |
| `↑` / `↓` | 上一句 / 下一句 |
| `L` | 循环当前句 |
| `S` | 字幕开关 |

### 复习页

| 按键 | 功能 |
| --- | --- |
| `Space` | 显示答案 |
| `1` / `2` / `3` / `4` | Again / Hard / Good / Easy |
| `R` | 重听原句 |

### 默写页

| 按键 | 功能 |
| --- | --- |
| `Ctrl + Enter` | 提交批改 / 进入下一句 |

## 技术架构

```text
Electron 45 (主进程)
 ├─ React 19 + TypeScript + Vite 渲染进程
 └─ Python 3.12 Sidecar (FastAPI, 127.0.0.1:8765)
      ├─ faster-whisper / CTranslate2   语音识别
      ├─ yt-dlp                          在线视频下载
      ├─ ffmpeg / ffprobe                音轨与媒体探测、原句切片、录音转码
      ├─ SQLite (data/echo.db)           素材、句子、生词、复习、默写、跟读、统计
      ├─ FSRS (fsrs 6.x)                 间隔重复调度
      └─ ECDICT (data/ecdict.db)         离线英汉词典
```

跟读页使用 `MediaRecorder` 录音，Web Audio API 解码原句切片和录音并绘制双波形；本地评测把录音转成 16k WAV 后交给 Whisper 识别，再用默写同一套 diff 逻辑对比目标句。

设计要点：

- **数据库放在 Python sidecar**，避开 Electron 原生模块（better-sqlite3）在 Windows 上需要 VS 编译工具的问题。
- **媒体通过 sidecar 的 `/api/media/:id` 提供**，实现了 HTTP Range，视频拖动、音频跳转都正常。
- **本地素材只保存路径，不复制文件**；移动原文件后需要重新导入。
- **FSRS 到期时间按本地自然日归一化到 04:00**，避免“晚上 10 点复习、第二天白天却不到期”的体验问题。
- **重新转写会重建句子**，但会按时间把已保存的生词出处接回新句子，并保留点击时的单词原始大小写。

## 目录

```text
src/main/          Electron 主进程、sidecar 生命周期、文件选择
src/preload/       contextBridge API
src/renderer/      React 界面（素材库 / 学习计划 / 精听 / 复习 / 默写 / 生词本 / 统计 / 设置）
sidecar/app/
  api.py           基础素材、媒体、生词本、设置
  reviews_api.py   FSRS 复习队列、评分、预览
  plan_api.py      24 周学习计划、每日任务、完成度
  dictation_api.py 默写会话、diff 批改、记录
  recordings_api.py 跟读录音上传、切片播放、本地评测、在线发音评分
  azure_speech.py   Azure 发音评估 REST 适配与响应解析
  tencent_speech.py 腾讯云智聆 SOE WebSocket 适配与响应解析
  stats_api.py     学习统计
  transcribe.py    转写、短音频识别、GPU/CPU 回退
  srs.py           FSRS 封装与到期时间归一化
sidecar/requirements.txt      基础依赖
sidecar/requirements-gpu.txt  可选 GPU 依赖（Windows cuBLAS / cuDNN）
scripts/download_ecdict.py    离线词典下载
data/                         本地数据（已 gitignore）
```

## 运行

```bash
npm install
python -m venv .venv
.venv/Scripts/python -m pip install -r sidecar/requirements.txt

# 可选：启用 NVIDIA GPU 加速
.venv/Scripts/python -m pip install -r sidecar/requirements-gpu.txt

# 下载离线词典（约 206 MB，解压后约 812 MB）
.venv/Scripts/python scripts/download_ecdict.py

npm run dev
```

> Windows 下 Electron 二进制走 npmmirror（见 `.npmrc`）。如果 `npm install` 后提示 `Electron uninstall`，执行：
> `cd node_modules/electron && node install.js`

### 模型

默认 `small.en`（约 480 MB），首次转写时自动下载到 `data/models/`。

- 下载源默认使用 Hugging Face 镜像，可通过环境变量 `HF_ENDPOINT` 覆盖。
- GPU 依赖安装后，sidecar 会自动注册 cuBLAS / cuDNN DLL 目录；CUDA 推理失败会回退 CPU。

### 测试

```bash
.venv/Scripts/python -m unittest discover -s sidecar/tests -v
npm run typecheck
```

腾讯云 SOE 适配器的签名、响应归一化和本地 WebSocket 回放都有离线测试，不需要真实凭据。

### 打包 Windows 安装包

```bash
npm run build:sidecar
npm run dist
```

- `build:sidecar` 用 PyInstaller 冻结 Python 引擎，并把 cuBLAS / cuDNN / ffmpeg / ffprobe 一起放进 `sidecar-dist/`
- `dist` 用 electron-builder 生成 `release/Echo-Setup-0.6.1.exe`
- 也可以直接运行 `powershell -File scripts/build-installer.ps1` 一步完成
- 安装包约 **1.4 GB**（含 CUDA 运行库和 ffmpeg），安装后约 **3.1 GB**
- 安装包未签名，Windows SmartScreen 可能提示；选择「仍要运行」

打包后的数据目录是 `%APPDATA%\Echo\data`。模型和 ECDICT 不会打进安装包（体积太大）：首次转写时自动下载模型，词典可以在设置页选择；如果从开发目录迁移，把原来的 `data` 整个复制到 `%APPDATA%\Echo\data` 即可。

### 数据位置

| 路径 | 内容 |
| --- | --- |
| `data/echo.db` | 素材、句子、生词、复习卡片/日志、默写会话、跟读录音、统计源数据 |
| `data/ecdict.db` | 离线词典 |
| `data/models/` | Whisper 模型缓存 |
| `data/media/` | 从链接下载的媒体 |
| `data/recordings/` | 你的跟读录音 |
| `data/clips/` | 从原素材切出的原句 WAV 缓存 |
| `data/logs/sidecar.log` | 引擎日志 |

关闭应用后复制整个 `data` 文件夹即可备份。本地导入的素材是路径引用，不会被复制进 `data`。

## 已知限制

- 安装包未签名，Windows SmartScreen 可能提示；安装包约 1.4 GB（含 CUDA/ffmpeg），安装后约 3.1 GB。
- 本地跟读评测基于 Whisper 识别，**不是音素级发音评分**；轻微的发音偏差可能仍被识别为正确。需要音素级结果时请配置腾讯云智聆或 Azure 评分。
- 在线发音评分需要你自己的腾讯云或 Azure 凭据，且会把选中的录音发送到对应云端计费；没有凭据时该功能不可用，但本地评测不受影响。腾讯云 SOE 使用 60 秒以内的 16k 单声道 PCM，Azure 最长 30 秒；适配层的签名和响应解析有离线单元测试（`sidecar/tests`），真实调用需要你的凭据才能验证。
- 重新转写会重建句子 ID，之前保存的跟读录音仍留在磁盘和记录里，但不会再挂到新句子上。
- 在线视频：DRM 平台（Netflix、爱奇艺等）无法下载；部分站点需要登录 cookie，暂未提供配置入口。
- 视频容器：Chromium 最稳的是 MP4 / WebM；MKV、AVI、FLV 等可能无法直接播放，后续会加自动转封装。
- 默写记录和跟读录音只能逐条删除，没有批量清理；统计固定使用近 30 天 / 16 周窗口，暂不支持自定义日期范围。
- 学习计划的每日任务需要手动勾选完成，不会根据复习/默写/跟读记录自动判断；推荐素材也需要手动导入，安装包不包含版权音频。
- 默认词典与模型都在本地，首次运行需要联网下载一次。
- 库里留有开发测试素材（`sample`、`jfk`、`sample.mp4`）和测试生词/复习/默写记录，正式使用前可在对应页面删除。

## 路线图

- 之后：系统音频录制、播客 RSS、语音日记、Anki 导出
