#!/bin/bash

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

ln -fs $ROOT_DIR/tool_webpage.Caddyfile /etc/caddy/0.tool_webpage.Caddyfile
/usr/sbin/service caddy reload

# 本站为纯静态站点（仓库的 public/），无后端进程；将来若加后端，
# 参照 research/project/after_push.sh 追加 supervisor.conf 软链 + supervisorctl 段
