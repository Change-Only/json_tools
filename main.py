#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JSON 工具箱 · Python 桌面外壳
=============================

职责（只做三件事，全部业务逻辑都在前端 JS 中）：

1. 用标准库 ``http.server`` 在 ``127.0.0.1`` 上启动一个本地静态服务，根目录指向 ``web/``；
2. 优先用 ``pywebview`` 打开原生窗口；
3. 若 ``pywebview`` 不可用，则自动回退到系统浏览器。

命令行参数
----------
--browser   强制使用系统浏览器（不尝试原生窗口）
--port N    指定端口（默认 0，由系统自动分配空闲端口）
--no-open   只启动服务、不打开任何窗口（便于自动化测试）
-h, --help  查看帮助

示例
----
    python main.py              # 原生窗口
    python main.py --browser    # 浏览器模式
    python main.py --no-open --port 8799   # 仅起服务（测试用）
"""

from __future__ import annotations

import argparse
import http.server
import socket
import sys
import threading
import time
from functools import partial
from pathlib import Path

HOST = "127.0.0.1"
BACKUP_PORT = 8712  # 端口冲突时的回退起点
APP_TITLE = "JSON 工具箱"


def _safe_reconfigure() -> None:
    """Windows 控制台统一使用 UTF-8，失败则忽略（不影响主流程）。"""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8")
            except Exception:  # noqa: BLE001 - 编码设置失败不应阻断启动
                pass


def _is_port_free(port: int) -> bool:
    """检测端口在 127.0.0.1 上是否可用。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((HOST, port))
            return True
        except OSError:
            return False


def _pick_backup_port() -> int:
    """从 BACKUP_PORT 起顺延寻找一个可用端口。"""
    for candidate in range(BACKUP_PORT, BACKUP_PORT + 200):
        if _is_port_free(candidate):
            return candidate
    # 全部占用时交给系统分配
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((HOST, 0))
        return int(sock.getsockname()[1])


class QuietStaticHandler(http.server.SimpleHTTPRequestHandler):
    """静态文件处理器：静默日志、禁用缓存、友好 404。"""

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - 覆写基类签名
        """屏蔽访问日志，避免刷屏（沙箱/测试场景尤为重要）。"""
        return

    def end_headers(self) -> None:
        # 本地开发/离线场景下禁用缓存，保证改动即时生效
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802 - 保持基类命名
        # 根路径自动映射到 index.html
        if self.path in ("/", ""):
            self.path = "/index.html"
        super().do_GET()


def make_server(directory: Path, port: int) -> http.server.ThreadingHTTPServer:
    """创建绑定到 127.0.0.1 的多线程 HTTP 服务。"""
    handler = partial(QuietStaticHandler, directory=str(directory))
    try:
        return http.server.ThreadingHTTPServer((HOST, port), handler)
    except OSError:
        # 指定端口被占用时，退回到自动分配的可用端口
        if port != 0:
            fallback = _pick_backup_port()
            print(f"[提示] 端口 {port} 不可用，改用 {fallback}")
            return http.server.ThreadingHTTPServer((HOST, fallback), handler)
        raise


def wait_forever() -> None:
    """阻塞主线程，直到用户按 Ctrl+C。"""
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[提示] 已停止服务，再见。")


def open_with_webview(url: str) -> bool:
    """
    尝试用 pywebview 打开原生窗口。
    :return: 是否成功（失败返回 False 以便回退浏览器）。
    """
    try:
        import webview  # type: ignore
    except Exception as exc:  # noqa: BLE001
        print(f"[提示] 未安装 pywebview（{exc}），将使用浏览器模式。")
        return False

    try:
        webview.create_window(
            APP_TITLE,
            url,
            width=1280,
            height=860,
            min_size=(980, 620),
            background_color="#F6F7F9",
        )
        print(f"[提示] 正在打开原生窗口：{url}")
        webview.start()
        return True
    except Exception as exc:  # noqa: BLE001 - 任何异常都回退到浏览器
        print(f"[提示] pywebview 启动失败（{exc}），将使用浏览器模式。")
        return False


def main(argv: list[str] | None = None) -> int:
    _safe_reconfigure()

    parser = argparse.ArgumentParser(
        prog="main.py",
        description="JSON 工具箱 —— 完全离线的桌面版 JSON 处理工具（Python 外壳 + 纯静态前端）。",
        epilog="不带参数运行将优先打开原生窗口；无需 Python 也可直接双击 web/index.html 使用。",
    )
    parser.add_argument("--browser", action="store_true", help="强制使用系统浏览器打开")
    parser.add_argument("--port", type=int, default=0, help="指定本地服务端口（默认自动分配）")
    parser.add_argument("--no-open", action="store_true", help="只启动服务，不打开任何窗口")
    args = parser.parse_args(argv)

    # 定位 web/ 目录：打包成 exe 时优先使用 PyInstaller 的解压目录（sys._MEIPASS），
    # 否则回退到本脚本所在目录。两者都找不到 index.html 时给出明确错误提示。
    candidate_dirs = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidate_dirs.append(Path(meipass))
    candidate_dirs.append(Path(__file__).resolve().parent)

    web_dir = None
    for base in candidate_dirs:
        if (base / "web" / "index.html").is_file():
            web_dir = base / "web"
            break
    if web_dir is None:
        web_dir = candidate_dirs[0] / "web"

    index_file = web_dir / "index.html"

    if not index_file.is_file():
        print(f"[错误] 未找到前端文件：{index_file}")
        print("       请确认 web/ 目录与本脚本位于同一目录下；")
        print("       打包场景请确保 --add-data 已包含 web 目录。")
        return 1

    server = make_server(web_dir, args.port)
    port = int(server.server_address[1])
    url = f"http://{HOST}:{port}/index.html"

    # 后台线程运行静态服务（daemon，主进程退出即回收）
    thread = threading.Thread(target=server.serve_forever, name="jt-http", daemon=True)
    thread.start()

    print("=" * 56)
    print(f"  {APP_TITLE} 已启动")
    print(f"  服务地址： {url}")
    print(f"  静态目录： {web_dir}")
    print(f"  停止方式： Ctrl+C")
    print("=" * 56)

    exit_code = 0
    try:
        if args.no_open:
            print("[模式] --no-open：仅提供服务，不打开窗口。")
            wait_forever()
        elif args.browser:
            print("[模式] --browser：使用系统浏览器打开。")
            try:
                import webbrowser

                webbrowser.open(url)
            except Exception as exc:  # noqa: BLE001
                print(f"[提示] 打开浏览器失败：{exc}，请手动访问上面的地址。")
            wait_forever()
        else:
            if not open_with_webview(url):
                print("[模式] 回退到系统浏览器。")
                try:
                    import webbrowser

                    webbrowser.open(url)
                except Exception as exc:  # noqa: BLE001
                    print(f"[提示] 打开浏览器失败：{exc}")
                wait_forever()
    except KeyboardInterrupt:
        print("\n[提示] 收到中断信号，正在退出…")
    finally:
        try:
            server.shutdown()
        except Exception:  # noqa: BLE001
            pass
        try:
            server.server_close()
        except Exception:  # noqa: BLE001
            pass

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
