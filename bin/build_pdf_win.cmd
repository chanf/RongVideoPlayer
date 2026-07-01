@echo off
REM ============================================================================
REM  build_pdf_win.cmd
REM
REM  Builds bin\pdf_win.exe (and copies bin\pdfium.dll) from pdf_win.cpp.
REM  Mirrors the CLI contract of pdf_render_mac.swift for the native PDF reader.
REM
REM  The pdfium-binaries distribution ships a DLL (bin/pdfium.dll) plus an
REM  import library (lib/pdfium.dll.lib), so pdf_win.exe links dynamically
REM  against pdfium.dll, which is copied next to the exe and bundled via
REM  package.json win.extraResources.
REM
REM  Steps:
REM    1. Resolve the latest pdfium-binaries tag from the GitHub API.
REM    2. Download pdfium-win-x64.tgz (via gh-proxy mirror, direct fallback).
REM    3. Download stb_image_write.h.
REM    4. Locate MSVC (vcvars64.bat) and compile with cl /MT.
REM
REM  Re-runnable: skips downloads already on disk. Run from a regular cmd
REM  prompt; a Developer Command Prompt is NOT required.
REM ============================================================================

setlocal enabledelayedexpansion

set "ROOT=%~dp0.."
pushd "%ROOT%"

set "BUILD_DIR=%ROOT%\bin\win-build"
set "PDFIUM_DIR=%BUILD_DIR%\pdfium"
set "STB_DIR=%BUILD_DIR%\stb"
set "OUTPUT_EXE=%ROOT%\bin\pdf_win.exe"
set "OUTPUT_DLL=%ROOT%\bin\pdfium.dll"
set "GH_PROXY=https://gh-proxy.com/"
set "GH_API=https://api.github.com/repos/bblanchon/pdfium-binaries/releases/latest"
set "STB_URL=https://raw.githubusercontent.com/nothings/stb/master/stb_image_write.h"

if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"

REM ----------------------------------------------------------------------------
REM 1+2. Fetch + extract pdfium-binaries (x64) if not already on disk.
REM ----------------------------------------------------------------------------
if not exist "%PDFIUM_DIR%\lib\pdfium.dll.lib" (
    echo [build_pdf_win] Resolving latest pdfium-binaries tag...

    REM Try the GitHub API directly first, then via the mirror.
    set "TAG="
    for /f "usebackq tokens=2 delims=:," %%a in (`powershell -NoProfile -Command "(Invoke-RestMethod -Uri '%GH_API%' -Headers @{ 'User-Agent'='build_pdf_win' }).tag_name"`) do (
        set "s=%%a"
        set "s=!s:"=!"
        set "s=!s: =!"
        if not defined TAG set "TAG=!s!"
    )
    if not defined TAG (
        for /f "usebackq tokens=2 delims=:," %%a in (`powershell -NoProfile -Command "(Invoke-RestMethod -Uri '%GH_PROXY%%GH_API%' -Headers @{ 'User-Agent'='build_pdf_win' }).tag_name"`) do (
            set "s=%%a"
            set "s=!s:"=!"
            set "s=!s: =!"
            if not defined TAG set "TAG=!s!"
        )
    )
    if not defined TAG (
        echo [build_pdf_win] ERROR: could not resolve latest pdfium tag. 1>&2
        exit /b 1
    )
    echo [build_pdf_win] Latest pdfium tag: !TAG!

    REM The release tag uses a literal slash (chromium/NNNN); URL-encode it for the download URL.
    set "TAG_ENC=!TAG:/=%%2F!"
    set "ASSET_URL=https://github.com/bblanchon/pdfium-binaries/releases/download/!TAG_ENC!/pdfium-win-x64.tgz"

    if not exist "%BUILD_DIR%\pdfium.tgz" (
        echo [build_pdf_win] Downloading pdfium via mirror...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri '%GH_PROXY%!ASSET_URL!' -OutFile '%BUILD_DIR%\pdfium.tgz' -UseBasicParsing } catch { Invoke-WebRequest -Uri '!ASSET_URL!' -OutFile '%BUILD_DIR%\pdfium.tgz' -UseBasicParsing }" || (
            echo [build_pdf_win] ERROR: pdfium download failed. 1>&2
            exit /b 1
        )
    )

    echo [build_pdf_win] Extracting pdfium.tgz...
    if exist "%PDFIUM_DIR%" rmdir /S /Q "%PDFIUM_DIR%"
    mkdir "%PDFIUM_DIR%"
    tar -xzf "%BUILD_DIR%\pdfium.tgz" -C "%PDFIUM_DIR%" || (
        echo [build_pdf_win] ERROR: tar extraction failed. (Needs Windows 10+ tar.exe.) 1>&2
        exit /b 1
    )
    if not exist "%PDFIUM_DIR%\lib\pdfium.dll.lib" (
        echo [build_pdf_win] ERROR: pdfium.dll.lib missing after extraction. 1>&2
        exit /b 1
    )
)

