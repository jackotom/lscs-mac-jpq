# 国内服务器部署

官网是纯静态页面。构建结果位于 `website/dist/`，可直接交给 Nginx 托管。

## 当前正式环境

- 网址：`https://acyg.me/lsjpq/`
- 下载地址：`https://acyg.me/lsjpq/hearthstone-tracker-mac-arm64-v0.5.4.zip`

服务器地址、目录和登录方式只保存在本机工作区记忆，不进入公开仓库。官网由现有 Web 服务直接提供静态文件。

## 构建

```bash
VITE_DOWNLOAD_URL="https://你的下载域名/安装包.zip" npm run build
```

## Nginx 最小配置

```nginx
server {
    listen 80;
    server_name 你的域名;
    root /你的官网目录/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|svg|webp|ico)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

更新时先上传到新的临时目录，核对文件和安装包哈希，再替换正式目录。不要在仓库中保存服务器密码或私钥。
