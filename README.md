# Reddit 账号监控 · 云端版

每天定时在云端自动采集名单里的 Reddit 账号，并把看板发布成一个网址。任何人点开网址就能看，不需要安装任何东西，也不需要你的电脑开着。

## 它是怎么工作的

1. GitHub 按设定的时间（默认每天两次）启动一台临时的云端机器。
2. 这台机器打开一个浏览器，带上你提供的 Reddit 登录信息访问 reddit.com，运行和油猴脚本 v3.3 完全相同的采集程序。
3. 采集结果存进 `docs/data.json`，看板网页随之更新。

## 先看清这几点

- **只在模拟的 Reddit 上测试过。** Reddit 是否放行"云端机房里的登录访问"，只有实际运行一次才知道。第一次运行就是测试。
- **被拒绝就是被拒绝。** 程序不换 IP、不伪装浏览器、不处理人机验证。Reddit 拒绝时，它会停下来，并把原因显示在网页顶部。
- **网址是公开的。** 免费的 GitHub 账号只能给公开仓库开网页。拿到链接的人都能看到看板，仓库里的账号名单和数据也是公开的。登录信息不在其中，它单独加密保存；采集用的那个账号的名字也不会写进公开数据。
- **登录信息等同于账号密码。** 只能填在第 4 步说的加密位置，不要写进任何文件，不要发给任何人。
- **建议用一个备用的 Reddit 账号**，不要用主账号，也不要用名单里的账号（自己看自己查不出 shadowban）。从云端自动访问有可能让这个账号被 Reddit 限制。

## 部署步骤（约 15 分钟）

### 1. 新建仓库
登录 github.com，右上角 **+** → **New repository**。名字随意（比如 `reddit-monitor`），选 **Public**，点 **Create repository**。

### 2. 上传文件
在新仓库页面点 **uploading an existing file**，把这个文件夹里的以下内容一起拖进去，然后点 **Commit changes**：

- `collector` 文件夹
- `docs` 文件夹
- `accounts.json`
- `README.md`

### 3. 创建定时任务
仓库页面点 **Add file** → **Create new file**。
文件名一栏输入：`.github/workflows/collect.yml`
把 `定时任务-collect.yml.txt` 里的全部内容粘贴进去，点 **Commit changes**。

### 4. 填入 Reddit 登录信息
先取登录信息：

1. 用 Chrome 或 Edge 打开 reddit.com，用备用账号登录。
2. 按 F12，顶部选 **Application**（应用），左侧 **Cookies** → `https://www.reddit.com`。
3. 找到 Name 是 `reddit_session` 的那一行，双击它的 Value，全选并复制。
4. 复制完直接关掉标签页即可，**不要点退出登录**，否则这串信息立刻失效。

再填进仓库：**Settings** → **Secrets and variables** → **Actions** → **New repository secret**。
Name 填 `REDDIT_COOKIE`，Secret 粘贴刚才复制的内容，点 **Add secret**。

### 5. 打开网页功能
**Settings** → **Pages** → **Build and deployment** 下的 **Source** 选 **GitHub Actions**。

### 6. 运行第一次
**Actions** → 左侧点 **云端采集并发布看板** → 右侧 **Run workflow** → **Run workflow**。
等 5–15 分钟。完成后回到 **Settings** → **Pages**，页面顶部会显示网址，形如 `https://你的用户名.github.io/仓库名/`。

## 怎么看结果

打开网址即可。Actions 里这次运行是绿色表示采集成功，红色表示没有成功，原因会显示在网页顶部。

| 网页上的说明 | 意思 | 怎么办 |
|---|---|---|
| Reddit 拒绝了云端浏览器的访问 | Reddit 不放行这个云端机房 | 这条路走不通，不要尝试绕过。改用"一台常开的电脑 + 油猴脚本" |
| 云端浏览器没有登录上 Reddit | 登录信息填错或已过期 | 重做第 4 步。还不行的话，改填整串 cookie（见下） |
| Reddit 开始拦截… / 持续限速… | 采到一半被拦或被限速 | 已采到的部分会保留，下一次定时运行会自动再试 |

**整串 cookie 的取法**：F12 → **Network**（网络）→ 刷新页面 → 点列表里第一个 `www.reddit.com` → **Request Headers** 里 `cookie:` 后面的整串内容。用它替换 `REDDIT_COOKIE` 的值。

## 日常维护

- **改监控名单**：在仓库里编辑 `accounts.json`，`label` 是显示在看板上的备注，可以留空。
- **改采集时间**：编辑 `.github/workflows/collect.yml` 里的 `cron` 一行。时间是 UTC；GitHub 的定时任务可能晚几分钟到几十分钟才启动。不建议一天超过 2–3 次。
- **登录信息过期**：网页顶部会提示"没有登录上"，重做第 4 步即可。
- **暂停**：Actions → 云端采集并发布看板 → 右上角 **···** → **Disable workflow**。
- **彻底停用**：Settings 最下方 **Delete this repository**，网址随之失效。

## 文件说明

| 文件 | 作用 |
|---|---|
| `accounts.json` | 监控名单 |
| `collector/run.js` | 云端采集程序 |
| `collector/userscript.js` | 油猴脚本 v3.3 原文件，采集逻辑都在这里 |
| `docs/index.html`、`docs/dashboard.js` | 看板网页，只读取 `data.json`，不向 Reddit 发请求 |
| `docs/data.json` | 采集结果和历史快照，由云端程序自动更新 |
| `定时任务-collect.yml.txt` | 定时任务的内容，第 3 步用 |
