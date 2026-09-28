@echo off
chcp 65001 >nul
setlocal enableextensions
title 打包 JSON 工具箱（PyInstaller）

rem ============================================================
rem   可选步骤：把 JSON 工具箱打包成单文件 exe
rem   产物：dist\JSON工具箱.exe（单文件、无控制台窗口）
rem   首次需要能联网下载 pyinstaller；离线 / 失败都可用 启动.bat 直接运行
rem ============================================================

set "DIR=%~dp0"
cd /d "%DIR%"

echo [1/3] 查找 Python…
set "PY=python"
where python >nul 2>nul
if errorlevel 1 set "PY=py -3"

echo [2/3] 安装 / 更新 PyInstaller…
%PY% -m pip install --upgrade pyinstaller
if errorlevel 1 (
  echo.
  echo [警告] PyInstaller 安装失败，常见原因：
  echo         - 当前处于离线环境，无法访问 PyPI；
  echo         - Python 环境缺少 pip 或权限不足。
  echo        可改用「启动.bat」免打包直接运行，功能完全一致。
  echo.
  pause
  exit /b 1
)

echo [3/3] 开始打包（单文件 + 无控制台窗口 + 应用图标）…
%PY% -m PyInstaller --noconfirm --onefile --windowed --name "JSON工具箱" --icon "assets\app.ico" --add-data "web;web" --collect-all webview --hidden-import clr_loader --hidden-import pythonnet main.py
if errorlevel 1 (
  echo.
  echo [警告] 打包失败，常见原因：
  echo         - 未安装 pywebview（pip install pywebview）或其依赖 pythonnet / clr_loader 缺失；
  echo         - 缺少 .NET / WebView2 运行时（Windows 10 需安装 WebView2 Runtime）；
  echo         - 磁盘空间不足或杀毒软件拦截了 PyInstaller。
  echo        可改用「启动.bat」免打包直接运行，功能完全一致。
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   打包完成！产物位于：
echo   %DIR%dist\JSON工具箱.exe
echo ============================================================
echo   双击该 exe 即可运行（无需安装 Python）。
echo   若杀毒软件误报，请添加信任后重试；也可继续用 启动.bat。
echo.
pause
exit /b 0
