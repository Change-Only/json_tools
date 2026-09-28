@echo off
chcp 65001 >nul
setlocal enableextensions
title JSON 工具箱

rem ============================================================
rem   JSON 工具箱 启动脚本
rem   依次探测可用解释器，优先用 pythonw（无控制台窗口）启动原生窗口；
rem   找不到可用解释器时给出明确提示并暂停，避免窗口一闪而过。
rem ============================================================

set "DIR=%~dp0"
set "PYEXE="
set "PYARGS="

rem 1) 随发行包自带的运行时（若随包一起提供）
if exist "%DIR%runtime\pythonw.exe" (
  set "PYEXE=%DIR%runtime\pythonw.exe"
  goto PROBE
)

rem 2) 由启动环境提供的内置解释器路径（可选，仅供本机开发环境）。
rem    说明：这是一条本机专用的候选路径，普通用户无需关心；
rem    该文件不存在时会自动跳过，继续向下探测，不会影响正常使用。
if exist "C:\Users\YZX\.workbuddy\binaries\python\envs\default\Scripts\pythonw.exe" (
  set "PYEXE=C:\Users\YZX\.workbuddy\binaries\python\envs\default\Scripts\pythonw.exe"
  goto PROBE
)

rem 3) py 启动器（无窗口）
where pyw >nul 2>nul
if not errorlevel 1 (
  set "PYEXE=pyw"
  set "PYARGS=-3"
  goto PROBE
)

rem 4) PATH 中的 pythonw
where pythonw >nul 2>nul
if not errorlevel 1 (
  set "PYEXE=pythonw"
  goto PROBE
)

rem 5) 最后退而求其次用 python（会带控制台窗口）
where python >nul 2>nul
if not errorlevel 1 (
  set "PYEXE=python"
  goto PROBE
)

goto NOTFOUND

:PROBE
rem 校验解释器确实可执行（能求出版本号），不通过则尝试兜底
"%PYEXE%" %PYARGS% -c "import sys" >nul 2>nul
if not errorlevel 1 goto RUN
rem 首选解释器不可执行：若不是 python，再尝试一次 python 兜底
if /i "%PYEXE%"=="python" goto BADPY
where python >nul 2>nul
if errorlevel 1 goto BADPY
set "PYEXE=python"
set "PYARGS="
python -c "import sys" >nul 2>nul
if not errorlevel 1 goto RUN

:BADPY
rem 兜底：解释器存在但无法执行时，若发行包已打包单文件 exe（无需 Python），则改为启动它
if exist "%DIR%dist\JSON工具箱.exe" (
  echo [提示] 找到的解释器无法正常执行，改用发行包自带的 dist\JSON工具箱.exe 启动…
  start "" "%DIR%dist\JSON工具箱.exe"
  exit /b 0
)
echo.
echo [错误] 找到解释器「%PYEXE%」但无法正常执行（需要 Python 3.11+）。
echo   请检查该 Python 是否安装完整，或安装 Python 3.11+ 后重试。
echo.
pause
exit /b 1

:RUN
echo [提示] 正在启动 JSON 工具箱…
start "" "%PYEXE%" %PYARGS% "%DIR%main.py"
if errorlevel 1 (
  echo.
  echo [错误] 启动失败。请检查 Python 环境，或直接双击 web\index.html 使用（无需 Python）。
  echo.
  pause
  exit /b 1
)
exit /b 0

:NOTFOUND
rem 兜底：未找到任何可用 Python 时，若发行包已打包单文件 exe（无需 Python），则改为启动它
if exist "%DIR%dist\JSON工具箱.exe" (
  echo [提示] 未找到可用的 Python，改用发行包自带的 dist\JSON工具箱.exe 启动…
  start "" "%DIR%dist\JSON工具箱.exe"
  exit /b 0
)
echo.
echo [错误] 未找到可用的 Python（需要 Python 3.11+）。
echo.
echo   方案一：安装 Python 3.11+ 并勾选 "Add Python to PATH"
echo   方案二：无需 Python —— 直接双击 web\index.html 也能离线使用
echo   方案三：无需 Python —— 直接双击 dist\JSON工具箱.exe（发行包已打包时可用）
echo.
pause
exit /b 1
