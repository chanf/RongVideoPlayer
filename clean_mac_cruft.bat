@echo off
REM ============================================================================
REM  clean_mac_cruft.bat
REM
REM  Recursively deletes macOS junk files/folders left behind after copying a
REM  project from macOS to Windows (._ AppleDouble resource forks, .DS_Store,
REM  __MACOSX, .Spotlight-V100, etc.).
REM
REM  NOTE: This script is intentionally ASCII-only. cmd.exe parses .bat files
REM  using the OEM codepage (e.g. GBK on Chinese Windows); UTF-8 Chinese
REM  comments get mis-decoded and break the REM lines. Keep it ASCII.
REM
REM  Usage:
REM    clean_mac_cruft.bat                 clean the script's own folder
REM    clean_mac_cruft.bat D:\Some\Path    clean a specific folder
REM    clean_mac_cruft.bat /preview        list what would be deleted (dry run)
REM    clean_mac_cruft.bat /preview D:\Path
REM
REM  Removes:
REM    Files: ._*(AppleDouble), .DS_Store, .AppleDouble, .LSOverride,
REM           .apdisk, .com.apple.timemachine.supported
REM    Dirs:  __MACOSX, .Spotlight-V100, .Trashes, .fseventsd,
REM           .TemporaryItems, .DocumentRevisions-V100
REM
REM  Not handled: macOS custom-folder-icon files are named "Icon<CR>" (a
REM  carriage return in the filename) which batch cannot match reliably.
REM  Use PowerShell for those if needed:
REM    gci -Recurse -Filter 'Icon?' | remove-item -Force -Recurse
REM ============================================================================

setlocal enabledelayedexpansion

REM ---------- parse arguments ----------
set "DRYRUN=0"
set "TARGET="

:parse
if "%~1"=="" goto parsed
if /i "%~1"=="/preview"   ( set "DRYRUN=1" & shift & goto parse )
if /i "%~1"=="--dry-run"  ( set "DRYRUN=1" & shift & goto parse )
if /i "%~1"=="/?"         goto usage
if /i "%~1"=="-h"         goto usage
if /i "%~1"=="--help"     goto usage
if defined TARGET         goto usage
set "TARGET=%~1"
shift
goto parse

:parsed
if not defined TARGET set "TARGET=%~dp0"
REM strip trailing backslash (but keep the one in drive roots like C:\)
if "%TARGET:~-1%"=="\" if not "%TARGET:~-2%"==":" set "TARGET=%TARGET:~0,-1%"
if not exist "%TARGET%\" (
    echo [ERROR] directory not found: %TARGET%
    exit /b 1
)

if "%DRYRUN%"=="1" (
    echo ===== DRY RUN -- nothing will be deleted =====
) else (
    echo ===== Cleaning macOS cruft =====
)
echo Target: %TARGET%
echo.

set /a COUNT=0

REM ============================================================================
REM FILES
REM ============================================================================
REM Wildcard pattern ._*(the leading dot-dash AppleDouble forks) MUST have its
REM own for /r loop. Putting ._ as a token in an outer "for %%p in (._* ...)"
REM breaks: plain FOR expands wildcards against the current working directory,
REM so the literal "._*" never reaches the inner loop. Literal names are safe
REM in an outer FOR because they contain no wildcard chars.

REM --- ._ AppleDouble resource forks (wildcard, dedicated loop) ---
for /r "%TARGET%" %%f in (._*) do (
    if exist "%%f" if not exist "%%f\" (
        if "%DRYRUN%"=="1" (
            echo   [file] "%%f"
        ) else (
            del /f /q /a "%%f" >nul 2>&1
            echo   [file] "%%f"
        )
        set /a COUNT+=1
    )
)

REM --- literal-named junk files ---
for %%p in (.DS_Store .AppleDouble .LSOverride .apdisk .com.apple.timemachine.supported) do (
    for /r "%TARGET%" %%f in (%%p) do (
        if exist "%%f" if not exist "%%f\" (
            if "%DRYRUN%"=="1" (
                echo   [file] "%%f"
            ) else (
                del /f /q /a "%%f" >nul 2>&1
                echo   [file] "%%f"
            )
            set /a COUNT+=1
        )
    )
)

REM ============================================================================
REM DIRECTORIES
REM ============================================================================
REM Walk every directory in the tree with "for /r ... in (.)", and at each one
REM check whether a junk-named child directory exists. This is more reliable
REM than "dir /s /b /ad path\pattern", which inconsistently lists the matched
REM root. if exist "...\name\" (trailing backslash) tests directory-ness.

for %%d in (__MACOSX .Spotlight-V100 .Trashes .fseventsd .TemporaryItems .DocumentRevisions-V100) do (
    for /r "%TARGET%" %%D in (.) do (
        if exist "%%~fD\%%d\" (
            if "%DRYRUN%"=="1" (
                echo   [dir]  "%%~fD\%%d"
            ) else (
                rd /s /q "%%~fD\%%d" >nul 2>&1
                echo   [dir]  "%%~fD\%%d"
            )
            set /a COUNT+=1
        )
    )
)

echo.
if "%DRYRUN%"=="1" (
    echo Dry run done. !COUNT! item(s) would be removed. Re-run without /preview to delete.
) else (
    echo Done. Removed !COUNT! item(s).
)
endlocal
exit /b 0

:usage
echo Usage:
echo   clean_mac_cruft.bat               clean the script's folder
echo   clean_mac_cruft.bat ^<dir^>          clean a specific folder
echo   clean_mac_cruft.bat /preview      dry run (list only)
echo   clean_mac_cruft.bat /preview ^<dir^>
exit /b 0
