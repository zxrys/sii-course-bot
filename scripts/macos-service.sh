#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
label='cn.sii.course-bot'
agent="$HOME/Library/LaunchAgents/$label.plist"
target="gui/$(id -u)/$label"

case "${1:-status}" in
  install)
    node_bin="$(command -v node)"
    mkdir -p "$HOME/Library/LaunchAgents" "$project_dir/data"
    chmod 700 "$project_dir/data"
    if launchctl print "$target" >/dev/null 2>&1; then
      launchctl bootout "$target"
    fi
    umask 077
    cat > "$agent" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>
    <string>$node_bin</string>
    <string>$project_dir/src/cli.js</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>$project_dir</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>$project_dir/data/bot.stdout.log</string>
  <key>StandardErrorPath</key><string>$project_dir/data/bot.stderr.log</string>
</dict></plist>
EOF
    chmod 600 "$agent"
    plutil -lint "$agent"
    launchctl bootstrap "gui/$(id -u)" "$agent"
    echo "已安装并启动 $label"
    ;;
  status)
    if launchctl print "$target" >/dev/null 2>&1; then
      launchctl print "$target" | rg 'state =|pid =|last exit code ='
    else
      echo "服务未安装或未运行。"
      exit 1
    fi
    ;;
  uninstall)
    if launchctl print "$target" >/dev/null 2>&1; then
      launchctl bootout "$target"
    fi
    if [[ -f "$agent" ]]; then
      rm "$agent"
    fi
    echo "已停止并移除 $label"
    ;;
  *)
    echo "用法：$0 install|status|uninstall" >&2
    exit 2
    ;;
esac
