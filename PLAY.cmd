@echo off
rem DEADLINE — double-click launcher for Windows.
rem
rem Windows will not run a .sh on double-click, so this finds Git Bash and hands
rem off to the scripts in scripts/. All the real logic lives there; this file is
rem a doorway, not a second implementation.

setlocal EnableDelayedExpansion
cd /d "%~dp0"
title DEADLINE

rem ---- find Git Bash -------------------------------------------------------
set "BASH="
for %%B in (
  "%ProgramFiles%\Git\bin\bash.exe"
  "%ProgramFiles(x86)%\Git\bin\bash.exe"
  "%LocalAppData%\Programs\Git\bin\bash.exe"
) do if not defined BASH if exist %%B set "BASH=%%~B"
if not defined BASH (
  for /f "delims=" %%B in ('where bash.exe 2^>nul') do if not defined BASH set "BASH=%%B"
)
rem Git installed to a non-default location (e.g. a custom drive) puts git.exe
rem on PATH without bash.exe alongside it. Derive the install root from git.exe
rem instead: it's normally <root>\cmd\git.exe, with bash.exe at <root>\bin.
if not defined BASH (
  for /f "delims=" %%G in ('where git.exe 2^>nul') do if not defined BASH (
    set "GITROOT=%%~dpG"
    set "GITROOT=!GITROOT:~0,-1!"
    for %%R in ("!GITROOT!") do set "GITROOT=%%~dpR"
    if exist "!GITROOT!bin\bash.exe" set "BASH=!GITROOT!bin\bash.exe"
  )
)
if not defined BASH (
  echo.
  echo   Git Bash was not found.
  echo.
  echo   Install Git for Windows — it comes with it:
  echo     https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

:menu
cls
echo.
echo    DEADLINE
echo    ============================================
echo.
echo      [1]  Play online  -  host, and get a link to send
echo      [2]  Join a friend's online game
echo      [3]  Play on the same wifi  -  host
echo.
echo      [4]  Update to the latest version
echo      [5]  Quit
echo.
set "choice="
set /p "choice=   Choose [1]: "
if not defined choice set "choice=1"

if "%choice%"=="1" goto online
if "%choice%"=="2" goto join
if "%choice%"=="3" goto local
if "%choice%"=="4" goto update
if "%choice%"=="5" exit /b 0
goto menu

:online
echo.
"%BASH%" scripts/play-online.sh
goto done

:join
echo.
echo    Paste the address your friend sent you.
echo    It looks like:  wss://something.trycloudflare.com
echo.
set "addr="
set /p "addr=   Address: "
if not defined addr goto menu
echo.
"%BASH%" scripts/play-online.sh "%addr%"
goto done

:local
echo.
"%BASH%" scripts/play-local.sh
goto done

:update
echo.
"%BASH%" scripts/update.sh
echo.
pause
goto menu

:done
echo.
echo    Stopped.
pause