REM ----------------------------------------------------------------------------
REM 3. Fetch stb_image_write.h if not already on disk.
REM ----------------------------------------------------------------------------
if not exist "%STB_DIR%\stb_image_write.h" (
    if not exist "%STB_DIR%" mkdir "%STB_DIR%"
    echo [build_pdf_win] Downloading stb_image_write.h...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri '%STB_URL%' -OutFile '%STB_DIR%\stb_image_write.h' -UseBasicParsing } catch { Invoke-WebRequest -Uri '%GH_PROXY%%STB_URL%' -OutFile '%STB_DIR%\stb_image_write.h' -UseBasicParsing }" || (
        echo [build_pdf_win] ERROR: stb download failed. 1>&2
        exit /b 1
    )
)

REM ----------------------------------------------------------------------------
REM 4. Locate MSVC. Try vswhere first; fall back to hard-coded 2022 editions.
REM ----------------------------------------------------------------------------
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" set "VSWHERE=%ProgramFiles%\Microsoft Visual Studio\Installer\vswhere.exe"

set "VCVARS="
if exist "%VSWHERE%" (
    for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2^>nul`) do (
        if exist "%%i\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%%i\VC\Auxiliary\Build\vcvars64.bat"
    )
)
if not defined VCVARS (
    for %%E in (Community Professional Enterprise BuildTools) do (
        if exist "%ProgramFiles%\Microsoft Visual Studio\2022\%%E\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%ProgramFiles%\Microsoft Visual Studio\2022\%%E\VC\Auxiliary\Build\vcvars64.bat"
    )
)
if not defined VCVARS (
    echo [build_pdf_win] ERROR: Could not locate vcvars64.bat. Install Visual Studio 2022 1>&2
    echo [build_pdf_win]        with the "Desktop development with C++" workload. 1>&2
    exit /b 1
)

call "%VCVARS%" >nul 2>&1
if errorlevel 1 (
    echo [build_pdf_win] ERROR: vcvars64.bat failed. 1>&2
    exit /b 1
)

REM ----------------------------------------------------------------------------
REM 5. Compile. /MT = static CRT (no vcruntime redist). Link the pdfium import
REM    library (pdfium.dll.lib). Resulting exe needs pdfium.dll beside it.
REM ----------------------------------------------------------------------------
echo [build_pdf_win] Compiling pdf_win.cpp...
cl /nologo /std:c++17 /EHsc /O2 /MT ^
   /I "%PDFIUM_DIR%\include" /I "%STB_DIR%" ^
   /DHAS_FPDF_ANNOT=1 ^
   "%ROOT%\pdf_win.cpp" ^
   /Fe:"%OUTPUT_EXE%" ^
   /link "%PDFIUM_DIR%\lib\pdfium.dll.lib" kernel32.lib user32.lib gdi32.lib advapi32.lib shell32.lib ole32.lib

if errorlevel 1 (
    echo [build_pdf_win] ERROR: compilation failed. 1>&2
    exit /b 1
)

REM Clean MSVC intermediates.
if exist "%ROOT%\pdf_win.obj" del /q "%ROOT%\pdf_win.obj"

REM ----------------------------------------------------------------------------
REM 6. Copy pdfium.dll next to the exe so the loader finds it at runtime.
REM ----------------------------------------------------------------------------
copy /Y "%PDFIUM_DIR%\bin\pdfium.dll" "%OUTPUT_DLL%" >nul
if errorlevel 1 (
    echo [build_pdf_win] ERROR: failed to copy pdfium.dll. 1>&2
    exit /b 1
)

echo [build_pdf_win] OK: %OUTPUT_EXE% + %OUTPUT_DLL%
popd
endlocal
